// Placeholder block textures, drawn procedurally (no image files, nothing copied from Minecraft).
// Each block gets 16x16 tiles in one atlas: logs a bark side and a ring end, stripped logs a
// grain side and a ring end, wood/hyphae bark on every face, leaves speckle, vines a cut-out
// strand pattern. Colours come from BLOCK_COLORS.

export const TILE = 16;

const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Small deterministic PRNG so a block's texture is the same on every load. */
function rng(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function tile() {
  return new Uint8ClampedArray(TILE * TILE * 4);
}
function put(t, x, y, rgb, f = 1, a = 255) {
  const k = (y * TILE + x) * 4;
  t[k] = clamp(rgb[0] * f);
  t[k + 1] = clamp(rgb[1] * f);
  t[k + 2] = clamp(rgb[2] * f);
  t[k + 3] = a;
}

/** Vertical bark: per-column tone, darker cracks. */
function bark(rgb, r) {
  const t = tile();
  const col = Array.from({ length: TILE }, () => 0.82 + r() * 0.3);
  for (let x = 0; x < TILE; x++) {
    let crack = r() < 0.3 ? Math.floor(r() * TILE) : -99;
    for (let y = 0; y < TILE; y++) {
      let f = col[x] * (0.93 + r() * 0.12);
      if (y >= crack && y < crack + 3 + Math.floor(r() * 4)) f *= 0.62;
      put(t, x, y, rgb, f);
    }
  }
  return t;
}

/** Stripped wood: light base with fine vertical grain. */
function grain(rgb, r) {
  const t = tile();
  for (let x = 0; x < TILE; x++) {
    const line = x % 4 === 0 || r() < 0.15 ? 0.88 : 1;
    for (let y = 0; y < TILE; y++) put(t, x, y, rgb, line * (0.95 + r() * 0.08));
  }
  return t;
}

/** Log end: concentric rings in the inner colour, one-pixel bark rim. */
function rings(inner, rim, r) {
  const t = tile();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      if (edge) { put(t, x, y, rim, 0.85 + r() * 0.15); continue; }
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = Math.floor(d) % 3 === 0 ? 0.82 : 1;
      put(t, x, y, inner, ring * (0.95 + r() * 0.08));
    }
  }
  return t;
}

/** Leaves (opaque, like Minecraft's fast graphics): speckled tones with dark gaps. */
function leaves(rgb, r) {
  const t = tile();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = r();
      const f = v < 0.12 ? 0.55 : v > 0.85 ? 1.18 : 0.88 + r() * 0.16;
      put(t, x, y, rgb, f);
    }
  }
  return t;
}

/** Mangrove roots: dark gaps with diagonal strands. */
function roots(rgb, r) {
  const t = tile();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const strand = (x + y) % 6 < 2 || (x - y + 32) % 7 < 2;
      put(t, x, y, rgb, strand ? 0.95 + r() * 0.15 : 0.45 + r() * 0.1);
    }
  }
  return t;
}

/** Vine: transparent with wandering vertical strands and a few leaves (alpha cut-out). */
function vine(rgb, r) {
  const t = tile();
  for (let s = 0; s < 4; s++) {
    let x = 1 + Math.floor(r() * (TILE - 2));
    for (let y = 0; y < TILE; y++) {
      put(t, x, y, rgb, 0.8 + r() * 0.3);
      if (r() < 0.35) put(t, Math.min(TILE - 1, x + 1), y, rgb, 1.1);
      if (r() < 0.3) x = Math.max(0, Math.min(TILE - 1, x + (r() < 0.5 ? -1 : 1)));
    }
  }
  return t;
}

/** Anything else: plain noise. */
function noise(rgb, r) {
  const t = tile();
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(t, x, y, rgb, 0.9 + r() * 0.15);
  return t;
}

function white() {
  const t = tile();
  for (let i = 0; i < t.length; i++) t[i] = 255;
  return t;
}

/**
 * Builds the atlas for the given block names.
 * @returns {{ canvas, cols, rows, tiles: Map<string, {side:number, end:number}>, plain:number,
 *             uv(tile) -> [u0, v0, u1, v1] }}
 */
export function buildAtlas(names, colors, missing = 0xff00ff) {
  const list = [];
  const tiles = new Map();
  const add = (px) => list.push(px) - 1;
  const plain = add(white());
  for (const name of names) {
    if (tiles.has(name)) continue;
    const r = rng(name);
    const rgb = hex(colors[name] ?? missing);
    let side, end;
    if (name.startsWith('STRIPPED_') && (name.endsWith('_LOG') || name.endsWith('_STEM'))) {
      side = add(grain(rgb, r));
      const bark = colors[name.slice(9)] ?? colors[name] ?? missing;
      end = add(rings(rgb, hex(bark).map((c) => c * 0.9), r));
    } else if (name.startsWith('STRIPPED_')) {
      side = end = add(grain(rgb, r));
    } else if (name.endsWith('_LOG') || name.endsWith('_STEM')) {
      side = add(bark(rgb, r));
      const inner = colors['STRIPPED_' + name] ?? rgb.map((c) => c * 1.5).reduce((a, c) => (a << 8) | clamp(c), 0);
      end = add(rings(hex(inner), rgb, r));
    } else if (name.endsWith('_WOOD') || name.endsWith('_HYPHAE')) {
      side = end = add(bark(rgb, r));
    } else if (name.endsWith('_LEAVES') || name.endsWith('_WART_BLOCK')) {
      side = end = add(leaves(rgb, r));
    } else if (name.endsWith('_ROOTS')) {
      side = end = add(roots(rgb, r));
    } else if (name === 'VINE') {
      side = end = add(vine(rgb, r));
    } else {
      side = end = add(noise(rgb, r));
    }
    tiles.set(name, { side, end });
  }

  const cols = Math.ceil(Math.sqrt(list.length));
  const rows = Math.ceil(list.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d');
  list.forEach((px, i) => ctx.putImageData(new ImageData(px, TILE, TILE), (i % cols) * TILE, Math.floor(i / cols) * TILE));

  // inset half a texel so neighbouring tiles never bleed in
  const du = 0.5 / canvas.width, dv = 0.5 / canvas.height;
  const uv = (i) => {
    const u0 = (i % cols) / cols, v1 = 1 - Math.floor(i / cols) / rows; // canvas y runs down
    return [u0 + du, v1 - 1 / rows + dv, u0 + 1 / cols - du, v1 - dv];
  };
  return { canvas, cols, rows, tiles, plain, uv };
}
