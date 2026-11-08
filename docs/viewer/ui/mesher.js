// Voxel -> merged chunk meshes with hidden-face culling, per-face shading and per-vertex
// ambient occlusion. Pure JS (no three.js) so it can be timed under Node.
//
// mesh(data, opts) -> { chunks: [{ key, opaque, trans, cut }], grid, dims, origin, faces, ms }
//   each buffer is { pos: Float32Array, col: Float32Array, uv: Float32Array, idx: Uint32Array } or null;
//   `cut` holds vines: two crossed double-sided cards per vine (alpha-tested).
//
// data: { n, x, y, z, kind, part, level, mat, orient, yOffset }
//   orient: log axis for wood (0 x, 1 y, 2 z)
// opts: {
//   matInfo: [{ air, translucent }] indexed by material id,
//   tileFor(i, end) -> atlas tile for voxel i (end = the face is a log end),
//   tileUV(tile) -> [u0, v0, u1, v1],
//   colorFor(i) -> [r,g,b] | null   per-voxel tint (colour-by modes); white otherwise,
//   showLeaves, showRoots, showVines, translucent (bool),
//   slice: { axis: 'x'|'z'|null, pos, keep: 'lower'|'upper' },  maxY, minY  (display coords),
//   plane: { nx, ny, nz, d } | null   view cut: hides blocks whose centre has n.p + d < 0,
// }

export const CHUNK = 32;

// face order: +X -X +Y -Y +Z -Z
const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
// CCW corners (offsets from the cell's min corner) seen from outside
const CORNERS = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];
// Minecraft-like directional shade: top bright, bottom dark, X sides darker than Z sides
export const FACE_SHADE = [0.62, 0.62, 1.0, 0.5, 0.8, 0.8];
const AO_LEVEL = [0.5, 0.68, 0.84, 1.0];
// colours are linear (three.js vertex colours); shade factors above are perceptual (sRGB), so
// convert them once
const toLin = (v) => Math.pow(v, 2.2);
const FACE_SHADE_L = FACE_SHADE.map(toLin);
const AO_LEVEL_L = AO_LEVEL.map(toLin);

class Buf {
  constructor() {
    this.pos = new Float32Array(4096 * 3);
    this.col = new Float32Array(4096 * 3);
    this.uv = new Float32Array(4096 * 2);
    this.idx = new Uint32Array(4096 * 1.5);
    this.nv = 0;
    this.ni = 0;
  }
  reserve(verts) {
    if ((this.nv + verts) * 3 > this.pos.length) {
      const grow = (a, n) => { const b = new a.constructor(n); b.set(a); return b; };
      const cap = Math.max(this.pos.length * 2, (this.nv + verts) * 3);
      this.pos = grow(this.pos, cap);
      this.col = grow(this.col, cap);
      this.uv = grow(this.uv, (cap / 3) * 2);
      this.idx = grow(this.idx, cap / 2);
    }
  }
}

const WHITE = [1, 1, 1];

/**
 * Texture coordinates of a face corner. The tile's v axis runs along the log axis on side faces
 * (so bark grain follows the log); end faces use the two other axes.
 */
function cornerUV(f, cr, axis, rect, out) {
  const normal = f >> 1;
  let u, v;
  if (normal === axis) {
    const a = normal === 0 ? 1 : 0, b = normal === 2 ? 1 : 2;
    u = cr[a]; v = cr[b];
  } else {
    v = cr[axis];
    u = cr[3 - normal - axis];
  }
  out[0] = rect[0] + (rect[2] - rect[0]) * u;
  out[1] = rect[1] + (rect[3] - rect[1]) * v;
}

// vines: an X of two vertical cards crossing diagonally through the cell, like Minecraft's
// plant model. Not how vines look in game (a panel on the block they hang on), but close enough.
const VINE_CARDS = [
  [[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0]],
];
const VINE_SHADE = 0.8;

const JITTER_L = Float32Array.from({ length: 256 }, (_, k) => toLin(0.94 + (k / 255) * 0.09));
function hashJitter(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return JITTER_L[(h >>> 16) & 255];
}

function fin(b) {
  return b && { pos: b.pos.slice(0, b.nv * 3), col: b.col.slice(0, b.nv * 3), uv: b.uv.slice(0, b.nv * 2), idx: b.idx.slice(0, b.ni) };
}

