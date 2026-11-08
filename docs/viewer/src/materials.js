// Material assignment. Geometry (which voxels are wood/leaf/vine, stem level, orientation, part)
// comes from render.js; this module decides which Minecraft block each voxel becomes.
//
// HOOK: assignMaterials(voxels, opts, table) -> Uint16Array of material ids (index into table).
// defaultAssignMaterials reproduces the plugin's raw TreeType mapping (log for wood, leaves for
// leaf, VINE) - what the tracker holds before WoodStyler runs. woodStyleAssign is the port of the
// plugin's WoodStyler pass (bark / stripped cores / hollow trunks / leaf mixes), i.e. what the
// plugin actually places; it can produce 'AIR' (carved hollow trunk), which renderers skip
// (isSkippedMaterial).
import { KIND_WOOD, KIND_LEAF, KIND_VINE, packKey } from './voxels.js';
import { JavaRandom } from './jrandom.js';

/** rendering/TreeType.java */
export function treeTypeMaterials(woodType) {
  switch (woodType) {
    case 'Oak': return { wood: 'OAK_LOG', leaf: 'OAK_LEAVES' };
    case 'Spruce': return { wood: 'SPRUCE_LOG', leaf: 'SPRUCE_LEAVES' };
    case 'Birch': return { wood: 'BIRCH_LOG', leaf: 'BIRCH_LEAVES' };
    case 'Cherry': return { wood: 'CHERRY_LOG', leaf: 'CHERRY_LEAVES' };
    case 'Jungle': return { wood: 'JUNGLE_LOG', leaf: 'JUNGLE_LEAVES' };
    case 'Acacia': return { wood: 'ACACIA_LOG', leaf: 'ACACIA_LEAVES' };
    case 'Dark Oak': return { wood: 'DARK_OAK_LOG', leaf: 'DARK_OAK_LEAVES' };
    case 'Mangrove': return { wood: 'MANGROVE_LOG', leaf: 'MANGROVE_LEAVES' };
    case 'Mangrove_roots': return { wood: 'MANGROVE_ROOTS', leaf: 'MANGROVE_LEAVES' };
    default: return { wood: 'OAK_LOG', leaf: 'OAK_LEAVES' };
  }
}

// Approximate block colours (sRGB hex) and alpha. Unknown materials fall back to magenta.
export const BLOCK_COLORS = {
  OAK_LOG: 0x6b5232, OAK_WOOD: 0x6b5232, STRIPPED_OAK_LOG: 0xb29157, STRIPPED_OAK_WOOD: 0xb29157, OAK_LEAVES: 0x4f8a2a,
  SPRUCE_LOG: 0x3b2712, SPRUCE_WOOD: 0x3b2712, STRIPPED_SPRUCE_LOG: 0x75592f, STRIPPED_SPRUCE_WOOD: 0x75592f, SPRUCE_LEAVES: 0x3d5f3d,
  BIRCH_LOG: 0xd8d7d2, BIRCH_WOOD: 0xd8d7d2, STRIPPED_BIRCH_LOG: 0xc5b077, STRIPPED_BIRCH_WOOD: 0xc5b077, BIRCH_LEAVES: 0x6d8f45,
  CHERRY_LOG: 0x3a2129, CHERRY_WOOD: 0x3a2129, STRIPPED_CHERRY_LOG: 0xd99a9a, STRIPPED_CHERRY_WOOD: 0xd99a9a, CHERRY_LEAVES: 0xe9a9c4,
  JUNGLE_LOG: 0x584419, JUNGLE_WOOD: 0x584419, STRIPPED_JUNGLE_LOG: 0xab8556, STRIPPED_JUNGLE_WOOD: 0xab8556, JUNGLE_LEAVES: 0x3a8d1b,
  ACACIA_LOG: 0x67615a, ACACIA_WOOD: 0x67615a, STRIPPED_ACACIA_LOG: 0xae5c3b, STRIPPED_ACACIA_WOOD: 0xae5c3b, ACACIA_LEAVES: 0x5a8a24,
  DARK_OAK_LOG: 0x3c2e1a, DARK_OAK_WOOD: 0x3c2e1a, STRIPPED_DARK_OAK_LOG: 0x4a3a24, STRIPPED_DARK_OAK_WOOD: 0x4a3a24, DARK_OAK_LEAVES: 0x3b6b1e,
  MANGROVE_LOG: 0x543d2c, MANGROVE_WOOD: 0x543d2c, STRIPPED_MANGROVE_LOG: 0x773634, STRIPPED_MANGROVE_WOOD: 0x773634, MANGROVE_LEAVES: 0x4c8d26,
  MANGROVE_ROOTS: 0x4a3b2b, MUDDY_MANGROVE_ROOTS: 0x3e3631,
  PALE_OAK_LOG: 0x544c49, PALE_OAK_WOOD: 0x544c49, STRIPPED_PALE_OAK_LOG: 0xf4eae9, STRIPPED_PALE_OAK_WOOD: 0xf4eae9, PALE_OAK_LEAVES: 0x8a9089,
  CRIMSON_STEM: 0x5c1d1e, CRIMSON_HYPHAE: 0x5c1d1e, STRIPPED_CRIMSON_STEM: 0x8a3a5a, STRIPPED_CRIMSON_HYPHAE: 0x8a3a5a, NETHER_WART_BLOCK: 0x730303,
  WARPED_STEM: 0x3a3a4d, WARPED_HYPHAE: 0x3a3a4d, STRIPPED_WARPED_STEM: 0x3a9a8f, STRIPPED_WARPED_HYPHAE: 0x3a9a8f, WARPED_WART_BLOCK: 0x167e86,
  AZALEA_LEAVES: 0x5a7a2c, FLOWERING_AZALEA_LEAVES: 0x7a7a4c,
  SHROOMLIGHT: 0xf09246, MOSS_BLOCK: 0x596e2d,
  VINE: 0x2f6b14,
};
export const TRANSLUCENT = (name) => name.endsWith('_LEAVES') || name === 'VINE' || name.endsWith('ROOTS');
/** Materials that place nothing visible (WoodStyler carves hollow trunks with AIR). */
export const isSkippedMaterial = (name) => name === 'AIR' || name === 'CAVE_AIR' || name === 'VOID_AIR';

