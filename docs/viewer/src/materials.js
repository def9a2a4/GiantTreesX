// Material assignment. Geometry (which voxels are wood/leaf/vine, stem level, orientation, part)
// comes from render.js; this module decides which Minecraft block each voxel becomes.
//
// HOOK: assignMaterials(voxels, opts, table) -> Uint16Array of material ids (index into table).
// defaultAssignMaterials reproduces the plugin's raw TreeType mapping (log for wood, leaves for
// leaf, VINE) - what the tracker holds before WoodStyler runs. woodStyleAssign is the port of the
// plugin's WoodStyler pass (bark / stripped cores / hollow trunks / leaf mixes), i.e. what the
// plugin actually places; it can produce 'AIR' (carved hollow trunk), which renderers skip
// (isSkippedMaterial).
import { KIND_WOOD, KIND_LEAF, KIND_VINE, KIND_HANGING, packKey } from './voxels.js';
import { JavaRandom } from './jrandom.js';

// rendering/TreeType.java: [wood, [[leaf, weight], ...], decoration, hanging block, fallback].
// The first leaf is the raw leaf block; several leaves make the default WoodStyle leaf mix.
export const DECORATION_NONE = 'none';
export const DECORATION_TRUNK_VINES = 'trunk_vines'; // JungleVinePopulator
export const DECORATION_LEAF_VINES = 'leaf_vines'; // LeafDecorator.vines
export const DECORATION_HANGING = 'hanging'; // LeafDecorator.hanging
const TREE_TYPES = {
  'Oak': ['OAK_LOG', [['OAK_LEAVES', 1]], DECORATION_NONE, null, null],
  'Spruce': ['SPRUCE_LOG', [['SPRUCE_LEAVES', 1]], DECORATION_NONE, null, 'Oak'],
  'Birch': ['BIRCH_LOG', [['BIRCH_LEAVES', 1]], DECORATION_NONE, null, 'Oak'],
  'Cherry': ['CHERRY_LOG', [['CHERRY_LEAVES', 1]], DECORATION_NONE, null, 'Oak'],
  'Jungle': ['JUNGLE_LOG', [['JUNGLE_LEAVES', 1]], DECORATION_TRUNK_VINES, null, 'Oak'],
  'Acacia': ['ACACIA_LOG', [['ACACIA_LEAVES', 1]], DECORATION_NONE, null, 'Oak'],
  'Dark Oak': ['DARK_OAK_LOG', [['DARK_OAK_LEAVES', 1]], DECORATION_NONE, null, 'Oak'],
  'Mangrove': ['MANGROVE_LOG', [['MANGROVE_LEAVES', 1]], DECORATION_LEAF_VINES, null, 'Oak'],
  'Mangrove_roots': ['MANGROVE_ROOTS', [['MANGROVE_LEAVES', 1]], DECORATION_NONE, null, 'Oak'],
  'Pale Oak': ['PALE_OAK_LOG', [['PALE_OAK_LEAVES', 1]], DECORATION_HANGING, 'PALE_HANGING_MOSS', 'Dark Oak'],
  'Swamp Oak': ['OAK_LOG', [['OAK_LEAVES', 1]], DECORATION_LEAF_VINES, null, 'Oak'],
  'Red Mushroom': ['MUSHROOM_STEM', [['RED_MUSHROOM_BLOCK', 1]], DECORATION_NONE, null, 'Oak'],
  'Brown Mushroom': ['MUSHROOM_STEM', [['BROWN_MUSHROOM_BLOCK', 1]], DECORATION_NONE, null, 'Oak'],
  'Poplar': ['POPLAR_LOG', [['YELLOW_POPLAR_LEAVES', 5], ['ORANGE_POPLAR_LEAVES', 3], ['RED_POPLAR_LEAVES', 2]], DECORATION_NONE, null, 'Birch'],
  'Crimson': ['CRIMSON_STEM', [['NETHER_WART_BLOCK', 14], ['SHROOMLIGHT', 1]], DECORATION_HANGING, 'WEEPING_VINES_PLANT', 'Oak'],
  'Warped': ['WARPED_STEM', [['WARPED_WART_BLOCK', 14], ['SHROOMLIGHT', 1]], DECORATION_NONE, null, 'Oak'],
  'Azalea': ['OAK_LOG', [['AZALEA_LEAVES', 3], ['FLOWERING_AZALEA_LEAVES', 2]], DECORATION_NONE, null, 'Oak'],
};
/** TreeType.capLevel: stems of this level and deeper are drawn with the leaf block (mushroom caps). */
const CAP_LEVELS = { 'Red Mushroom': 1, 'Brown Mushroom': 1 };
/** TreeType hangingTip (bottom block of a hanging strand; default: the hanging block itself). */
const HANGING_TIPS = { 'Crimson': 'WEEPING_VINES' };
/** TreeType hangingOneIn / hangingMin / hangingMax (LeafDecorator.hanging); default [4, 1, 6]. */
const HANGING_SHAPES = { 'Crimson': [6, 1, 9] };
/** TreeType.noisyLeaves: false keeps the plain (Smooth-noised) ellipsoid leaf clusters. */
const PLAIN_LEAVES = new Set(['Red Mushroom', 'Brown Mushroom', 'Crimson', 'Warped']);
export const WOOD_TYPES = Object.freeze(Object.keys(TREE_TYPES));
/** Every block TreeType can produce (GeometryHarness reports which of them its API lacks). */
export const TREE_TYPE_MATERIALS = Object.freeze([...new Set([
  ...Object.values(TREE_TYPES).flatMap(([w, l, , h]) => [w, ...l.map((e) => e[0]), ...(h ? [h] : [])]),
  ...Object.values(HANGING_TIPS)])]);
