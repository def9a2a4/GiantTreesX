// Port of com.ryanmichela.trees.rendering.Draw3d + Orientation (geometry only).
import { blockFloor, roundToInt } from './jmath.js';
import { SimplexNoiseGenerator, positionHash } from './noise.js';
import { KIND_WOOD, KIND_LEAF, PART_JUNCTION, packKey } from './voxels.js';

export const X_MAJOR = 0, Y_MAJOR = 1, Z_MAJOR = 2;

// Draw3d leaf noise (TreeType.noisyLeaves): see drawNoisyLeafCluster
export const LEAF_LUMP = 1.1, LEAF_LUMP_FREQ = 0.22;
export const LEAF_FINE = 0.3, LEAF_FINE_FREQ = 0.6;
export const LEAF_JITTER = 0.4;
export const LEAF_FULL_RADIUS = 2.0;
// cluster length (LeafScale / 2): no noise up to LEAF_CLEAN_SIZE, full from LEAF_FULL_SIZE
export const LEAF_CLEAN_SIZE = 2.5, LEAF_FULL_SIZE = 8.0;
const LEAF_REACH = LEAF_LUMP + LEAF_FINE + LEAF_JITTER / 2;

// Draw3d.coverBranches: branch wood within COVER_REACH_BRANCH blocks (Chebyshev) of leaves gets
// leaves on its top and sides, trunk wood within COVER_REACH_TRUNK on its top
export const COVER_REACH_BRANCH = 3, COVER_REACH_TRUNK = 1;
// a branch end with no leaves within TIP_REACH blocks gets a leaf cluster TIP_SCALE times the size
// of the tree's own
export const TIP_REACH = 2, TIP_SCALE = 0.7;
// bare undersides (cherry, Draw3d.bareUndersides): limb (level 1) wood more than BARE_TIP_KEEP blocks
// from every limb end, in a 2^BARE_CELL_SHIFT-block cell picked BARE_PERCENT times in 100, keeps the
// BARE_DEPTH blocks below it free of leaves
export const BARE_TIP_KEEP = 3, BARE_DEPTH = 8, BARE_CELL_SHIFT = 2, BARE_PERCENT = 55;
// columns (x, z offsets) carved below a bare limb block: its own and its four neighbours'
const BARE_COLUMNS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const COVER_SIDES = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

/** Orientation.orient(l1, l2) on Bukkit vectors */
export function orient(l1, l2) {
  const dx = Math.abs(l2.x - l1.x);
  const dy = Math.abs(l2.y - l1.y);
  const dz = Math.abs(l2.z - l1.z);
  if (dx >= Math.max(dy, dz)) return X_MAJOR;
  if (dy >= Math.max(dx, dz)) return Y_MAJOR;
  if (dz >= Math.max(dx, dy)) return Z_MAJOR;
  return Y_MAJOR;
}

/** Bresenham as in Draw3d.plotLine2d; returns flat [p0,q0,p1,q1,...] */
function plotLine2d(x1, y1, x2, y2) {
  const pts = [];
  let currentX, currentY, xInc, yInc, dx, dy, twoDx, twoDy, acc;
  dx = (x2 - x1) | 0;
  dy = (y2 - y1) | 0;
  twoDx = (dx + dx) | 0;
  twoDy = (dy + dy) | 0;
  currentX = x1;
  currentY = y1;
  xInc = 1;
  yInc = 1;
  if (dx < 0) { xInc = -1; dx = -dx; twoDx = -twoDx; }
  if (dy < 0) { yInc = -1; dy = -dy; twoDy = -twoDy; }
  pts.push(x1, y1);
  if (dx !== 0 || dy !== 0) {
    if (dy <= dx) {
      acc = 0;
      do {
        currentX = (currentX + xInc) | 0;
        acc = (acc + twoDy) | 0;
        if (acc > dx) { currentY = (currentY + yInc) | 0; acc = (acc - twoDx) | 0; }
        pts.push(currentX, currentY);
      } while (currentX !== x2);
    } else {
      acc = 0;
      do {
        currentY = (currentY + yInc) | 0;
        acc = (acc + twoDx) | 0;
        if (acc > dy) { currentX = (currentX + xInc) | 0; acc = (acc - twoDy) | 0; }
        pts.push(currentX, currentY);
      } while (currentY !== y2);
    }
  }
  return pts;
}