/** Material id table shared by worker and UI (ids are stable within one result). */
export class MaterialTable {
  constructor() {
    this.names = [];
    this.ids = new Map();
  }
  id(name) {
    let i = this.ids.get(name);
    if (i === undefined) {
      i = this.names.length;
      this.names.push(name);
      this.ids.set(name, i);
    }
    return i;
  }
}

/**
 * Lightweight read-only view handed to material passes.
 * voxels: { n, x, y, z (Int32Array), kind (1 wood, 2 leaf, 3 vine), level (stem level; -1 leaf/vine),
 *           orient (Orientation enum 0=xMajor 1=yMajor 2=zMajor for wood; vine face for vines),
 *           part (0 tree, 1 root, 2 root junction), wood (index into woodTypes), woodTypes: string[],
 *           has(x,y,z), indexOf(x,y,z) -> i or -1 }
 */
export function makeVoxelView(result) {
  const s = result.store;
  return {
    n: s.n, x: s.x, y: s.y, z: s.z, kind: s.kind, level: s.level, orient: s.orient, part: s.part, wood: s.wood,
    woodTypes: result.woodTypes,
    has: (x, y, z) => s.index.has(packKey(x, y, z)),
    indexOf: (x, y, z) => { const i = s.index.get(packKey(x, y, z)); return i === undefined ? -1 : i; },
  };
}

/**
 * Default material pass == what the plugin's Java code places today.
 * @param voxels view from makeVoxelView
 * @param {object} opts  free-form options from the UI (unused by the default)
 * @param {MaterialTable} table
 * @returns {Uint16Array} material id per voxel
 */
export function defaultAssignMaterials(voxels, opts, table) {
  const out = new Uint16Array(voxels.n);
  const woodIds = voxels.woodTypes.map((w) => table.id(treeTypeMaterials(w).wood));
  const leafIds = voxels.woodTypes.map((w) => table.id(treeTypeMaterials(w).leaf));
  const vine = table.id('VINE');
  for (let i = 0; i < voxels.n; i++) {
    const k = voxels.kind[i];
    out[i] = k === KIND_WOOD ? woodIds[voxels.wood[i]] : k === KIND_LEAF ? leafIds[voxels.wood[i]] : k === KIND_VINE ? vine : 0;
  }
  return out;
}

// Replaceable at runtime (e.g. by a future port of the Java material post-processing pass).
export let assignMaterials = defaultAssignMaterials;
export function setAssignMaterials(fn) {
  assignMaterials = fn || defaultAssignMaterials;
}

