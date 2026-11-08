// Placeholder block textures, drawn procedurally (no image files, nothing copied from Minecraft).
// Each block gets 16x16 tiles in one atlas: logs a bark side and a ring end, stripped logs a
// grain side and a ring end, wood/hyphae bark on every face, leaves speckle, vines a cut-out
// strand pattern. Colours come from BLOCK_COLORS. Bark is drawn dark and rough, stripped wood
// light and smooth, and log ends as light rings, so the three read apart at a glance.

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

const TAU = Math.PI * 2;

/**
 * Brightness of rough bark at (x, y): wavy vertical ridges with deep furrows between them, broken
 * by dark cracks and lit on the ridge tops. Ridge count and wander periods divide TILE, so the
 * pattern tiles seamlessly up a trunk and around it. Average ~0.75 (bark is darker than the
 * nominal block colour), range ~0.4-1.1 (high contrast).
 */
function barkField(r) {
  const k = 3 + Math.floor(r() * 2); // ridges per tile
  const p1 = r() * TAU, p2 = r() * TAU, a1 = 0.5 + r() * 0.5, a2 = 0.2 + r() * 0.3;
  const cracks = [];
  for (let c = 0; c < 5; c++) cracks.push([Math.floor(r() * TILE), Math.floor(r() * TILE), 2 + Math.floor(r() * 4)]);
  const f = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    const wander = a1 * Math.sin((TAU * y) / TILE + p1) + a2 * Math.sin((2 * TAU * y) / TILE + p2);
    for (let x = 0; x < TILE; x++) {
      const ridge = 0.5 + 0.5 * Math.cos((TAU * k * (x + wander)) / TILE); // 1 on ridge, 0 in furrow
      let v = 0.42 + 0.6 * Math.pow(ridge, 0.7) + (r() - 0.5) * 0.3;
      if (ridge > 0.9 && r() < 0.35) v += 0.12; // lit ridge tops
      f[y * TILE + x] = v;
    }
  }
  for (const [cx, cy, len] of cracks) for (let j = 0; j < len; j++) f[((cy + j) % TILE) * TILE + cx] *= 0.55;
  return f;
}

/** Bark (log sides, wood / hyphae on every face): dark and rough. */
function bark(rgb, r) {
  const t = tile();
  const f = barkField(r);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(t, x, y, rgb, f[y * TILE + x] * 0.85);
  return t;
}

/** Pale bark (birch-like): light base, low noise, scattered dark horizontal marks. */
function paleBark(rgb, r) {
  const t = tile();
  const f = new Float32Array(TILE * TILE).map(() => 0.93 + r() * 0.1);
  for (let m = 0; m < 9; m++) {
    const y = Math.floor(r() * TILE), x0 = Math.floor(r() * TILE), len = 2 + Math.floor(r() * 5);
    const dark = 0.25 + r() * 0.2;
    for (let j = 0; j < len; j++) f[y * TILE + ((x0 + j) % TILE)] = dark + r() * 0.1;
    if (r() < 0.4) f[((y + 1) % TILE) * TILE + ((x0 + 1) % TILE)] = dark + 0.15;
  }
  for (let i = 0; i < f.length; i++) put(t, i % TILE, Math.floor(i / TILE), rgb, f[i]);
  return t;
}

/** Stripped wood: smooth, light and low-contrast, with faint soft vertical grain. */
function grain(rgb, r) {
  const t = tile();
  // a few faint streaks, each spreading over neighbouring columns (wraps for seamless tiling)
  const col = new Float32Array(TILE).fill(1);
  for (let s = 0; s < 4; s++) {
    const c = Math.floor(r() * TILE), amp = (r() < 0.5 ? -1 : 1) * (0.025 + r() * 0.025);
    for (let dx = -1; dx <= 1; dx++) col[(c + dx + TILE) % TILE] += dx === 0 ? amp : amp * 0.5;
  }
  for (let x = 0; x < TILE; x++) {
    for (let y = 0; y < TILE; y++) put(t, x, y, rgb, 1.04 * col[x] * (0.985 + r() * 0.03));
  }
  return t;
}

