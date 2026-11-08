// Port of TreeRenderer.renderTree orchestration (minus scheduling / world application),
// MinecraftExporter / MinecraftStemExporter / MinecraftSegmentExporter / MinecraftLeafExporter,
// JungleVinePopulator and LeafDecorator.
import { Tree } from './tree.js';
import { ParamDB } from './params.js';
import { Draw3d, orient } from './draw3d.js';
import { VoxelStore, KIND_WOOD, KIND_LEAF, KIND_VINE, KIND_HANGING, PART_TREE, PART_ROOT } from './voxels.js';
import { treeTypeMaterials, DECORATION_TRUNK_VINES, DECORATION_LEAF_VINES, DECORATION_HANGING } from './materials.js';
import { locationHashCode, SimplexNoiseGenerator, positionHash } from './noise.js';
import { hashMapIterationOrder } from './javamap.js';
import { JavaRandom } from './jrandom.js';

function loadTree(db, seed) {
  const tree = new Tree(db.clone());
  tree.params.Seed = seed | 0;
  tree.params.stopLevel = -1;
  tree.params.verbose = false;
  return tree;
}

/** MinecraftExporter.write() */
function exportTree(tree, d3d) {
  const stopLevel = tree.params.stopLevel;
  // stems (MinecraftStemExporter + MinecraftSegmentExporter)
  tree.traverseTree({
    enterStem(stem) {
      if (stem.stemlevel < stopLevel || stopLevel === -1) {
        stem.traverseStem({
          enterSegment(s) {
            const level = s.lpar.level;
            const ss = s.subsegments;
            for (let i = 0; i < ss.length - 1; i++) {
              const l1 = d3d.toMcVector(ss[i].pos);
              const l2 = d3d.toMcVector(ss[i + 1].pos);
              const o = orient(l1, l2);
              d3d.drawCone(l1, ss[i].rad, l2, ss[i + 1].rad, level);
              const dx = l1.x - l2.x, dy = l1.y - l2.y, dz = l1.z - l2.z;
              if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 1) {
                d3d.drawWoodSphere(l2, ss[i + 1].rad, o, level);
              }
            }
            return true;
          },
          visitSubsegment() {
            return false;
          },
        });
      }
      return true;
    },
    visitLeaf() {
      return false;
    },
  });
  // leaves
  if (tree.params.Leaves > 0) {
    tree.traverseTree({
      visitLeaf(leaf) {
        d3d.drawLeafCluster(d3d.toMcVector(leaf.transf.vector), leaf.par.LeafScale / 2, (leaf.par.LeafScaleX * leaf.par.LeafScale) / 2);
        return true;
      },
    });
  }
}

/** JungleVinePopulator.populate(tracker, new Random(seed)) */
function populateVines(store, seed) {
  const r = new JavaRandom(seed);
  const { order, treeified } = hashMapIterationOrder(store);
  const newChanges = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (store.kind[i] !== KIND_WOOD) continue; // isLog(): every wood material Draw3d emits is a *_LOG / MANGROVE_ROOTS
    const x = store.x[i], y = store.y[i], z = store.z[i];
    if (r.nextInt(3) > 0 && !store.has(x, y, z - 1)) newChanges.push(x, y, z - 1, 0); // north, faces SOUTH
    if (r.nextInt(3) > 0 && !store.has(x, y, z + 1)) newChanges.push(x, y, z + 1, 1); // south, faces NORTH
    if (r.nextInt(3) > 0 && !store.has(x + 1, y, z)) newChanges.push(x + 1, y, z, 2); // east, faces WEST
    if (r.nextInt(3) > 0 && !store.has(x - 1, y, z)) newChanges.push(x - 1, y, z, 3); // west, faces EAST
  }
  for (let j = 0; j < newChanges.length; j += 4) {
    store.add(newChanges[j], newChanges[j + 1], newChanges[j + 2], KIND_VINE, -1, newChanges[j + 3], PART_TREE, 0, false);
  }
  return { treeified };
}