// ---------------------------------------------------------------------------------------------
// WoodStyler port (com.ryanmichela.trees.rendering.WoodStyler + WoodStyle)

/** config.yml defaults of the `wood` section (WoodStyle.fromConfig falls back to the same). */
export const WOOD_STYLE_DEFAULTS = Object.freeze({ style: 'mixed', hollowChance: 0, hollowWallThickness: 2, leaves: null });
export const WOOD_STYLE_MODES = Object.freeze(['all_log', 'mixed', 'mixed_stripped']);

// Material.getMaterial() lookups made by WoodStyler.barkOf / strippedOf. Only names that exist
// in the server's Material enum may be produced; this lists every vanilla log/stem family.
const LOG_FAMILIES = ['OAK', 'SPRUCE', 'BIRCH', 'JUNGLE', 'ACACIA', 'DARK_OAK', 'MANGROVE', 'CHERRY', 'PALE_OAK'];
const STEM_FAMILIES = ['CRIMSON', 'WARPED'];
const KNOWN_MATERIALS = new Set();
for (const f of LOG_FAMILIES) for (const n of [`${f}_LOG`, `${f}_WOOD`, `STRIPPED_${f}_LOG`, `STRIPPED_${f}_WOOD`]) KNOWN_MATERIALS.add(n);
for (const f of STEM_FAMILIES) for (const n of [`${f}_STEM`, `${f}_HYPHAE`, `STRIPPED_${f}_STEM`, `STRIPPED_${f}_HYPHAE`]) KNOWN_MATERIALS.add(n);
const orSame = (name, fallback) => (KNOWN_MATERIALS.has(name) ? name : fallback);

/** WoodStyler.barkOf: OAK_LOG -> OAK_WOOD, CRIMSON_STEM -> CRIMSON_HYPHAE; unchanged otherwise. */
export function barkOf(log) {
  if (log.endsWith('_LOG')) return orSame(log.slice(0, -4) + '_WOOD', log);
  if (log.endsWith('_STEM')) return orSame(log.slice(0, -5) + '_HYPHAE', log);
  return log;
}

/** WoodStyler.strippedOf: OAK_LOG -> STRIPPED_OAK_LOG; unchanged when there is no such block. */
export function strippedOf(log) {
  if (log.endsWith('_LOG') || log.endsWith('_STEM')) return orSame('STRIPPED_' + log, log);
  return log;
}

const GOLDEN = 0x9e3779b97f4a7c15n;
const MIX = 0xbf58476d1ce4e5b9n;
const s64 = (v) => BigInt.asIntN(64, v);

/**
 * WoodStyler.pickLeaf: position-hashed weighted pick.
 * @param {[string, number][]} entries  [material, weight] in config (LinkedHashMap) order, weights > 0
 * @param {number} total  sum of weights (Java int)
 */
export function pickLeaf(entries, total, x, y, z, seed) {
  let h = BigInt(seed | 0);
  h = s64(h * GOLDEN + BigInt(x | 0));
  h = s64(h * GOLDEN + BigInt(y | 0));
  h = s64(h * GOLDEN + BigInt(z | 0));
  h = s64(h ^ (BigInt.asUintN(64, h) >> 31n));
  h = s64(h * MIX);
  h = s64(h ^ (BigInt.asUintN(64, h) >> 29n));
  const t = BigInt(total);
  let roll = Number(((h % t) + t) % t); // Math.floorMod(h, (long) total)
  for (const [m, w] of entries) {
    roll -= w;
    if (roll < 0) return m;
  }
  return entries[0][0];
}

/** The tree-level hollow roll: new Random(seed).nextDouble() * 100 < hollowChance */
export function rollHollow(seed, hollowChance) {
  return hollowChance > 0 && new JavaRandom(seed | 0).nextDouble() * 100 < hollowChance;
}

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * WoodStyler.woodDepth: multi-source BFS from the outer layer inward over 6-connected wood
 * voxels. Returns Int32Array per voxel index: 1 = has a non-wood face neighbour, 2 = next layer
 * in, ...; 0 for non-wood voxels.
 */
