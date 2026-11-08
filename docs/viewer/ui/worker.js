// Web Worker: runs the tree generator and the material pass off the main thread.
//
// Messages in:
//   { type: 'generate', id, treeXml | treeEntries, rootXml | rootEntries | null, seed, treeName, style }
//   { type: 'materials', id, style }            re-run only the material pass on the cached geometry
// Messages out:
//   { type: 'result', id, n, x, y, z, kind, part, level, mat, matNames, woodTypes, ... }
//   { type: 'materials', id, mat, matNames, timing }
//   { type: 'error', id, message, stack }
//
// "treeEntries" is [[name, value], ...] (ParamDB contents) so edited params reach the generator
// exactly, without an XML round trip.
import { renderTree } from '../src/render.js';
import { ParamDB } from '../src/params.js';
import * as M from '../src/materials.js';

const REF = { x: 0, y: 64, z: 0 };
let cache = null; // { result, view }

const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

function toDb(xml, entries) {
  if (entries) {
    const db = new ParamDB();
    for (const [k, v] of entries) db.values.set(k, v);
    return db;
  }
  return xml == null ? null : xml;
}

function materialPass(view, style, seed, groundY) {
  const table = new M.MaterialTable();
  const t0 = now();
  const fn = M.woodStyleAssign;
  let mat;
  let usedStyle = false;
  if (typeof fn === 'function') {
    mat = fn(view, {
      style: style.style || 'mixed',
      hollowChance: +style.hollowChance || 0,
      forceHollow: !!style.forceHollow,
      hollowWallThickness: Math.max(1, style.hollowWallThickness | 0 || 2),
      leaves: style.leaves && Object.keys(style.leaves).length ? style.leaves : null,
      seed,
      groundY, // roots reaching the (flat) ground show as muddy roots, as the plugin places them in mud

    }, table);
    usedStyle = true;
  } else {
    mat = M.defaultAssignMaterials(view, style, table);
  }
  return { mat, matNames: table.names.slice(), materialMs: now() - t0, usedStyle };
}

function post(msg, transfer) {
  (typeof self !== 'undefined' && self.postMessage ? self : globalThis).postMessage(msg, transfer || []);
}

function handle(d) {
  if (d.type === 'generate') {
    const tStart = now();
    const result = renderTree({
      treeXml: toDb(d.treeXml, d.treeEntries),
      rootXml: toDb(d.rootXml, d.rootEntries),
      seed: d.seed | 0,
      refPoint: { ...REF },
      treeName: d.treeName || '',
    });
    const view = M.makeVoxelView(result);
    // the planting block (y = 0 above ground) in store coordinates, which start at the raised ref point
    const groundY = REF.y - result.refPoint.y;
    cache = { result, view, seed: d.seed | 0, groundY };
    const m = materialPass(view, d.style || {}, d.seed | 0, groundY);
    const s = result.store;
    const n = s.n;
    const out = {
      type: 'result',
      id: d.id,
      n,
      x: s.x.slice(0, n),
      y: s.y.slice(0, n),
      z: s.z.slice(0, n),
      kind: s.kind.slice(0, n),
      part: s.part.slice(0, n),
      level: s.level.slice(0, n),
      orient: s.orient.slice(0, n),
      wood: s.wood.slice(0, n),
      mat: m.mat,
      matNames: m.matNames,
      usedStyle: m.usedStyle,
      woodTypes: result.woodTypes.slice(),
      treeWoodType: result.treeParams ? result.treeParams.WoodType : result.woodTypes[0],
      rootWoodType: result.rootParams ? result.rootParams.WoodType : null,
      scaleTree: result.scaleTree,
      // store coords are offsets from the (possibly raised) ref point; this lifts them to
      // "blocks above the planting point", so y=0 is the ground the plugin plants on
      yOffset: result.refPoint.y - REF.y,
      timing: { ...result.timing, material: m.materialMs, worker: now() - tStart },
    };
    post(out, [out.x.buffer, out.y.buffer, out.z.buffer, out.kind.buffer, out.part.buffer, out.level.buffer, out.orient.buffer, out.wood.buffer, out.mat.buffer]);
  } else if (d.type === 'materials') {
    if (!cache) throw new Error('no tree generated yet');
    const m = materialPass(cache.view, d.style || {}, cache.seed, cache.groundY);
    post({ type: 'materials', id: d.id, mat: m.mat, matNames: m.matNames, usedStyle: m.usedStyle, timing: { material: m.materialMs } }, [m.mat.buffer]);
  }
}

self.onmessage = (e) => {
  const d = e.data;
  try {
    handle(d);
  } catch (err) {
    post({ type: 'error', id: d && d.id, op: d && d.type, message: String((err && err.message) || err), stack: err && err.stack ? String(err.stack) : '' });
  }
};