// ---- LeafDecorator ----
const VINE_ONE_IN = 10, VINE_MIN = 2, VINE_MAX = 8;
const HANGING_SPARSER = 2; // LeafDecorator.HANGING_SPARSER: thins the type's hangingOneIn
const SIDES = [[0, -1], [0, 1], [1, 0], [-1, 0]]; // N, S, E, W; vine face index = side index
/** LeafDecorator.hash (= Draw3d's leaf jitter hash). */
export const decoHash = positionHash;
const floorMod = (a, n) => ((a % n) + n) % n;

/** LeafDecorator.populate: vines down leaf sides or hanging blocks below leaves. */
function decorateLeaves(store, treeType, seed) {
  const decoration = treeType.decoration;
  const n = store.n; // only blocks the tree had before decorating are tested
  if (decoration === DECORATION_LEAF_VINES) {
    const cells = new Map(); // "x,y,z" -> [x, y, z, face]; where strands meet the lower face wins
    for (let i = 0; i < n; i++) {
      if (store.kind[i] !== KIND_LEAF) continue;
      const x = store.x[i], y = store.y[i], z = store.z[i];
      for (let s = 0; s < 4; s++) {
        const h = decoHash(seed, x, y, z, s);
        if (floorMod(h, VINE_ONE_IN) !== 0) continue;
        const vx = x + SIDES[s][0], vz = z + SIDES[s][1];
        const length = VINE_MIN + floorMod(h >>> 8, VINE_MAX - VINE_MIN + 1);
        for (let vy = y; vy > y - length && vy >= 1; vy--) {
          if (store.has(vx, vy, vz)) break;
          const key = `${vx},${vy},${vz}`;
          const old = cells.get(key);
          if (!old || s < old[3]) cells.set(key, [vx, vy, vz, s]);
        }
      }
    }
    for (const [vx, vy, vz, s] of cells.values()) store.add(vx, vy, vz, KIND_VINE, -1, s, PART_TREE, 0, false);
  } else if (decoration === DECORATION_HANGING) {
    // TreeType hangingOneIn / hangingMin / hangingMax; orient 1 = tip (TreeType.hangingTipMaterial)
    const [typeOneIn, HANGING_MIN, HANGING_MAX] = treeType.hangingShape;
    const HANGING_ONE_IN = typeOneIn * HANGING_SPARSER;
    const added = [];
    for (let i = 0; i < n; i++) {
      if (store.kind[i] !== KIND_LEAF) continue;
      const x = store.x[i], y = store.y[i], z = store.z[i];
      const h = decoHash(seed, x, y, z, 4);
      if (floorMod(h, HANGING_ONE_IN) !== 0) continue;
      const length = HANGING_MIN + floorMod(h >>> 8, HANGING_MAX - HANGING_MIN + 1);
      let bottom = y;
      for (let vy = y - 1; vy >= y - length && vy >= 1; vy--) {
        if (store.has(x, vy, z)) break;
        bottom = vy;
      }
      for (let vy = y - 1; vy >= bottom; vy--) added.push(x, vy, z, vy === bottom ? 1 : 0);
    }
    for (let j = 0; j < added.length; j += 4) store.add(added[j], added[j + 1], added[j + 2], KIND_HANGING, -1, added[j + 3], PART_TREE, 0, false);
  }
}

/**
 * TreeRenderer.mangroveRaise: blocks a tree file is raised so its stilt roots show. Files whose
 * name contains MANGROVE, by tier: 18 for the giant, 10 for _HUGE, 5 for _BIG; 0 otherwise.
 */
export function mangroveRaise(fileName) {
  if (!fileName.includes('MANGROVE')) return 0;
  const name = fileName.endsWith('.xml') ? fileName.slice(0, -4) : fileName;
  if (name.endsWith('_BIG')) return 7;
  if (name.endsWith('_HUGE')) return 10;
  return 18;
}