const ALL_MATERIALS = () => true;

/**
 * rendering/TreeType.java
 * @param {string} woodType
 * @param {(name: string) => boolean} [hasMaterial]  whether the server has a block (default: all,
 *        i.e. the newest Minecraft); missing blocks make the type fall back like the plugin does
 * @returns {{ wood: string, leaf: string, leafMix: [string, number][] | null, decoration: string,
 *             hanging: string | null, hangingTip: string | null,
 *             hangingShape: [number, number, number], capLevel: number, noisyLeaves: boolean, type: string }}  type = the wood type actually used
 */
export function treeTypeMaterials(woodType, hasMaterial = ALL_MATERIALS) {
  let name = Object.hasOwn(TREE_TYPES, woodType) ? woodType : 'Oak';
  let spec = TREE_TYPES[name];
  while (!hasMaterial(spec[0]) || !hasMaterial(spec[1][0][0])) {
    name = spec[4];
    spec = TREE_TYPES[name];
  }
  const [wood, leaves, deco, hangingName] = spec;
  const leafMix = leaves.length > 1 ? leaves.filter(([m]) => hasMaterial(m)) : [];
  const hanging = hangingName && hasMaterial(hangingName) ? hangingName : null;
  const tipName = HANGING_TIPS[name] ?? hanging;
  const hangingTip = tipName && hasMaterial(tipName) ? tipName : null;
  const decoration = deco === DECORATION_HANGING && (!hanging || !hangingTip) ? DECORATION_NONE : deco;
  const capLevel = CAP_LEVELS[name] ?? Infinity;
  const isHanging = decoration === DECORATION_HANGING;
  return {
    wood, leaf: leaves[0][0], leafMix: leafMix.length ? leafMix : null, decoration,
    hanging: isHanging ? hanging : null, hangingTip: isHanging ? hangingTip : null,
    hangingShape: HANGING_SHAPES[name] ?? [4, 1, 6],
    capLevel, noisyLeaves: !PLAIN_LEAVES.has(name), type: name,
  };
}