export class Draw3d {
  /**
   * @param {{x:number,y:number,z:number,hash:number}} refPoint  hash = Location.hashCode()
   * @param {number} noiseIntensity  tree Smooth param
   * @param {number} woodIndex  index of the wood type in the store's woodTypes table
   * @param {import('./voxels.js').VoxelStore} store
   * @param {boolean} inverted  RenderOrientation.INVERTED
   * @param {number} part  PART_TREE / PART_ROOT
   * @param {SimplexNoiseGenerator} [noise]  shared generator (same seed -> same generator)
   */
  constructor(refPoint, noiseIntensity, woodIndex, store, inverted, part, noise) {
    this.refPoint = refPoint;
    this.noise = noise || new SimplexNoiseGenerator(refPoint.hash);
    this.noiseIntensity = noiseIntensity;
    this.store = store;
    this.wood = woodIndex;
    this.inverted = inverted;
    this.part = part;
    this.capLevel = Infinity; // TreeType.capLevel, set by render.js
    this.noisyLeaves = false; // TreeType.noisyLeaves, set by render.js
    this.leafDroop = 0; // TreeType.leafDroop, set by render.js
    this.bareUndersides = false; // Draw3d.bareUndersides (cherry leaves), set by render.js
    this.bare = null; // packed keys kept free of leaves, see bareBlocks
    this.cache = new Map();
    this.leafCache = new Map();
    this.branchWood = new Set(); // packed keys of trunk and branch wood drawn (insertion order), see coverBranches
    this.stemEnds = []; // [x, y, z] of branch ends, see markStemEnd
    this.limbEnds = []; // ends of the level 1 branches (limbs), see bareBlocks
    this.leafLength = 0; // size of the last leaf cluster drawn
    this.leafWidth = 0;
  }

  toMcVector(v) {
    return { x: v.x, y: this.inverted ? -v.z : v.z, z: v.y };
  }