/**
 * Log end: light inner wood with clear concentric rings and a darker pith, framed by a rim.
 * rimField (a bark brightness field) gives logs a rough two-pixel bark rim; null gives stripped
 * logs a thin, slightly darker rim of their own colour.
 */
function rings(inner, rim, r, rimField) {
  const t = tile();
  const w = rimField ? 2 : 1;
  const c = (TILE - 1) / 2;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const e = Math.min(x, y, TILE - 1 - x, TILE - 1 - y);
      if (e < w) {
        const f = rimField ? rimField[y * TILE + x] * 0.85 : 0.86 + r() * 0.04;
        put(t, x, y, rim, f);
        continue;
      }
      const dx = Math.abs(x - c), dy = Math.abs(y - c);
      const d = 0.65 * Math.max(dx, dy) + 0.35 * Math.hypot(dx, dy); // rounded square
      const ring = d < 1 ? 0.8 : Math.floor(d) % 2 === 0 ? 0.88 : 1.04;
      put(t, x, y, inner, ring * (0.98 + r() * 0.04));
    }
  }
  return t;
}

/** Perceived brightness 0..255. */
const luma = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];

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

/** Muddy mangrove roots: the root strands packed in grey-brown mud (an opaque block). */
function muddyRoots(rgb, r) {
  const t = tile();
  const strandRgb = [rgb[0] * 1.45, rgb[1] * 1.3, rgb[2] * 1.15]; // warmer, lighter root wood
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const strand = (x + 2 * y) % 7 < 2 || (2 * x - y + 64) % 9 < 2;
      if (strand) put(t, x, y, strandRgb, 0.85 + r() * 0.2);
      else put(t, x, y, rgb, (r() < 0.15 ? 0.8 : 0.95) + r() * 0.1); // mud with a few darker specks
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

// ---- tiles for the mushroom, fungus and decoration blocks (one per block, all faces) ----

/** Mushroom stem: pale, fine vertical fibres. */
function mushroomStem(rgb, r) {
  const t = tile();
  const col = Array.from({ length: TILE }, () => 0.9 + r() * 0.12);
  for (let x = 0; x < TILE; x++) for (let y = 0; y < TILE; y++) put(t, x, y, rgb, col[x] * (0.96 + r() * 0.06));
  return t;
}

/** Mushroom cap: mottled, optionally with pale round spots (red mushroom). */
function mushroomCap(rgb, r, spots) {
  const t = tile();
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) put(t, x, y, rgb, 0.88 + r() * 0.16);
  for (let s = 0; s < spots; s++) {
    const cx = Math.floor(r() * TILE), cy = Math.floor(r() * TILE), rad = 1 + r() * 1.3;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      if (x * x + y * y <= rad * rad) put(t, (cx + x + TILE) % TILE, (cy + y + TILE) % TILE, [236, 228, 216], 0.95 + r() * 0.08);
    }
  }
  return t;
}

/** Shroomlight: bright cells with darker seams. */
function glow(rgb, r) {
  const t = tile();
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const seam = (x % 5 === 0 && r() < 0.7) || (y % 5 === 0 && r() < 0.7);
    put(t, x, y, rgb, seam ? 0.78 : 1.02 + r() * 0.14);
  }
  return t;
}

/** Hanging moss: dense cut-out strands hanging from the top edge, thinning out downwards. */
function hangingMoss(rgb, r) {
  const t = tile();
  for (let x = 0; x < TILE; x++) {
    if (r() < 0.25) continue;
    const len = 6 + Math.floor(r() * (TILE - 6));
    for (let y = 0; y < len; y++) put(t, x, y, rgb, 0.8 + r() * 0.3);
  }
  return t;
}

/**
 * Weeping vines: a wavy central stem with clumps of small fleshy lobes on both sides (cut-out).
 * The stem wanders back to its start column so a column of plant blocks reads as one strand. The
 * tip block (WEEPING_VINES) stops two thirds down in a rounded clump.
 */