// Approximate block colours (sRGB hex) and alpha. Unknown materials fall back to magenta.
export const BLOCK_COLORS = {
  OAK_LOG: 0x6b5232, OAK_WOOD: 0x6b5232, STRIPPED_OAK_LOG: 0xc4a26a, STRIPPED_OAK_WOOD: 0xc4a26a, OAK_LEAVES: 0x4f8a2a,
  SPRUCE_LOG: 0x3b2712, SPRUCE_WOOD: 0x3b2712, STRIPPED_SPRUCE_LOG: 0xa07c4e, STRIPPED_SPRUCE_WOOD: 0xa07c4e, SPRUCE_LEAVES: 0x3d5f3d,
  BIRCH_LOG: 0xd8d7d2, BIRCH_WOOD: 0xd8d7d2, STRIPPED_BIRCH_LOG: 0xd9c48e, STRIPPED_BIRCH_WOOD: 0xd9c48e, BIRCH_LEAVES: 0x6d8f45,
  CHERRY_LOG: 0x3a2129, CHERRY_WOOD: 0x3a2129, STRIPPED_CHERRY_LOG: 0xe2a8a6, STRIPPED_CHERRY_WOOD: 0xe2a8a6, CHERRY_LEAVES: 0xe9a9c4,
  JUNGLE_LOG: 0x584419, JUNGLE_WOOD: 0x584419, STRIPPED_JUNGLE_LOG: 0xc29a68, STRIPPED_JUNGLE_WOOD: 0xc29a68, JUNGLE_LEAVES: 0x3a8d1b,
  ACACIA_LOG: 0x67615a, ACACIA_WOOD: 0x67615a, STRIPPED_ACACIA_LOG: 0xcd7046, STRIPPED_ACACIA_WOOD: 0xcd7046, ACACIA_LEAVES: 0x5a8a24,
  DARK_OAK_LOG: 0x3c2e1a, DARK_OAK_WOOD: 0x3c2e1a, STRIPPED_DARK_OAK_LOG: 0x8a6a45, STRIPPED_DARK_OAK_WOOD: 0x8a6a45, DARK_OAK_LEAVES: 0x3b6b1e,
  MANGROVE_LOG: 0x543d2c, MANGROVE_WOOD: 0x543d2c, STRIPPED_MANGROVE_LOG: 0xa8524a, STRIPPED_MANGROVE_WOOD: 0xa8524a, MANGROVE_LEAVES: 0x4c8d26,
  MANGROVE_ROOTS: 0x4a3b2b, MUDDY_MANGROVE_ROOTS: 0x3e3631,
  PALE_OAK_LOG: 0x544c49, PALE_OAK_WOOD: 0x544c49, STRIPPED_PALE_OAK_LOG: 0xf4eae9, STRIPPED_PALE_OAK_WOOD: 0xf4eae9, PALE_OAK_LEAVES: 0x8a9089,
  CRIMSON_STEM: 0x5c1d1e, CRIMSON_HYPHAE: 0x5c1d1e, STRIPPED_CRIMSON_STEM: 0xb0507a, STRIPPED_CRIMSON_HYPHAE: 0xb0507a, NETHER_WART_BLOCK: 0x730303,
  WARPED_STEM: 0x3a3a4d, WARPED_HYPHAE: 0x3a3a4d, STRIPPED_WARPED_STEM: 0x4cb4a6, STRIPPED_WARPED_HYPHAE: 0x4cb4a6, WARPED_WART_BLOCK: 0x167e86,
  AZALEA_LEAVES: 0x5a7a2c, FLOWERING_AZALEA_LEAVES: 0x7a7a4c,
  SHROOMLIGHT: 0xf09246, MOSS_BLOCK: 0x596e2d,
  PALE_HANGING_MOSS: 0x7d8a78, WEEPING_VINES: 0xa3261c, WEEPING_VINES_PLANT: 0x8f1d16,
  // 26.3+
  POPLAR_LOG: 0x8c8676, POPLAR_WOOD: 0x8c8676, STRIPPED_POPLAR_LOG: 0xd8c9a2, STRIPPED_POPLAR_WOOD: 0xd8c9a2,
  YELLOW_POPLAR_LEAVES: 0xd8b02a, ORANGE_POPLAR_LEAVES: 0xd6731f, RED_POPLAR_LEAVES: 0xb0321f,
  MUSHROOM_STEM: 0xcdc6ba, RED_MUSHROOM_BLOCK: 0xc4282a, BROWN_MUSHROOM_BLOCK: 0x96714f,
  VINE: 0x2f6b14,
};
export const TRANSLUCENT = (name) => name.endsWith('_LEAVES') || name === 'VINE' || name.endsWith('ROOTS') || name === 'PALE_HANGING_MOSS' || name.startsWith('WEEPING_VINES');
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
  const has = (opts && opts.hasMaterial) || undefined;
  const types = voxels.woodTypes.map((w) => treeTypeMaterials(w, has));
  const woodIds = types.map((t) => table.id(t.wood));
  const leafIds = types.map((t) => table.id(t.leaf));
  const hangIds = types.map((t) => (t.hanging ? table.id(t.hanging) : 0));
  const tipIds = types.map((t) => (t.hangingTip ? table.id(t.hangingTip) : 0));
  let vine = -1;
  for (let i = 0; i < voxels.n; i++) {
    const k = voxels.kind[i];
    if (k === KIND_VINE && vine < 0) vine = table.id('VINE');
    out[i] = k === KIND_WOOD ? woodIds[voxels.wood[i]] : k === KIND_LEAF ? leafIds[voxels.wood[i]] : k === KIND_VINE ? vine : k === KIND_HANGING ? (voxels.orient[i] === 1 ? tipIds : hangIds)[voxels.wood[i]] : 0;
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
const LOG_FAMILIES = ['OAK', 'SPRUCE', 'BIRCH', 'JUNGLE', 'ACACIA', 'DARK_OAK', 'MANGROVE', 'CHERRY', 'PALE_OAK', 'POPLAR'];
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
 *        insertion order matters (= config order); null/empty -> the wood type's own leaves (the
 *        tree's TreeType leafMix when it has one, as WoodStyle.fromConfig)
 * @param {(name: string) => boolean} [opts.hasMaterial]  see treeTypeMaterials
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
  let leafEntries = o.leaves ? Object.entries(o.leaves).map(([m, w]) => [m, w | 0]).filter(([, w]) => w > 0) : [];
  if (!leafEntries.length && voxels.woodTypes.length) {
    // woodTypes[0] is the tree file's WoodType (render.js registers it first)
    leafEntries = treeTypeMaterials(voxels.woodTypes[0], o.hasMaterial || undefined).leafMix || [];
  }
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