export function mesh(data, opts) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const { n, x, y, z, kind, part, mat } = data;
  const orient = data.orient;
  const yOff = data.yOffset | 0;
  const info = opts.matInfo;
  // bounding box over every voxel (stable while toggles change)
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const X = x[i], Y = y[i] + yOff, Z = z[i];
    if (X < minX) minX = X; if (X > maxX) maxX = X;
    if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
    if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z;
  }
  if (n === 0) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
  const ox = minX - 1, oy = minY - 1, oz = minZ - 1;
  const sx = maxX - minX + 3, sy = maxY - minY + 3, sz = maxZ - minZ + 3;
  const sxy = sx * sy;
  // grid cell -> voxel index + 1 (0 = empty / filtered out). Layout: gx + gy*sx + gz*sx*sy
  const grid = new Int32Array(sx * sy * sz);
  const trans = new Uint8Array(n); // 1 if rendered translucent

  const sl = opts.slice || {};
  const sliceAxis = sl.axis === 'x' || sl.axis === 'z' ? sl.axis : null;
  const slicePos = +sl.pos;
  const keepUpper = sl.keep === 'upper';
  const yCapHi = opts.maxY == null ? Infinity : +opts.maxY;
  const yCapLo = opts.minY == null ? -Infinity : +opts.minY;
  const pl = opts.plane || null;
  let visible = 0;
  const vines = []; // vines are not solid: they never hide or shade neighbouring faces
  for (let i = 0; i < n; i++) {
    const m = info[mat[i]];
    if (!m || m.air) continue;
    const k = kind[i];
    if (k === 2 && !opts.showLeaves) continue;
    if (k === 3 && !opts.showVines) continue;
    if (part[i] === 1 && !opts.showRoots) continue;
    const Y = y[i] + yOff;
    if (Y > yCapHi || Y < yCapLo) continue;
    if (sliceAxis) {
      const c = sliceAxis === 'x' ? x[i] : z[i];
      if (keepUpper ? c < slicePos : c > slicePos) continue;
    }
    if (pl && pl.nx * (x[i] + 0.5) + pl.ny * (Y + 0.5) + pl.nz * (z[i] + 0.5) + pl.d < 0) continue;
    if (k === 3) { vines.push(i); visible++; continue; }
    grid[(x[i] - ox) + (Y - oy) * sx + (z[i] - oz) * sxy] = i + 1;
    if (opts.translucent && m.translucent) trans[i] = 1;
    visible++;
  }

  const dOff = DIRS.map(([a, b, c]) => a + b * sx + c * sxy);
  // per face/corner: offsets of the two side neighbours and the diagonal (relative to the cell)
  const aoOff = CORNERS.map((corners, f) => {
    const d = DIRS[f];
    const axes = [0, 1, 2].filter((a) => d[a] === 0);
    return corners.map((c) => {
      const s = [0, 0, 0];
      const u = [0, 0, 0], v = [0, 0, 0];
      u[axes[0]] = c[axes[0]] ? 1 : -1;
      v[axes[1]] = c[axes[1]] ? 1 : -1;
      const off = (w) => (d[0] + w[0]) + (d[1] + w[1]) * sx + (d[2] + w[2]) * sxy;
      s[0] = off(u); s[1] = off(v); s[2] = off([u[0] + v[0], u[1] + v[1], u[2] + v[2]]);
      return s;
    });
  });

  const chunks = [];
  let faces = 0;
  const cnx = Math.ceil(sx / CHUNK), cny = Math.ceil(sy / CHUNK), cnz = Math.ceil(sz / CHUNK);
  const colorFor = opts.colorFor || null;
  const tileFor = opts.tileFor;
  const tileUV = opts.tileUV;
  const ao = new Float32Array(4);
  const uvTmp = [0, 0];
  for (let cz = 0; cz < cnz; cz++) for (let cy = 0; cy < cny; cy++) for (let cx = 0; cx < cnx; cx++) {
    let ob = null, tb = null;
    const zEnd = Math.min(sz - 1, (cz + 1) * CHUNK), yEnd = Math.min(sy - 1, (cy + 1) * CHUNK), xEnd = Math.min(sx - 1, (cx + 1) * CHUNK);
    for (let gz = Math.max(1, cz * CHUNK); gz < zEnd; gz++) {
      for (let gy = Math.max(1, cy * CHUNK); gy < yEnd; gy++) {
        let cell = Math.max(1, cx * CHUNK) + gy * sx + gz * sxy;
        for (let gx = Math.max(1, cx * CHUNK); gx < xEnd; gx++, cell++) {
          const v = grid[cell];
          if (v === 0) continue;
          const i = v - 1;
          const isT = trans[i];
          const mi = mat[i];
          let rgb = null;
          for (let f = 0; f < 6; f++) {
            const nv = grid[cell + dOff[f]];
            if (nv !== 0) {
              const j = nv - 1;
              if (!trans[j]) continue; // opaque neighbour hides the face
              if (isT && mat[j] === mi) continue; // same translucent block: merge
            }
            if (rgb === null) {
              rgb = (colorFor && colorFor(i)) || WHITE;
            }
            const axis = kind[i] === 1 && orient ? orient[i] : 1;
            const rect = tileUV(tileFor(i, (f >> 1) === axis));
            let b;
            if (isT) b = tb || (tb = new Buf());
            else b = ob || (ob = new Buf());
            b.reserve(4);
            // ambient occlusion from solid cells in front of the face
            const offs = aoOff[f];
            for (let c = 0; c < 4; c++) {
              const o = offs[c];
              const s1 = grid[cell + o[0]] !== 0 ? 1 : 0;
              const s2 = grid[cell + o[1]] !== 0 ? 1 : 0;
              const cc = grid[cell + o[2]] !== 0 ? 1 : 0;
              ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            }
            const shade = FACE_SHADE_L[f] * hashJitter(gx, gy, gz);
            const px = gx + ox, py = gy + oy, pz = gz + oz;
            const corners = CORNERS[f];
            const base = b.nv;
            for (let c = 0; c < 4; c++) {
              const k3 = (base + c) * 3;
              const cr = corners[c];
              b.pos[k3] = px + cr[0];
              b.pos[k3 + 1] = py + cr[1];
              b.pos[k3 + 2] = pz + cr[2];
              const l = shade * AO_LEVEL_L[ao[c]];
              b.col[k3] = rgb[0] * l;
              b.col[k3 + 1] = rgb[1] * l;
              b.col[k3 + 2] = rgb[2] * l;
              cornerUV(f, cr, axis, rect, uvTmp);
              b.uv[(base + c) * 2] = uvTmp[0];
              b.uv[(base + c) * 2 + 1] = uvTmp[1];
            }
            const I = b.idx;
            let q = b.ni;
            if (ao[0] + ao[2] < ao[1] + ao[3]) {
              I[q++] = base + 1; I[q++] = base + 2; I[q++] = base + 3;
              I[q++] = base + 1; I[q++] = base + 3; I[q++] = base;
            } else {
              I[q++] = base; I[q++] = base + 1; I[q++] = base + 2;
              I[q++] = base; I[q++] = base + 2; I[q++] = base + 3;
            }
            b.ni = q;
            b.nv += 4;
            faces++;
          }
        }
      }
    }
    if (ob || tb) chunks.push({ key: `${cx},${cy},${cz}`, opaque: fin(ob), trans: fin(tb), cut: null });
  }

  if (vines.length) {
    const vb = new Buf();
    const l = toLin(VINE_SHADE);
    for (const i of vines) {
      const rgb = (colorFor && colorFor(i)) || WHITE;
      const rect = tileUV(tileFor(i, false));
      const px = x[i], py = y[i] + yOff, pz = z[i];
      for (const card of VINE_CARDS) {
        vb.reserve(4);
        const base = vb.nv;
        for (let c = 0; c < 4; c++) {
          const k3 = (base + c) * 3;
          vb.pos[k3] = px + card[c][0];
          vb.pos[k3 + 1] = py + card[c][1];
          vb.pos[k3 + 2] = pz + card[c][2];
          vb.col[k3] = rgb[0] * l;
          vb.col[k3 + 1] = rgb[1] * l;
          vb.col[k3 + 2] = rgb[2] * l;
          vb.uv[(base + c) * 2] = c === 1 || c === 2 ? rect[2] : rect[0];
          vb.uv[(base + c) * 2 + 1] = c >= 2 ? rect[3] : rect[1];
        }
        vb.idx.set([base, base + 1, base + 2, base, base + 2, base + 3], vb.ni);
        vb.ni += 6;
        vb.nv += 4;
        faces++;
      }
    }
    chunks.push({ key: 'vines', opaque: null, trans: null, cut: fin(vb) });
  }
  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  return {
    chunks, grid, dims: [sx, sy, sz], origin: [ox, oy, oz], faces, visible,
    bbox: { minX, minY, minZ, maxX, maxY, maxZ }, ms: t1 - t0,
  };
}

/** Voxel index at display coords (or -1), using a mesh() result's grid. */
export function voxelAt(m, X, Y, Z) {
  const gx = X - m.origin[0], gy = Y - m.origin[1], gz = Z - m.origin[2];
  if (gx < 0 || gy < 0 || gz < 0 || gx >= m.dims[0] || gy >= m.dims[1] || gz >= m.dims[2]) return -1;
  return m.grid[gx + gy * m.dims[0] + gz * m.dims[0] * m.dims[1]] - 1;
}