export function woodDepth(voxels) {
  const n = voxels.n;
  const depth = new Int32Array(n);
  const queue = new Int32Array(n);
  let qt = 0;
  const isWood = (x, y, z) => {
    const j = voxels.indexOf(x, y, z);
    return j >= 0 && voxels.kind[j] === KIND_WOOD;
  };
  for (let i = 0; i < n; i++) {
    if (voxels.kind[i] !== KIND_WOOD) continue;
    const x = voxels.x[i], y = voxels.y[i], z = voxels.z[i];
    for (const f of FACES) {
      if (!isWood(x + f[0], y + f[1], z + f[2])) {
        depth[i] = 1;
        queue[qt++] = i;
        break;
      }
    }
  }
  for (let qh = 0; qh < qt; qh++) {
    const i = queue[qh];
    const next = depth[i] + 1;
    const x = voxels.x[i], y = voxels.y[i], z = voxels.z[i];
    for (const f of FACES) {
      const j = voxels.indexOf(x + f[0], y + f[1], z + f[2]);
      if (j >= 0 && voxels.kind[j] === KIND_WOOD && depth[j] === 0) {
        depth[j] = next;
        queue[qt++] = j;
      }
    }
  }
  return depth;
}

/**
 * Material pass equal to TreeRenderer's `WoodStyler.apply(tracker, WoodStyle, seed)`.
 *
 * @param voxels view from makeVoxelView
 * @param {object} opts
 * @param {'all_log'|'mixed'|'mixed_stripped'} [opts.style='mixed']  unknown values -> 'mixed' (as fromConfig)
 * @param {number} [opts.hollowChance=0]  percent 0-100 (clamped, as fromConfig)
 * @param {boolean} [opts.forceHollow=false]  preview-only: carve the trunk regardless of the roll
 * @param {number} [opts.hollowWallThickness=2]  >= 1 (clamped, as fromConfig)
 * @param {Object<string, number>|null} [opts.leaves=null]  weighted leaf mix {MATERIAL: weight},
 *        insertion order matters (= config order); null/empty -> the wood type's own leaves
 * @param {number} opts.seed  the tree seed (same int passed to renderTree)
 * @param {MaterialTable} table
 * @returns {Uint16Array} material id per voxel ('AIR' for carved voxels)
 */
export function woodStyleAssign(voxels, opts, table) {
  const o = { ...WOOD_STYLE_DEFAULTS, ...(opts || {}) };
  const mode = WOOD_STYLE_MODES.includes(String(o.style).toLowerCase()) ? String(o.style).toLowerCase() : 'mixed';
  const hollowChance = Math.max(0, Math.min(100, +o.hollowChance || 0));
  const wall = Math.max(1, (o.hollowWallThickness | 0) || 0);
  const seed = o.seed | 0;
  const leafEntries = o.leaves ? Object.entries(o.leaves).map(([m, w]) => [m, w | 0]).filter(([, w]) => w > 0) : [];
  let leafTotal = 0;
  for (const [, w] of leafEntries) leafTotal = (leafTotal + w) | 0;

  const out = defaultAssignMaterials(voxels, opts, table);
  const hollow = !!o.forceHollow || rollHollow(seed, hollowChance);
  const needsDepth = mode !== 'all_log' || hollow;
  const depth = needsDepth ? woodDepth(voxels) : null;

  const air = hollow ? table.id('AIR') : -1;
  const barkId = new Map(); // base id -> styled id
  const coreId = new Map();
  const styled = (cache, id, fn) => {
    let v = cache.get(id);
    if (v === undefined) { v = table.id(fn(table.names[id])); cache.set(id, v); }
    return v;
  };
  const leafIds = leafEntries.length ? new Map(leafEntries.map(([m]) => [m, table.id(m)])) : null;

  for (let i = 0; i < voxels.n; i++) {
    const k = voxels.kind[i];
    if (k === KIND_LEAF) {
      if (leafIds) out[i] = leafIds.get(pickLeaf(leafEntries, leafTotal, voxels.x[i], voxels.y[i], voxels.z[i], seed));
      continue;
    }
    if (k !== KIND_WOOD || !depth) continue;
    const d = depth[i];
    if (hollow && voxels.level[i] === 0 && voxels.y[i] >= 1 && d > wall) {
      out[i] = air;
    } else if (mode !== 'all_log') {
      if (d === 1) out[i] = styled(barkId, out[i], barkOf);
      else if (mode === 'mixed_stripped') out[i] = styled(coreId, out[i], strippedOf);
    }
  }
  return out;
}