  /** raw simplex noise at block coords, memoized (pure function of integer coords) */
  rawNoise(x, y, z) {
    const key = ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);
    let v = this.cache.get(key);
    if (v === undefined) {
      v = this.noise.noise(x * 0.25, y * 0.25, z * 0.25);
      this.cache.set(key, v);
    }
    return v;
  }

  /** LEAF_LUMP * lump + LEAF_FINE * fine octave at a block, memoized (clusters overlap a lot). */
  leafNoise(x, y, z) {
    const key = ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);
    let v = this.leafCache.get(key);
    if (v === undefined) {
      const lump = this.noise.noise(x * LEAF_LUMP_FREQ + 31.5, y * LEAF_LUMP_FREQ + 47.25, z * LEAF_LUMP_FREQ + 13.75);
      const fine = this.noise.noise(x * LEAF_FINE_FREQ + 71.5, y * LEAF_FINE_FREQ + 5.25, z * LEAF_FINE_FREQ + 89.75);
      v = LEAF_LUMP * lump + LEAF_FINE * fine;
      this.leafCache.set(key, v);
    }
    return v;
  }

  calculateNoiseOffset(x, y, z, multiplier, level) {
    const levelScale = (4 - level) / 4;
    return (this.rawNoise(x, y, z) + 1) * this.noiseIntensity * multiplier * levelScale;
  }

  /** Draw3d.addWood: from capLevel on (TreeType.capLevel) stems are leaf blocks that never overwrite. */
  addWood(x, y, z, orientation, level, part = this.part) {
    if (level >= this.capLevel) this.store.add(x, y, z, KIND_LEAF, -1, -1, part, this.wood, false);
    else {
      this.store.add(x, y, z, KIND_WOOD, level, orientation, part, this.wood, true);
      if (!this.inverted && part !== PART_JUNCTION) {
        this.branchWood.add(packKey(x, y, z));
      }
    }
  }

  /**
   * Draw3d.bareBlocks: the blocks leaves stay out of (computed once, at the first leaf cluster,
   * when all stems are drawn): for bareUndersides types, the BARE_DEPTH blocks below each limb
   * block (level 1) more than BARE_TIP_KEEP blocks from every limb end, down to the next wood,
   * where the block's cell is picked (BARE_PERCENT in 100). Empty for other types.
   */
  bareBlocks() {
    if (this.bare !== null) return this.bare;
    this.bare = new Set();
    if (!this.bareUndersides || this.inverted) return this.bare;
    const store = this.store, seed = this.refPoint.hash;
    const keep2 = BARE_TIP_KEEP * BARE_TIP_KEEP;
    const ends = this.limbEnds.map((e) => [blockFloor(e.x), blockFloor(e.y), blockFloor(e.z)]);
    for (const key of this.branchWood) {
      const i = store.index.get(key);
      if (store.kind[i] !== KIND_WOOD || store.level[i] !== 1) continue;
      const x = store.x[i], y = store.y[i], z = store.z[i];
      const h = positionHash(seed, x >> BARE_CELL_SHIFT, y >> BARE_CELL_SHIFT, z >> BARE_CELL_SHIFT, 11);
      if ((h >>> 8) % 100 >= BARE_PERCENT) continue;
      let nearEnd = false;
      for (const [ex, ey, ez] of ends) {
        const dx = x - ex, dy = y - ey, dz = z - ez;
        if (dx * dx + dy * dy + dz * dz <= keep2) { nearEnd = true; break; }
      }
      if (nearEnd) continue;
      // the column below the block and below its four horizontal neighbours, each down to the
      // next wood, so the bare limb shows from the side as well as from straight below
      for (const [sx, sz] of BARE_COLUMNS) {
        for (let d = 1; d <= BARE_DEPTH; d++) {
          const k = packKey(x + sx, y - d, z + sz);
          const j = store.index.get(k);
          if (j !== undefined && store.kind[j] === KIND_WOOD) break;
          this.bare.add(k);
        }
      }
    }
    return this.bare;
  }

  /**
   * Draw3d.coverBranches, after the leaves: a branch should have leaves atop it and at its ends.
   * 1. Each branch end (markStemEnd) with no leaves within TIP_REACH gets a leaf cluster.
   * 2. Branch wood (not roots) within COVER_REACH_BRANCH of leaves gets leaves in the empty blocks
   *    above and beside it; trunk wood within COVER_REACH_TRUNK only above it (where it ends in
   *    the crown). Bare limbs well below the canopy stay bare.
   * 3. Wood still showing amid leaves (two or more leaf faces) gets leaves above and beside it.
   * Off for plain-leaved types (mushrooms, fungi), except that a mushroom's stem top gets a cap
   * block over it where it reaches the cap's top, so no stem shows through the cap.
   */
  coverBranches() {
    if (this.inverted) return;
    if (!this.noisyLeaves) {
      if (this.capLevel !== Infinity) {
        this.coverPass((x, y, z, level) => (level === 0 && this.leafWithin(x, y, z, COVER_REACH_TRUNK) ? 1 : 0));
      }
      return;
    }
    const tipLength = this.leafLength * TIP_SCALE, tipWidth = this.leafWidth * TIP_SCALE;
    if (tipLength > 0) {
      for (const end of this.stemEnds) {
        if (!this.leafWithin(blockFloor(end.x), blockFloor(end.y), blockFloor(end.z), TIP_REACH)) {
          this.drawLeafCluster(end, tipLength, tipWidth);
        }
      }
    }
    // near the canopy: the trunk only on top (where it ends in the crown), branches on top and sides
    this.coverPass((x, y, z, level) => {
      if (level === 0) return this.leafWithin(x, y, z, COVER_REACH_TRUNK) ? 1 : 0;
      return this.leafWithin(x, y, z, COVER_REACH_BRANCH) ? COVER_SIDES.length : 0;
    });
    // wood the first pass left showing amid leaves (two or more leaf faces): top and sides
    this.coverPass((x, y, z) => (this.leafFaces(x, y, z) >= 2 ? COVER_SIDES.length : 0));
  }

  /**
   * Leaves in the empty blocks of the first sides(x, y, z, level) of COVER_SIDES (up, then the
   * four horizontal sides) around each trunk and branch block, decided for all blocks first.
   */
  coverPass(sides) {
    const store = this.store;
    const cover = new Set();
    for (const key of this.branchWood) {
      const i = store.index.get(key);
      if (store.kind[i] !== KIND_WOOD) continue;
      const x = store.x[i], y = store.y[i], z = store.z[i];
      const n = sides(x, y, z, store.level[i]);
      for (let k = 0; k < n; k++) {
        const [dx, dy, dz] = COVER_SIDES[k];
        const key2 = packKey(x + dx, y + dy, z + dz);
        if (!store.has(x + dx, y + dy, z + dz) && !this.bareBlocks().has(key2)) cover.add(key2);
      }
    }
    for (const key of cover) {
      const x = Math.floor(key / 4294967296) - 32768;
      const y = (Math.floor(key / 65536) % 65536) - 32768;
      const z = (key % 65536) - 32768;
      store.add(x, y, z, KIND_LEAF, -1, -1, this.part, this.wood, false);
    }
  }

  /** Leaf blocks among a block's six face neighbours. */
  leafFaces(x, y, z) {
    const store = this.store;
    let n = 0;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const i = store.index.get(packKey(x + dx, y + dy, z + dz));
      if (i !== undefined && store.kind[i] === KIND_LEAF) n++;
    }
    return n;
  }

  /** Draw3d.markStemEnd: a stem's last point; branch ends (level 1 up) get covered by coverBranches. */
  markStemEnd(pos, level) {
    if (level >= 1 && level < this.capLevel && !this.inverted) {
      this.stemEnds.push(pos);
      if (level === 1) this.limbEnds.push(pos);
    }
  }

  /** Whether a leaf block lies within reach (Chebyshev distance) of a block. */
  leafWithin(x, y, z, reach) {
    const store = this.store;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          const i = store.index.get(packKey(x + dx, y + dy, z + dz));
          if (i !== undefined && store.kind[i] === KIND_LEAF) return true;
        }
      }
    }
    return false;
  }

  drawCone(l1, rad1, l2, rad2, level) {
    const orientation = orient(l1, l2);
    const line = this.plotLine3d(l1, l2, orientation);
    const dx = l1.x - l2.x, dy = l1.y - l2.y, dz = l1.z - l2.z;
    const h = Math.sqrt(dx * dx + dy * dy + dz * dz); // Vector.distance (square() == x*x)
    const ht = (-rad1 * h) / (rad2 - rad1);
    const n = line.length / 3;
    for (let i = 0; i < n; i++) {
      const cx = line[i * 3], cy = line[i * 3 + 1], cz = line[i * 3 + 2];
      // the centre line can have more blocks than the cone is long (it ends past l2's block
      // boundary): clamp there instead of extrapolating the taper, which for a cone shorter than a
      // block (Taper 1-2 ends) gave huge negative radii, drawn as wide discs
      const r = roundToInt((rad1 * (ht - Math.min(i, h))) / ht);
      let pts;
      switch (orientation) {
        case X_MAJOR:
          pts = this.plotCircle(cy, cz, cx, r, level);
          for (let p = 0; p < pts.length; p += 2) {
            this.addWood(cx, pts[p], pts[p + 1], orientation, level);
          }
          break;
        case Y_MAJOR:
          pts = this.plotCircle(cx, cz, cy, r, level);
          for (let p = 0; p < pts.length; p += 2) {
            this.addWood(pts[p], cy, pts[p + 1], orientation, level);
          }
          break;
        case Z_MAJOR:
          pts = this.plotCircle(cx, cy, cz, r, level);
          for (let p = 0; p < pts.length; p += 2) {
            this.addWood(pts[p], pts[p + 1], cz, orientation, level);
          }
          break;
      }
    }
  }

  drawLeafCluster(pos, length, width) {
    this.leafLength = length;
    this.leafWidth = width;
    const skip = this.bareBlocks();
    if (this.noisyLeaves) { this.drawNoisyLeafCluster(pos, length, width, skip); return; }
    // plotEllipsoid(pos, length, width, length, 0), sheared by leafDroop
    const a = length, b = width, c = length;
    const halfSize = (Math.ceil(Math.max(Math.max(a, b), c)) | 0) + 2;
    const px = blockFloor(pos.x), py = blockFloor(pos.y), pz = blockFloor(pos.z);
    const aa = a * a, bb = b * b, cc = c * c;
    const store = this.store;
    const [dropX, dropZ, ext] = this.droop(pos, halfSize);
    for (let x = -halfSize; x <= halfSize; x++) {
      for (let y = -halfSize - ext; y <= halfSize + ext; y++) {
        for (let z = -halfSize; z <= halfSize; z++) {
          const yy = y + dropX * x + dropZ * z;
          const left = (x * x) / aa + (yy * yy) / bb + (z * z) / cc;
          const noiseOffset = this.calculateNoiseOffset(x + px, y + py, z + pz, 1, 0);
          if (left <= 1 + noiseOffset) {
            // new Vector(x,y,z).add(pos) -> block coords via floor
            const lx = blockFloor(x + pos.x), ly = blockFloor(y + pos.y), lz = blockFloor(z + pos.z);
            if (skip.size === 0 || !skip.has(packKey(lx, ly, lz))) store.add(lx, ly, lz, KIND_LEAF, -1, -1, this.part, this.wood, false);
          }
        }
      }
    }
  }

  /**
   * Draw3d.plotNoisyEllipsoid: the ellipsoid of drawLeafCluster with an uneven surface. A block's
   * distance outside the (Smooth-noised) ellipsoid, in blocks along the ray from the centre, is
   * compared with a displacement made of two simplex octaves (lumps and dents) and a per-block
   * hash jitter (single-block gaps and protrusions). The displacement scales with the cluster's
   * length (none up to LEAF_CLEAN_SIZE, full from LEAF_FULL_SIZE) and shrinks where the cluster is
   * thinner than LEAF_FULL_RADIUS, so small clusters stay clean and don't vanish.
   */
  drawNoisyLeafCluster(pos, length, width, skip) {
    const a = length, b = width, c = length;
    const halfSize = (Math.ceil(Math.max(Math.max(a, b), c)) | 0) + 3;
    const px = blockFloor(pos.x), py = blockFloor(pos.y), pz = blockFloor(pos.z);
    const aa = a * a, bb = b * b, cc = c * c;
    const store = this.store, seed = this.refPoint.hash;
    // calculateNoiseOffset(.., 1, 0) <= 2 * Smooth (simplex noise stays within [-1, 1])
    const tMax = 1 + 2.5 * this.noiseIntensity;
    const clusterAmp = Math.min(1, Math.max(0, (a - LEAF_CLEAN_SIZE) / (LEAF_FULL_SIZE - LEAF_CLEAN_SIZE)));
    const [dropX, dropZ, ext] = this.droop(pos, halfSize);
    for (let x = -halfSize; x <= halfSize; x++) {
      for (let y = -halfSize - ext; y <= halfSize + ext; y++) {
        for (let z = -halfSize; z <= halfSize; z++) {
          const bx = x + px, by = y + py, bz = z + pz;
          // the shape is tested at the sheared height yy (leafDroop), the noise at the block
          const yy = y + dropX * x + dropZ * z;
          const left = (x * x) / aa + (yy * yy) / bb + (z * z) / cc;
          const r2 = x * x + yy * yy + z * z;
          // far outside even for the largest Smooth offset: skip the noise lookups
          if (left > 0 && Math.sqrt(r2) * (1 - Math.sqrt(tMax / left)) > LEAF_REACH) continue;
          const q = left / (1 + this.calculateNoiseOffset(bx, by, bz, 1, 0));
          let inside;
          if (q === 0) {
            inside = true;
          } else {
            const r = Math.sqrt(r2);
            const d = Math.sqrt(q);
            const rDir = r / d; // centre to surface along this ray
            const out = r - rDir; // blocks outside the surface (negative inside)
            if (out <= -LEAF_REACH) inside = true;
            else if (out > LEAF_REACH) inside = false;
            else {
              const amp = clusterAmp * Math.min(1, rDir / LEAF_FULL_RADIUS);
              const reach = amp * (LEAF_LUMP + LEAF_FINE) + (clusterAmp * LEAF_JITTER) / 2;
              if (out <= -reach) inside = true;
              else if (out > reach) inside = false;
              else {
                const u = (positionHash(seed, bx, by, bz, 7) >>> 8) / 16777216;
                inside = out <= amp * this.leafNoise(bx, by, bz) + (clusterAmp * LEAF_JITTER) * (u - 0.5);
              }
            }
          }
          if (inside) {
            const lx = blockFloor(x + pos.x), ly = blockFloor(y + pos.y), lz = blockFloor(z + pos.z);
            if (skip.size === 0 || !skip.has(packKey(lx, ly, lz))) store.add(lx, ly, lz, KIND_LEAF, -1, -1, this.part, this.wood, false);
          }
        }
      }
    }
  }

  /**
   * Draw3d.droop: leafDroop shear of a leaf cluster at pos. A block x, z off the cluster's centre
   * is tested at height y + dropX * x + dropZ * z, so the cluster sinks leafDroop blocks per block
   * away from the trunk (the y axis); ext = blocks the y range grows by. All 0 without droop.
   */
  droop(pos, halfSize) {
    const len = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (this.leafDroop <= 0 || len === 0) return [0, 0, 0];
    return [(this.leafDroop * pos.x) / len, (this.leafDroop * pos.z) / len, Math.ceil(this.leafDroop * halfSize) | 0];
  }

  drawRootJunction(pos, r) {
    // plotDownwardHemisphere(pos, r)
    // the top (ground) layer is a plain disc of the trunk radius rounded like drawCone's circles
    const rCeil = (Math.ceil(r) | 0) + 4;
    const r2 = r * r;
    const rTop = roundToInt(r);
    const px = blockFloor(pos.x), py = blockFloor(pos.y), pz = blockFloor(pos.z);
    for (let x = -rCeil; x <= rCeil; x++) {
      for (let y = -rCeil; y <= 0; y++) {
        for (let z = -rCeil; z <= rCeil; z++) {
          if (y === 0) {
            if (x * x + z * z <= rTop * rTop) this.addWood(blockFloor(x + pos.x), blockFloor(y + pos.y), blockFloor(z + pos.z), Y_MAJOR, 0, PART_JUNCTION);
            continue;
          }
          const left = x * x + y * y + z * z;
          const no = this.calculateNoiseOffset(x + px, y + py, z + pz, 2, 0);
          if (left <= r2 + no * no) {
            this.addWood(blockFloor(x + pos.x), blockFloor(y + pos.y), blockFloor(z + pos.z), Y_MAJOR, 0, PART_JUNCTION);
          }
        }
      }
    }
  }

  drawWoodSphere(pos, r, orientation, level) {
    // plotSphere(pos, r, level)
    const rCeil = (Math.ceil(r) | 0) + 4;
    const r2 = r * r;
    const px = blockFloor(pos.x), py = blockFloor(pos.y), pz = blockFloor(pos.z);
    for (let x = -rCeil; x <= rCeil; x++) {
      for (let y = -rCeil; y <= rCeil; y++) {
        for (let z = -rCeil; z <= rCeil; z++) {
          const left = x * x + y * y + z * z;
          const no = this.calculateNoiseOffset(x + px, y + py, z + pz, 2, level);
          if (left <= r2 + no * no) {
            this.addWood(blockFloor(x + pos.x), blockFloor(y + pos.y), blockFloor(z + pos.z), orientation, level);
          }
        }
      }
    }
  }

  /** returns flat [px,py, ...] absolute circle points like Draw3d.plotCircle */
  plotCircle(cx, cy, z, r, level) {
    const pts = [];
    const rSquare = Math.imul(r, r);
    const lo = (-r - 8) | 0, hi = (r + 8) | 0;
    for (let x = lo; x <= hi; x++) {
      for (let y = lo; y <= hi; y++) {
        const no = this.calculateNoiseOffset(x + cx, y + cy, z, 4, level);
        if ((x === 0 && y === 0) || x * x + y * y <= rSquare + no * no) {
          pts.push(cx + x, cy + y);
        }
      }
    }
    return pts;
  }

  /** returns flat [x,y,z,...] integer centre line like Draw3d.plotLine3d */
  plotLine3d(l1, l2, orientation) {
    const out = [];
    const l1x = blockFloor(l1.x), l1y = blockFloor(l1.y), l1z = blockFloor(l1.z);
    const l2x = blockFloor(l2.x), l2y = blockFloor(l2.y), l2z = blockFloor(l2.z);
    if (orientation === X_MAJOR) {
      const xy = plotLine2d(l1x, l1y, l2x, l2y);
      const xz = plotLine2d(l1x, l1z, l2x, l2z);
      const n = Math.min(xy.length, xz.length) / 2;
      for (let i = 0; i < n; i++) out.push(xy[i * 2], xy[i * 2 + 1], xz[i * 2 + 1]);
    } else if (orientation === Y_MAJOR) {
      const yx = plotLine2d(l1y, l1x, l2y, l2x);
      const yz = plotLine2d(l1y, l1z, l2y, l2z);
      const n = Math.min(yx.length, yz.length) / 2;
      for (let i = 0; i < n; i++) out.push(yx[i * 2 + 1], yx[i * 2], yz[i * 2 + 1]);
    } else if (orientation === Z_MAJOR) {
      const zx = plotLine2d(l1z, l1x, l2z, l2x);
      const zy = plotLine2d(l1z, l1y, l2z, l2y);
      const n = Math.min(zx.length, zy.length) / 2;
      for (let i = 0; i < n; i++) out.push(zx[i * 2 + 1], zy[i * 2 + 1], zx[i * 2]);
    }
    return out;
  }
}