function weepingVines(rgb, r, tip) {
  const t = tile();
  const end = tip ? 11 : TILE;
  const x0 = 7;
  const phase = r() * TAU;
  for (let y = 0; y < end; y++) {
    const x = x0 + Math.round(1.3 * Math.sin((TAU * y) / TILE + phase));
    put(t, x, y, rgb, 0.7 + r() * 0.15);
    // lobes: short sideways clumps every few rows, alternating sides
    if (y % 3 === 0 || r() < 0.2) {
      const side = (y / 3) % 2 === 0 ? -1 : 1;
      const len = 2 + Math.floor(r() * 3);
      for (let j = 1; j <= len; j++) {
        const lx = x + side * j;
        if (lx < 0 || lx >= TILE) break;
        put(t, lx, y, rgb, 0.95 + r() * 0.25);
        if (j < len && r() < 0.6 && y + 1 < end) put(t, lx, y + 1, rgb, 0.85 + r() * 0.2);
      }
    }
  }
  if (tip) {
    for (let y = end - 2; y < end + 3; y++) for (let x = x0 - 2; x <= x0 + 2; x++) {
      const dx = x - x0, dy = y - end;
      if (dx * dx + dy * dy <= 5 && r() < 0.9) put(t, x, y, rgb, 1.0 + r() * 0.2);
    }
  }
  return t;
}

/** Leaves with small flowers (flowering azalea). */
function flowering(rgb, r) {
  const t = leaves(rgb, r);
  for (let s = 0; s < 7; s++) {
    const x = Math.floor(r() * (TILE - 1)), y = Math.floor(r() * (TILE - 1));
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(t, x + dx, y + dy, [214, 120, 190], 0.9 + r() * 0.2);
  }
  return t;
}

/** Tiles for blocks that are neither logs nor plain leaves, or null. */
function specialTile(name, rgb, r) {
  if (name === 'MUSHROOM_STEM') return mushroomStem(rgb, r);
  if (name === 'RED_MUSHROOM_BLOCK') return mushroomCap(rgb, r, 6);
  if (name === 'BROWN_MUSHROOM_BLOCK') return mushroomCap(rgb, r, 0);
  if (name === 'SHROOMLIGHT') return glow(rgb, r);
  if (name === 'PALE_HANGING_MOSS') return hangingMoss(rgb, r);
  if (name === 'WEEPING_VINES_PLANT') return weepingVines(rgb, r, false);
  if (name === 'WEEPING_VINES') return weepingVines(rgb, r, true);
  if (name === 'FLOWERING_AZALEA_LEAVES') return flowering(rgb, r);
  return null;
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
    const special = specialTile(name, rgb, r);
    if (special) {
      const i = add(special);
      tiles.set(name, { side: i, end: i });
      continue;
    }
    let side, end;
    // pale bark (birch-like) gets light marked bark instead of dark ridges
    const barkTile = (c) => (luma(c) > 170 ? paleBark(c, r) : bark(c, r));
    if (name.startsWith('STRIPPED_') && (name.endsWith('_LOG') || name.endsWith('_STEM'))) {
      side = add(grain(rgb, r));
      end = add(rings(rgb, rgb, r, null));
    } else if (name.startsWith('STRIPPED_')) {
      side = end = add(grain(rgb, r));
    } else if (name.endsWith('_LOG') || name.endsWith('_STEM')) {
      side = add(barkTile(rgb));
      const inner = colors['STRIPPED_' + name] ?? rgb.map((c) => c * 1.5).reduce((a, c) => (a << 8) | clamp(c), 0);
      end = add(rings(hex(inner), rgb, r, luma(rgb) > 170 ? null : barkField(r)));
    } else if (name.endsWith('_WOOD') || name.endsWith('_HYPHAE')) {
      side = end = add(barkTile(rgb));
    } else if (name.endsWith('_LEAVES') || name.endsWith('_WART_BLOCK')) {
      side = end = add(leaves(rgb, r));
    } else if (name === 'MUDDY_MANGROVE_ROOTS') {
      side = end = add(muddyRoots(rgb, r));
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