/**
 * Render a tree exactly like TreeRenderer.renderTree, up to (not including) WoodStyler: the
 * store holds the tracker's changes with their raw TreeType materials. Run woodStyleAssign
 * (materials.js) on makeVoxelView(result) for the blocks the plugin actually places.
 * Verified block for block against the plugin by scripts/check.sh (see harness/README.md).
 *
 * @param {object} o
 * @param {string|ParamDB} o.treeXml   tree param file (XML string) or a ParamDB
 * @param {string|ParamDB|null} [o.rootXml]
 * @param {number} o.seed            int seed passed to renderTree
 * @param {{x:number,y:number,z:number}} [o.refPoint]  Location (world null) - default 0,64,0
 * @param {string} [o.treeName]      file name; "MANGROVE" in it raises refPoint (see mangroveRaise)
 * @param {number} [o.worldHash]     World.hashCode() contribution to Location.hashCode (0 = null world)
 * @param {(name: string) => boolean} [o.hasMaterial]  blocks the server has (TreeType fallbacks)
 */
export function renderTree(o) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const seed = o.seed | 0;
  const treeDb = o.treeXml instanceof ParamDB ? o.treeXml : ParamDB.fromXml(o.treeXml);
  const rootDb = o.rootXml == null ? null : o.rootXml instanceof ParamDB ? o.rootXml : ParamDB.fromXml(o.rootXml);
  const ref = { ...(o.refPoint || { x: 0, y: 64, z: 0 }) };

  const store = new VoxelStore();
  const woodTypes = [];
  const woodIndex = (name) => {
    let i = woodTypes.indexOf(name);
    if (i < 0) { woodTypes.push(name); i = woodTypes.length - 1; }
    return i;
  };

  const tree = loadTree(treeDb, seed);
  if (o.treeName) ref.y += mangroveRaise(o.treeName);
  ref.hash = locationHashCode(ref.x, ref.y, ref.z, 0, 0, o.worldHash || 0);

  tree.make();
  const tTree = (typeof performance !== 'undefined' ? performance : Date).now();
  const noise = new SimplexNoiseGenerator(ref.hash);
  const treeType = treeTypeMaterials(tree.params.WoodType, o.hasMaterial || undefined);
  const d3d = new Draw3d(ref, tree.params.Smooth, woodIndex(tree.params.WoodType), store, false, PART_TREE, noise);
  d3d.capLevel = treeType.capLevel;
  d3d.noisyLeaves = treeType.noisyLeaves;
  exportTree(tree, d3d);

  let vineInfo = null;
  if (treeType.decoration === DECORATION_TRUNK_VINES) {
    vineInfo = populateVines(store, seed);
  }

  const trunk0 = tree.trunks[0];
  // ((Segment) trunk.stemSegments().nextElement()).posFrom()  (throws in Java if the trunk has no segments)
  if (!trunk0 || trunk0.segments.length === 0) throw new Error('Trunk has no segments (Java would throw NoSuchElementException here)');
  d3d.drawRootJunction(d3d.toMcVector(trunk0.segments[0].posFrom()), trunk0.baseRadius);

  let root = null;
  if (rootDb) {
    root = loadTree(rootDb, seed);
    root.params.Leaves = -1;
    root.params.scale_tree = tree.params.scale_tree;
    root.make();
    const d3dInv = new Draw3d(ref, root.params.Smooth, woodIndex(root.params.WoodType), store, true, PART_ROOT, noise);
    d3dInv.cache = d3d.cache; // same generator -> same values
    d3dInv.capLevel = treeTypeMaterials(root.params.WoodType, o.hasMaterial || undefined).capLevel;
    exportTree(root, d3dInv);
  }
  decorateLeaves(store, treeType, seed);
  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  return {
    store,
    woodTypes,
    refPoint: ref,
    treeParams: tree.params,
    rootParams: root ? root.params : null,
    scaleTree: tree.params.scale_tree,
    vineInfo,
    timing: { arbaro: tTree - t0, total: t1 - t0 },
  };
}
