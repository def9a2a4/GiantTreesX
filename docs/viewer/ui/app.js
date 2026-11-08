// Main thread: UI, three.js scene, meshing. Generation runs in the worker (ui/worker.js).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { PARAM_DEFS, ENUMS, ParamDB, paramDbToXml, xmlHeaderComment } from '../src/params.js';
import { BLOCK_COLORS, TRANSLUCENT, treeTypeMaterials } from '../src/materials.js';
import { mesh, voxelAt } from './mesher.js';
import { loadPluginTrees, biomeLabel } from './trees.js';
import { buildAtlas } from './textures.js';

const $ = (id) => document.getElementById(id);
let BUNDLED = []; // filled at boot by loadPluginTrees()
const DEFAULT_STYLE = { style: 'mixed', hollowChance: 0, hollowWallThickness: 2 }; // config.yml defaults

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------
const S = {
  entry: null, // bundled entry {name, treeXml, rootXml, spawnsIn}
  treeName: '', // passed to renderTree (MANGROVE rule)
  files: {
    tree: { db: null, base: null, header: '', label: '' },
    root: { db: null, base: null, header: '', label: '' },
  },
  useRoot: true,
  seed: 12345,
  tab: 'tree',
  style: { style: 'mixed', hollowChance: 0, forceHollow: false, hollowWallThickness: 2, leaves: [] },
  styleVersion: 0,
  data: null, // last good generate result (+ mat)
  meshResult: null,
  timing: {},
};

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------
function showError(title, text) {
  $('errorTitle').textContent = title;
  $('errorText').textContent = text || '';
  $('error').hidden = false;
}
function clearError() {
  $('error').hidden = true;
}
$('errorClose').onclick = clearError;
window.addEventListener('error', (e) => showError('Page error', String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => showError('Page error', String(e.reason && e.reason.message || e.reason)));

// ---------------------------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------------------------
const workerUrl = new URL('./worker.js', import.meta.url);
let worker = null;
let genId = 0; // id of the latest generate request
let genBusy = false;
let genSentStyle = 0; // styleVersion included with the in-flight generate
let matId = 0;
let genSentAt = 0;

function startWorker() {
  worker = new Worker(workerUrl, { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    e.preventDefault();
    genBusy = false;
    setBusy(false);
    showError('Worker crashed', `${e.message || 'unknown error'}${e.lineno ? ` (line ${e.lineno})` : ''}`);
    worker.terminate();
    startWorker();
  };
}
startWorker();

function setBusy(on, text) {
  $('busy').hidden = !on;
  if (text) $('busyText').textContent = text;
}

function styleForWorker() {
  const st = S.style;
  const leaves = {};
  for (const [m, w] of st.leaves) {
    const name = String(m).trim().toUpperCase();
    if (name && +w > 0) leaves[name] = (leaves[name] || 0) + Math.floor(+w);
  }
  return {
    style: st.style,
    hollowChance: st.hollowChance,
    forceHollow: st.forceHollow,
    hollowWallThickness: st.hollowWallThickness,
    leaves: Object.keys(leaves).length ? leaves : null,
  };
}

function requestGenerate() {
  const tree = S.files.tree.db;
  if (!tree) return;
  if (genBusy) {
    // a generate is still running: kill it, results would be stale anyway
    worker.terminate();
    startWorker();
  }
  const id = ++genId;
  genBusy = true;
  genSentStyle = S.styleVersion;
  genSentAt = performance.now();
  setBusy(true, 'Generating');
  const root = S.useRoot ? S.files.root.db : null;
  worker.postMessage({
    type: 'generate',
    id,
    treeEntries: [...tree.values.entries()],
    rootEntries: root ? [...root.values.entries()] : null,
    rootXml: null,
    seed: S.seed,
    treeName: S.treeName,
    style: styleForWorker(),
  });
}

function requestMaterials() {
  S.styleVersion++;
  updateYaml();
  if (genBusy || !S.data) return; // picked up when the generate result arrives
  const id = ++matId;
  worker.postMessage({ type: 'materials', id, style: styleForWorker(), styleVersion: S.styleVersion });
}

function onWorkerMessage(e) {
  const d = e.data;
  if (d.type === 'result') {
    if (d.id !== genId) return; // stale
    genBusy = false;
    setBusy(false);
    clearError();
    d.timing.roundTrip = performance.now() - genSentAt;
    const first = !S.lastTreeKey || S.lastTreeKey !== S.treeKey;
    S.lastTreeKey = S.treeKey;
    d.treeKey = S.treeKey;
    S.data = d;
    S.timing = d.timing;
    onNewData(first);
    if (genSentStyle !== S.styleVersion) requestMaterials();
  } else if (d.type === 'materials') {
    if (d.id !== matId || !S.data) return;
    S.data.mat = d.mat;
    S.data.matNames = d.matNames;
    S.data.usedStyle = d.usedStyle;
    S.timing.material = d.timing.material;
    rebuildMesh();
    updateStats();
    updateStyleNotice();
  } else if (d.type === 'error') {
    if (d.op === 'generate' && d.id !== genId) return;
    if (d.op === 'generate') { genBusy = false; setBusy(false); }
    showError(d.op === 'generate' ? 'Generation failed (the previous tree is still shown)' : 'Material pass failed', d.message + (d.stack ? '\n\n' + d.stack.split('\n').slice(0, 6).join('\n') : ''));
  }
}

// ---------------------------------------------------------------------------------------------
// three.js scene
// ---------------------------------------------------------------------------------------------
const canvas = $('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb3d0);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
camera.position.set(90, 60, 90);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 30, 0);
controls.screenSpacePanning = true;
controls.addEventListener('change', requestRender);

const meshGroup = new THREE.Group();
scene.add(meshGroup);
const opaqueMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const transMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
// vines: thin panels with a cut-out texture, visible from both sides
const cutMat = new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
let atlas = null; // { texture, tiles, plain, uv } for the current block names

/** (Re)builds the placeholder texture atlas when the set of block names changes. */
function ensureAtlas(names) {
  const key = names.join(',');
  if (atlas && atlas.key === key) return atlas;
  if (atlas) atlas.texture.dispose();
  const a = buildAtlas(names, BLOCK_COLORS, MISSING);
  const texture = new THREE.CanvasTexture(a.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  for (const m of [opaqueMat, transMat, cutMat]) {
    m.map = texture;
    m.needsUpdate = true;
  }
  atlas = { ...a, texture, key };
  return atlas;
}

let gridGroup = new THREE.Group();
scene.add(gridGroup);
const slicePlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
);
slicePlane.visible = false;
scene.add(slicePlane);
// the view cut: a faint vertical sheet with an outline, where the blocks were cut away
const viewCutVisual = new THREE.Group();
{
  const geo = new THREE.PlaneGeometry(1, 1);
  viewCutVisual.add(
    new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })),
    new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.8 })),
  );
}
viewCutVisual.visible = false;
viewCutVisual.renderOrder = 2;
scene.add(viewCutVisual);

function buildGrid(bb) {
  scene.remove(gridGroup);
  gridGroup.traverse((o) => o.geometry && o.geometry.dispose());
  gridGroup = new THREE.Group();
  const ext = Math.max(Math.abs(bb.minX), Math.abs(bb.maxX), Math.abs(bb.minZ), Math.abs(bb.maxZ)) + 8;
  const half = Math.ceil(ext / 16) * 16;
  const size = half * 2;
  const fine = new THREE.GridHelper(size, size, 0x5c7083, 0x5c7083);
  fine.material.transparent = true;
  fine.material.opacity = 0.35;
  const coarse = new THREE.GridHelper(size, size / 16, 0x2d3d4c, 0x2d3d4c);
  coarse.position.y = 0.002;
  gridGroup.add(fine, coarse);
  // axis hints: +X east (red), +Z south (blue), from the tree base
  const axes = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0.01, 0, 8, 0.01, 0, 0, 0.01, 0, 0, 0.01, 8], 3));
  axes.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.2, 0.2, 1, 0.2, 0.2, 0.2, 0.4, 1, 0.2, 0.4, 1], 3));
  gridGroup.add(new THREE.LineSegments(axes, new THREE.LineBasicMaterial({ vertexColors: true })));
  gridGroup.visible = $('showGrid').checked;
  scene.add(gridGroup);
}

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderer.render(scene, camera);
  });
}
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(canvas.parentElement);

function fitCamera() {
  const m = S.meshResult;
  if (!m) return;
  const bb = m.bbox;
  const lo = view.showRoots ? bb.minY : Math.max(0, bb.minY);
  const cy = (lo + bb.maxY + 1) / 2;
  const spanH = Math.hypot(bb.maxX - bb.minX, bb.maxZ - bb.minZ) + 2;
  const spanV = bb.maxY - lo + 3;
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const dist = Math.max(spanV / (2 * tanV), spanH / (2 * tanV * camera.aspect)) * 1.1 + spanH / 2;
  controls.target.set((bb.minX + bb.maxX + 1) / 2, cy, (bb.minZ + bb.maxZ + 1) / 2);
  const dir = new THREE.Vector3(1, 0.3, 1.25).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  camera.near = Math.max(0.1, dist / 500);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
  requestRender();
}

// ---------------------------------------------------------------------------------------------
// Materials -> colours
// ---------------------------------------------------------------------------------------------
const linColor = (hex) => {
  const c = new THREE.Color().setHex(hex); // sRGB hex -> linear (ColorManagement)
  return [c.r, c.g, c.b];
};
const MISSING = 0xff00ff;
function matInfoFor(names) {
  return names.map((n) => ({
    name: n,
    air: n === 'AIR' || n === 'CAVE_AIR' || n === 'VOID_AIR',
    translucent: TRANSLUCENT(n),
    hex: BLOCK_COLORS[n] ?? MISSING,
  }));
}
const LEVEL_COLORS = [0xc9772f, 0xd9c24a, 0x55b3d9, 0xb46ad6, 0xe06a8a].map(linColor);
const KIND_COLORS = { leaf: linColor(0x4f8a2a), vine: linColor(0x2f6b14) };
const PART_COLORS = [linColor(0xb98b52), linColor(0x6d8fd8), linColor(0xe0533d)];

function colorForFn(mode, d) {
  if (mode === 'level') {
    return (i) => {
      const k = d.kind[i];
      if (k === 2) return KIND_COLORS.leaf;
      if (k >= 3) return KIND_COLORS.vine;
      const l = d.level[i];
      return LEVEL_COLORS[Math.max(0, Math.min(LEVEL_COLORS.length - 1, l))];
    };
  }
  if (mode === 'part') {
    return (i) => (d.kind[i] === 1 ? PART_COLORS[d.part[i]] || PART_COLORS[0] : d.kind[i] === 2 ? KIND_COLORS.leaf : KIND_COLORS.vine);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Meshing
// ---------------------------------------------------------------------------------------------
const view = {
  showLeaves: true, showRoots: true, showVines: true, translucent: false, colorBy: 'block',
  sliceAxis: '', slicePos: 0, sliceFlip: false, maxY: null,
  viewCut: false, viewCutDepth: 0, // view cut: plane through target + depth * view direction
};

function disposeMeshes() {
  for (const o of meshGroup.children) o.geometry.dispose();
  meshGroup.clear();
}

function toGeometry(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(b.col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
  g.setIndex(new THREE.BufferAttribute(b.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function rebuildMesh() {
  const d = S.data;
  if (!d) return;
  const info = matInfoFor(d.matNames);
  const at = ensureAtlas(d.matNames);
  const cutPlane = view.viewCut ? viewCutPlane() : null;
  const colorFor = colorForFn(view.colorBy, d);
  // colour-by modes tint a plain white tile; block mode shows the block's texture
  const tileOf = d.matNames.map((n) => at.tiles.get(n));
  const tileFor = colorFor && view.colorBy !== 'block'
    ? (i) => (d.kind[i] >= 3 ? tileOf[d.mat[i]].side : at.plain) // cards keep their cut-out
    : (i, end) => (end ? tileOf[d.mat[i]].end : tileOf[d.mat[i]].side);
  const m = mesh(d, {
    matInfo: info,
    tileFor,
    tileUV: at.uv,
    colorFor,
    showLeaves: view.showLeaves,
    showRoots: view.showRoots,
    showVines: view.showVines,
    translucent: view.translucent,
    slice: { axis: view.sliceAxis || null, pos: view.slicePos, keep: view.sliceFlip ? 'upper' : 'lower' },
    maxY: view.maxY,
    plane: cutPlane,
  });
  disposeMeshes();
  for (const c of m.chunks) {
    if (c.opaque) meshGroup.add(new THREE.Mesh(toGeometry(c.opaque), opaqueMat));
    if (c.trans) {
      const tm = new THREE.Mesh(toGeometry(c.trans), transMat);
      tm.renderOrder = 1;
      meshGroup.add(tm);
    }
    if (c.cut) meshGroup.add(new THREE.Mesh(toGeometry(c.cut), cutMat));
  }
  S.meshResult = m;
  S.matInfo = info;
  S.timing.mesh = m.ms;
  updateSlicePlane();
  updateViewCutVisual(cutPlane);
  requestRender();
}

// ---------------------------------------------------------------------------------------------
// New data from the worker
// ---------------------------------------------------------------------------------------------
function onNewData(first) {
  rebuildMesh();
  const bb = S.meshResult.bbox;
  // keep cut sliders inside the new bounds
  const axisMin = view.sliceAxis === 'z' ? bb.minZ : bb.minX;
  const axisMax = view.sliceAxis === 'z' ? bb.maxZ : bb.maxX;
  setRange('slicePos', 'slicePosNum', axisMin, axisMax);
  setRange('maxY', 'maxYNum', bb.minY, bb.maxY);
  if (view.maxY == null) { $('maxY').value = bb.maxY; $('maxYNum').value = bb.maxY; }
  if (first) {
    buildGrid(bb);
    fitCamera();
  }
  updateInfo();
  updateStats();
  updateStyleNotice();
  updateYaml();
}

function setRange(sliderId, numId, min, max) {
  for (const id of [sliderId, numId]) {
    $(id).min = min;
    $(id).max = max;
  }
}

function updateInfo() {
  const d = S.data;
  if (!d) return;
  const bb = S.meshResult.bbox;
  const w = bb.maxX - bb.minX + 1, dpt = bb.maxZ - bb.minZ + 1;
  const parts = [`<b>${esc(d.treeWoodType)}</b>`];
  if (d.rootWoodType && d.rootWoodType !== d.treeWoodType) parts[0] += ` <span title="root file WoodType">(roots: ${esc(d.rootWoodType)})</span>`;
  parts.push(`${w} × ${dpt} wide`);
  parts.push(`<b>${bb.maxY + 1}</b> tall`);
  if (bb.minY < 0) parts.push(`roots ${-bb.minY} deep`);
  parts.push(`${d.n.toLocaleString()} blocks`);
  $('treeInfo').innerHTML = parts.join(' · ');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function updateStats() {
  const d = S.data;
  if (!d) return;
  const counts = new Map();
  let air = 0;
  const kinds = [0, 0, 0, 0, 0];
  const parts = [0, 0, 0];
  let topY = -Infinity;
  for (let i = 0; i < d.n; i++) {
    const name = d.matNames[d.mat[i]];
    if (name === 'AIR') { air++; continue; }
    counts.set(name, (counts.get(name) || 0) + 1);
    kinds[d.kind[i]]++;
    parts[d.part[i]]++;
    if (d.part[i] !== 1) topY = Math.max(topY, d.y[i] + d.yOffset);
  }
  const bb = S.meshResult.bbox;
  const t = S.timing;
  const f = (v) => (v == null ? '–' : `${v.toFixed(0)} ms`);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) =>
    `<tr><td><span class="sw" style="background:#${(BLOCK_COLORS[n] ?? MISSING).toString(16).padStart(6, '0')}"></span>${esc(n)}</td><td class="num">${c.toLocaleString()}</td></tr>`).join('');
  const total = d.n - air;
  $('stats').innerHTML = `<table>
    ${rows}
    <tr class="sep"><td class="k">Total blocks</td><td class="num">${total.toLocaleString()}</td></tr>
    ${air ? `<tr><td class="k">Hollowed out (air)</td><td class="num">${air.toLocaleString()}</td></tr>` : ''}
    <tr><td class="k">Wood / leaves / vines + hanging</td><td class="num">${kinds[1].toLocaleString()} / ${kinds[2].toLocaleString()} / ${(kinds[3] + (kinds[4] || 0)).toLocaleString()}</td></tr>
    <tr><td class="k">Tree / roots / junction</td><td class="num">${parts[0].toLocaleString()} / ${parts[1].toLocaleString()} / ${parts[2].toLocaleString()}</td></tr>
    <tr class="sep"><td class="k">Bounding box (x × y × z)</td><td class="num">${bb.maxX - bb.minX + 1} × ${bb.maxY - bb.minY + 1} × ${bb.maxZ - bb.minZ + 1}</td></tr>
    <tr><td class="k">X range / Z range</td><td class="num">${bb.minX}..${bb.maxX} / ${bb.minZ}..${bb.maxZ}</td></tr>
    <tr><td class="k">Height above ground</td><td class="num">${topY === -Infinity ? '–' : topY + 1}</td></tr>
    <tr><td class="k">Lowest block (y)</td><td class="num">${bb.minY}</td></tr>
    <tr><td class="k">scale_tree</td><td class="num">${(+d.scaleTree).toFixed(2)}</td></tr>
    <tr class="sep"><td class="k">Arbaro (geometry)</td><td class="num">${f(t.arbaro)}</td></tr>
    <tr><td class="k">Generate total</td><td class="num">${f(t.total)}</td></tr>
    <tr><td class="k">Material pass</td><td class="num">${f(t.material)}</td></tr>
    <tr><td class="k">Worker round trip</td><td class="num">${f(t.roundTrip)}</td></tr>
    <tr><td class="k">Meshing (${(S.meshResult.faces).toLocaleString()} faces)</td><td class="num">${f(t.mesh)}</td></tr>
  </table>`;
}

function updateStyleNotice() {
  const d = S.data;
  const el = $('styleNotice');
  if (d && !d.usedStyle) {
    el.hidden = false;
    el.textContent = 'The generator port does not export woodStyleAssign yet, so blocks show the plugin default (all logs, own leaves). Style settings still produce the config snippet.';
  } else el.hidden = true;
}

// ---------------------------------------------------------------------------------------------
// Hover picking
// ---------------------------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverQueued = false;
let lastPointer = null;
canvas.addEventListener('pointermove', (e) => {
  lastPointer = e;
  if (hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    pick(lastPointer);
  });
});
canvas.addEventListener('pointerleave', () => { $('hover').textContent = ''; });
function pick(e) {
  const m = S.meshResult;
  const d = S.data;
  if (!m || !d || e.buttons) return;
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(meshGroup.children, false);
  if (!hits.length) { $('hover').textContent = ''; return; }
  const h = hits[0];
  let X, Y, Z;
  if (h.object.material === cutMat) {
    // vine cards cross diagonally through their own cell, so the hit triangle's centre lies inside
    // it (stepping back along the diagonal normal, as for block faces, can land in a neighbour)
    const p = h.object.geometry.attributes.position;
    const { a, b, c } = h.face;
    X = Math.floor((p.getX(a) + p.getX(b) + p.getX(c)) / 3);
    Y = Math.floor((p.getY(a) + p.getY(b) + p.getY(c)) / 3);
    Z = Math.floor((p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3);
  } else {
    const n = h.face.normal;
    X = Math.floor(h.point.x - n.x * 0.5); Y = Math.floor(h.point.y - n.y * 0.5); Z = Math.floor(h.point.z - n.z * 0.5);
  }
  const i = voxelAt(m, X, Y, Z);
  if (i < 0) { $('hover').textContent = ''; return; }
  const kind = ['', 'wood', 'leaf', 'vine', 'hanging'][d.kind[i]];
  const part = ['tree', 'root', 'junction'][d.part[i]];
  const lvl = d.kind[i] === 1 ? ` level ${d.level[i]}` : '';
  $('hover').textContent = `${X}, ${Y}, ${Z}  ${d.matNames[d.mat[i]]}  ${kind}${lvl}  ${part}`;
}

// ---------------------------------------------------------------------------------------------
// View + cross-section controls
// ---------------------------------------------------------------------------------------------
let meshQueued = false;
function queueMesh() {
  if (meshQueued) return;
  meshQueued = true;
  requestAnimationFrame(() => {
    meshQueued = false;
    rebuildMesh();
    updateStats();
  });
}
for (const [id, key] of [['showLeaves', 'showLeaves'], ['showRoots', 'showRoots'], ['showVines', 'showVines'], ['translucent', 'translucent']]) {
  $(id).addEventListener('change', () => { view[key] = $(id).checked; queueMesh(); });
}
$('colorBy').addEventListener('change', () => { view.colorBy = $('colorBy').value; queueMesh(); });
$('showGrid').addEventListener('change', () => { gridGroup.visible = $('showGrid').checked; requestRender(); });
$('resetCamera').onclick = fitCamera;

function bindPair(sliderId, numId, onValue) {
  const s = $(sliderId), n = $(numId);
  s.addEventListener('input', () => { n.value = s.value; onValue(+s.value); });
  n.addEventListener('input', () => { if (n.value !== '' && Number.isFinite(+n.value)) { s.value = n.value; onValue(+n.value); } });
}
bindPair('slicePos', 'slicePosNum', (v) => { view.slicePos = Math.round(v); queueMesh(); });
bindPair('maxY', 'maxYNum', (v) => {
  const top = S.meshResult ? S.meshResult.bbox.maxY : Infinity;
  view.maxY = v >= top ? null : Math.round(v);
  queueMesh();
});
$('sliceAxis').addEventListener('change', () => {
  view.sliceAxis = $('sliceAxis').value;
  $('sliceRow').style.opacity = view.sliceAxis ? 1 : 0.4;
  if (S.meshResult) {
    const bb = S.meshResult.bbox;
    setRange('slicePos', 'slicePosNum', view.sliceAxis === 'z' ? bb.minZ : bb.minX, view.sliceAxis === 'z' ? bb.maxZ : bb.maxX);
  }
  queueMesh();
});
$('sliceRow').style.opacity = 0.4;
$('sliceFlip').addEventListener('change', () => { view.sliceFlip = $('sliceFlip').checked; queueMesh(); });
$('clearSlice').onclick = () => {
  view.sliceAxis = '';
  $('sliceAxis').value = '';
  $('sliceRow').style.opacity = 0.4;
  view.maxY = null;
  view.viewCut = false;
  $('viewCut').checked = false;
  $('viewCutRow').style.opacity = 0.4;
  if (S.meshResult) { $('maxY').value = S.meshResult.bbox.maxY; $('maxYNum').value = S.meshResult.bbox.maxY; }
  queueMesh();
};

/**
 * The view-cut plane: vertical, facing away from the camera (the view direction with its up/down
 * part removed, so a tilted camera still cuts the trunk straight down), through the orbit target
 * moved `depth` along it.
 */
function viewCutPlane() {
  const n = new THREE.Vector3().subVectors(controls.target, camera.position);
  n.y = 0;
  if (n.lengthSq() < 1e-6) n.set(0, 0, -1); // looking straight down: cut along z
  n.normalize();
  const p0 = controls.target.clone().addScaledVector(n, view.viewCutDepth);
  return { nx: n.x, ny: n.y, nz: n.z, d: -n.dot(p0) };
}

function setViewCutRange() {
  const m = S.meshResult;
  if (!m) return;
  const bb = m.bbox;
  const r = Math.ceil(Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY, bb.maxZ - bb.minZ) / 2) + 2;
  setRange('viewCutDepth', 'viewCutDepthNum', -r, r);
}

$('viewCut').addEventListener('change', () => {
  view.viewCut = $('viewCut').checked;
  $('viewCutRow').style.opacity = view.viewCut ? 1 : 0.4;
  setViewCutRange();
  queueMesh();
});
$('viewCutRow').style.opacity = 0.4;
bindPair('viewCutDepth', 'viewCutDepthNum', (v) => { view.viewCutDepth = Math.round(v); if (view.viewCut) queueMesh(); });
// the plane follows the camera once orbiting stops (re-meshing on every frame would be too slow)
controls.addEventListener('end', () => { if (view.viewCut) queueMesh(); });

/** Places the view-cut sheet on the plane the blocks were cut along, sized to the tree. */
function updateViewCutVisual(pl) {
  const m = S.meshResult;
  if (!m || !pl) { viewCutVisual.visible = false; return; }
  const bb = m.bbox;
  const n = new THREE.Vector3(pl.nx, pl.ny, pl.nz);
  const centre = new THREE.Vector3((bb.minX + bb.maxX + 1) / 2, (bb.minY + bb.maxY + 1) / 2, (bb.minZ + bb.maxZ + 1) / 2);
  // the point on the plane nearest the tree's centre
  centre.addScaledVector(n, -(n.dot(centre) + pl.d));
  viewCutVisual.position.copy(centre);
  viewCutVisual.rotation.set(0, Math.atan2(n.x, n.z), 0); // the sheet's +z normal onto n
  viewCutVisual.scale.set(Math.hypot(bb.maxX - bb.minX, bb.maxZ - bb.minZ) + 6, bb.maxY - bb.minY + 6, 1);
  viewCutVisual.visible = true;
}

function updateSlicePlane() {
  const m = S.meshResult;
  if (!m || !view.sliceAxis) { slicePlane.visible = false; return; }
  const bb = m.bbox;
  const h = bb.maxY - bb.minY + 6, cy = (bb.minY + bb.maxY + 1) / 2;
  // the kept half includes the cut coordinate, so the plane sits on its far face
  const p = view.slicePos + (view.sliceFlip ? 0 : 1);
  slicePlane.visible = true;
  if (view.sliceAxis === 'x') {
    const w = bb.maxZ - bb.minZ + 6;
    slicePlane.scale.set(w, h, 1);
    slicePlane.rotation.set(0, Math.PI / 2, 0);
    slicePlane.position.set(p, cy, (bb.minZ + bb.maxZ + 1) / 2);
  } else {
    const w = bb.maxX - bb.minX + 6;
    slicePlane.scale.set(w, h, 1);
    slicePlane.rotation.set(0, 0, 0);
    slicePlane.position.set((bb.minX + bb.maxX + 1) / 2, cy, p);
  }
}

// ---------------------------------------------------------------------------------------------
// Wood style panel
// ---------------------------------------------------------------------------------------------
const LEAF_MATS = Object.keys(BLOCK_COLORS).filter((n) => n.endsWith('_LEAVES') || n.endsWith('_WART_BLOCK') || n.endsWith('_MUSHROOM_BLOCK') || n === 'SHROOMLIGHT');
$('leafMaterials').innerHTML = LEAF_MATS.map((n) => `<option value="${n}">`).join('');

$('woodStyle').addEventListener('change', () => { S.style.style = $('woodStyle').value; requestMaterials(); });
bindPair('hollowChance', 'hollowChanceNum', (v) => { S.style.hollowChance = Math.max(0, Math.min(100, v)); requestMaterials(); });
$('forceHollow').addEventListener('change', () => { S.style.forceHollow = $('forceHollow').checked; requestMaterials(); });
$('wallThickness').addEventListener('input', () => {
  const v = parseInt($('wallThickness').value, 10);
  if (v >= 1) { S.style.hollowWallThickness = v; requestMaterials(); }
});

function treeWoodType() {
  return S.files.tree.db ? S.files.tree.db.get('WoodType') : S.data ? S.data.treeWoodType : 'Oak';
}
function ownLeaf() {
  const wt = treeWoodType();
  return treeTypeMaterials(wt).leaf;
}

function renderLeafRows() {
  const box = $('leafRows');
  box.innerHTML = '';
  S.style.leaves.forEach((row, k) => {
    const el = document.createElement('div');
    el.className = 'leaf-row';
    const sw = document.createElement('span');
    sw.className = 'sw';
    const name = document.createElement('input');
    name.setAttribute('list', 'leafMaterials');
    name.value = row[0];
    name.spellcheck = false;
    const w = document.createElement('input');
    w.type = 'number';
    w.min = 0;
    w.step = 1;
    w.value = row[1];
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Remove';
    const paint = () => {
      const c = BLOCK_COLORS[name.value.trim().toUpperCase()];
      sw.style.background = c == null ? 'repeating-linear-gradient(45deg,#f0f 0 3px,#000 3px 6px)' : '#' + c.toString(16).padStart(6, '0');
      sw.title = c == null ? 'No preview colour for this block (shown magenta)' : '';
    };
    paint();
    name.addEventListener('input', () => { row[0] = name.value; paint(); requestMaterials(); });
    w.addEventListener('input', () => { row[1] = Math.max(0, parseInt(w.value, 10) || 0); requestMaterials(); });
    del.onclick = () => { S.style.leaves.splice(k, 1); renderLeafRows(); requestMaterials(); };
    el.append(sw, name, w, del);
    box.append(el);
  });
}
$('leafAdd').onclick = () => {
  if (!S.style.leaves.length) S.style.leaves.push([ownLeaf(), 9]);
  S.style.leaves.push(['FLOWERING_AZALEA_LEAVES', 1]);
  renderLeafRows();
  requestMaterials();
};
$('leafClear').onclick = () => { S.style.leaves = []; renderLeafRows(); requestMaterials(); };
$('yamlScope').addEventListener('change', updateYaml);

function yamlNum(v) {
  return Number.isInteger(v) ? String(v) : String(+v);
}
function yamlKey(k) {
  return /^[A-Za-z_][\w ]*[\w]$|^[A-Za-z_]$/.test(k) ? k : JSON.stringify(k);
}
function buildYaml() {
  const st = S.style;
  const wt = treeWoodType();
  const scope = $('yamlScope').value;
  const cur = { style: st.style, hollow_chance: st.hollowChance, hollow_wall_thickness: st.hollowWallThickness };
  const base = { style: DEFAULT_STYLE.style, hollow_chance: DEFAULT_STYLE.hollowChance, hollow_wall_thickness: DEFAULT_STYLE.hollowWallThickness };
  const global = scope === 'global' ? cur : base;
  const override = {};
  if (scope === 'type') for (const k of Object.keys(cur)) if (cur[k] !== base[k]) override[k] = cur[k];
  const leaves = styleForWorker().leaves;
  const own = ownLeaf();
  const leavesNeeded = leaves && !(Object.keys(leaves).length === 1 && leaves[own]);
  const out = ['wood:'];
  out.push(`  style: ${global.style}`);
  out.push(`  hollow_chance: ${yamlNum(global.hollow_chance)}`);
  out.push(`  hollow_wall_thickness: ${yamlNum(global.hollow_wall_thickness)}`);
  if (!Object.keys(override).length && !leavesNeeded) {
    out.push('wood_types: {}');
  } else {
    out.push('wood_types:');
    out.push(`  ${yamlKey(wt)}:`);
    for (const [k, v] of Object.entries(override)) out.push(`    ${k}: ${typeof v === 'number' ? yamlNum(v) : v}`);
    if (leavesNeeded) {
      out.push('    leaves:');
      for (const [m, w] of Object.entries(leaves)) out.push(`      ${m}: ${w}`);
    }
  }
  return out.join('\n') + '\n';
}
function updateYaml() {
  let y = buildYaml();
  if (S.style.forceHollow) y += '# "Force hollow" is a preview switch; the plugin rolls hollow_chance per tree.\n';
  $('yamlOut').textContent = y;
}
$('copyYaml').onclick = async () => {
  const text = buildYaml();
  try {
    await navigator.clipboard.writeText(text);
    flash($('copyYaml'), 'Copied');
  } catch {
    // file:// pages may not get clipboard access; fall back to a selection copy
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    flash($('copyYaml'), ok ? 'Copied' : 'Copy failed: select the text above');
  }
};
function flash(btn, text) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1400);
}

// ---------------------------------------------------------------------------------------------
// Param editor
// ---------------------------------------------------------------------------------------------
const GROUPS = [
  { id: 'general', title: 'General', match: (d) => d.group === 'SHAPE' || d.group === 'QUALITY' },
  { id: 'trunk', title: 'Trunk (level 0)', match: (d) => d.group === 'TRUNK' || d.level === 0, level: 0 },
  { id: 'l1', title: 'Level 1', match: (d) => d.level === 1, level: 1 },
  { id: 'l2', title: 'Level 2', match: (d) => d.level === 2, level: 2 },
  { id: 'l3', title: 'Level 3', match: (d) => d.level === 3, level: 3 },
  { id: 'leaves', title: 'Leaves', match: (d) => d.group === 'LEAVES' },
  { id: 'pruning', title: 'Pruning', match: (d) => d.group === 'PRUNING' },
  { id: 'unused', title: 'Not used by the generator', match: (d) => d.group === 'UNUSED', unused: true },
];
const SUBGROUP_ORDER = { TRUNK: 0, LENTAPER: 1, BRANCHING: 2, SPLITTING: 3, CURVATURE: 4 };
const LEAF_LEVEL_PARAMS = new Set(['DownAngle', 'DownAngleV', 'Rotate', 'RotateV']);
const openGroups = new Set(['general', 'trunk', 'l1']);
let paramRows = new Map(); // name -> {el, def, input, num, slider, err}

function enumOptions(def) {
  return def.enum ? ENUMS[def.enum] : null;
}

function softRange(def, db, base) {
  let min = def.min, max = def.max;
  const vals = [db.get(def.name), base ? base.get(def.name) : def.deflt, def.deflt].map(Number).filter(Number.isFinite);
  const big = Math.max(1, ...vals.map((v) => Math.abs(v) * 2));
  if (!Number.isFinite(min)) min = -Math.max(big, Number.isFinite(max) ? Math.abs(max) : 0);
  if (!Number.isFinite(max)) max = Math.max(big, min + 1);
  return [min, max];
}

function fmtVal(def, v) {
  if (def.type === 'float') return String(Math.round(v * 1e6) / 1e6);
  return String(v);
}

function buildParamEditor() {
  const f = S.files[S.tab];
  const box = $('paramGroups');
  box.innerHTML = '';
  paramRows = new Map();
  $('fileLabel').innerHTML = f.label ? `Editing <b>${esc(f.label)}</b>` : 'No file';
  $('useRootWrap').style.display = S.tab === 'root' ? '' : 'none';
  if (!f.db) {
    box.innerHTML = '<div class="rows"><p class="hint">This tree has no root file. Import a .root.xml to add one.</p></div>';
    return;
  }
  const levels = f.db.get('Levels');
  for (const g of GROUPS) {
    const defs = PARAM_DEFS.filter(g.match).sort((a, b) => (SUBGROUP_ORDER[a.group] ?? 9) - (SUBGROUP_ORDER[b.group] ?? 9) || a.order - b.order);
    if (!defs.length) continue;
    const det = document.createElement('details');
    det.className = 'pgroup' + (g.unused ? ' unused' : '');
    det.open = openGroups.has(g.id);
    det.addEventListener('toggle', () => { if (det.open) openGroups.add(g.id); else openGroups.delete(g.id); });
    const sum = document.createElement('summary');
    sum.textContent = g.title;
    if (g.level !== undefined && g.level > levels) sum.innerHTML += ` <span class="gnote">unused (Levels = ${levels})</span>`;
    else if (g.level !== undefined && g.level === levels) sum.innerHTML += ` <span class="gnote">leaf level: only angles used</span>`;
    det.append(sum);
    for (const def of defs) det.append(buildRow(def, f, levels));
    box.append(det);
  }
  applyFilter();
}

function buildRow(def, f, levels) {
  const row = document.createElement('div');
  row.className = 'prow';
  const label = document.createElement('div');
  label.className = 'pname';
  label.textContent = def.name;
  label.title = `${def.name}: ${def.shortDesc}\n\n${def.longDesc}\n\nrange ${def.min ?? '-'} .. ${def.max ?? '-'}, default ${def.deflt}`;
  const reset = document.createElement('button');
  reset.className = 'preset';
  reset.textContent = '↺';
  reset.title = 'Reset to the bundled value';
  const err = document.createElement('div');
  err.className = 'perr';
  const opts = enumOptions(def);
  const cur = f.db.get(def.name);
  let input, slider = null;
  if (opts) {
    row.classList.add('wide');
    input = document.createElement('select');
    opts.forEach((o, k) => {
      const op = document.createElement('option');
      op.value = def.type === 'int' ? String(k) : o;
      op.textContent = def.type === 'int' ? `${k} - ${o}` : o;
      input.append(op);
    });
    if (def.type === 'string' && !opts.includes(cur)) {
      const op = document.createElement('option');
      op.value = cur;
      op.textContent = `${cur} (not a known value)`;
      input.append(op);
    }
    input.value = String(cur);
    input.addEventListener('change', () => commit(def, input.value, row));
    row.append(label, input, reset);
  } else if (def.type === 'string') {
    row.classList.add('wide');
    input = document.createElement('input');
    input.type = 'text';
    input.value = cur;
    input.addEventListener('input', () => commit(def, input.value, row));
    row.append(label, input, reset);
  } else {
    const [min, max] = softRange(def, f.db, f.base);
    slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = def.type === 'int' ? 1 : Math.max((max - min) / 400, 1e-4);
    slider.value = cur;
    input = document.createElement('input');
    input.type = 'number';
    input.step = def.type === 'int' ? 1 : 'any';
    if (Number.isFinite(def.min)) input.min = def.min;
    if (Number.isFinite(def.max)) input.max = def.max;
    input.value = fmtVal(def, cur);
    slider.addEventListener('input', () => {
      const v = def.type === 'int' ? String(Math.round(+slider.value)) : fmtVal(def, +slider.value);
      input.value = v;
      commit(def, v, row);
    });
    input.addEventListener('input', () => {
      if (commit(def, input.value, row) && Number.isFinite(+input.value)) slider.value = input.value;
    });
    row.append(label, slider, input, reset);
  }
  row.append(err);
  reset.onclick = () => {
    const v = f.base ? f.base.get(def.name) : def.deflt;
    if (f.base && !f.base.has(def.name)) f.db.values.delete(def.name);
    else f.db.values.set(def.name, v);
    input.value = opts ? String(v) : def.type === 'string' ? v : fmtVal(def, v);
    if (slider) slider.value = v;
    input.classList.remove('invalid');
    err.textContent = '';
    paramChanged(def);
    markRow(def, row);
  };
  // level params beyond Levels are ignored by Arbaro; on the leaf level only the angles count
  if (def.level >= 0) {
    const base = def.name.slice(1);
    if (def.level > levels || (def.level === levels && !LEAF_LEVEL_PARAMS.has(base))) row.classList.add('unusedrow');
  }
  paramRows.set(def.name, { row, def, input, slider, err });
  markRow(def, row);
  return row;
}

function markRow(def, row) {
  const f = S.files[S.tab];
  const baseV = f.base ? f.base.get(def.name) : def.deflt;
  row.classList.toggle('modified', f.db.get(def.name) !== baseV);
}

function commit(def, raw, row) {
  const f = S.files[S.tab];
  const r = paramRows.get(def.name);
  try {
    f.db.set(def.name, raw);
  } catch (e) {
    r.input.classList.add('invalid');
    r.err.textContent = e.message;
    return false;
  }
  r.input.classList.remove('invalid');
  r.err.textContent = '';
  markRow(def, row);
  paramChanged(def);
  return true;
}

let regenTimer = 0;
function paramChanged(def) {
  if (def.name === 'WoodType' && S.tab === 'tree') updateYaml();
  if (def.name === 'Levels') {
    // re-render so the unused-level dimming follows; keep focus on the Levels input
    clearTimeout(levelsTimer);
    levelsTimer = setTimeout(() => {
      const scroll = $('paramGroups').scrollTop;
      buildParamEditor();
      $('paramGroups').scrollTop = scroll;
    }, 600);
  }
  if (S.tab === 'root' && !S.useRoot) return;
  clearTimeout(regenTimer);
  regenTimer = setTimeout(requestGenerate, 250);
}
let levelsTimer = 0;

function applyFilter() {
  const q = $('paramFilter').value.trim().toLowerCase();
  for (const { row, def } of paramRows.values()) {
    row.classList.toggle('hidden', !!q && !def.name.toLowerCase().includes(q) && !def.shortDesc.toLowerCase().includes(q));
  }
  if (q) for (const d of document.querySelectorAll('#paramGroups details')) d.open = true;
}
$('paramFilter').addEventListener('input', applyFilter);

for (const t of document.querySelectorAll('.tab')) {
  t.onclick = () => {
    S.tab = t.dataset.tab;
    for (const o of document.querySelectorAll('.tab')) o.classList.toggle('active', o === t);
    buildParamEditor();
  };
}
$('useRoot').addEventListener('change', () => { S.useRoot = $('useRoot').checked; requestGenerate(); });
$('toggleParams').onclick = () => { document.body.classList.toggle('hide-params'); };

// ---------------------------------------------------------------------------------------------
// Import / export / reset
// ---------------------------------------------------------------------------------------------
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('exportBtn').onclick = () => {
  const f = S.files[S.tab];
  if (!f.db) return;
  const xml = paramDbToXml(f.db, f.header);
  const base = (f.label || (S.tab === 'root' ? 'tree.root.xml' : 'tree.xml')).replace(/^imported:\s*/, '');
  download(base, xml);
};
$('resetTab').onclick = () => {
  const which = S.tab;
  loadFileFromXml(which, which === 'tree' ? S.entry.treeXml : S.entry.rootXml, S.entry.name + (which === 'root' ? '.root.xml' : '.xml'), true);
  if (which === 'tree') S.treeName = S.entry.name + '.xml';
  buildParamEditor();
  requestGenerate();
};
$('importBtn').onclick = () => $('fileInput').click();
$('fileInput').addEventListener('change', () => {
  importFiles([...$('fileInput').files]);
  $('fileInput').value = '';
});

async function importFiles(files) {
  let changed = false;
  for (const file of files) {
    const text = await file.text();
    const which = /\.root\.xml$/i.test(file.name) ? 'root' : 'tree';
    try {
      ParamDB.fromXml(text); // validate first
    } catch (e) {
      showError(`Could not import ${file.name}`, e.message);
      continue;
    }
    loadFileFromXml(which, text, file.name, false);
    if (which === 'tree') S.treeName = file.name;
    if (which === 'root') { S.useRoot = true; $('useRoot').checked = true; }
    S.tab = which;
    changed = true;
  }
  if (changed) {
    for (const o of document.querySelectorAll('.tab')) o.classList.toggle('active', o.dataset.tab === S.tab);
    buildParamEditor();
    requestGenerate();
  }
}

// drag and drop anywhere on the page
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('drop').hidden = false; e.preventDefault(); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter((f) => /\.xml$/i.test(f.name));
  if (files.length) importFiles(files);
});

/** Load an XML file into the tree/root slot. `bundled` = it is the picker's own file. */
function loadFileFromXml(which, xml, label, bundled) {
  const f = S.files[which];
  if (xml == null) {
    f.db = null; f.base = null; f.header = ''; f.label = '';
    return;
  }
  const db = ParamDB.fromXml(xml);
  f.db = db;
  f.header = xmlHeaderComment(xml);
  f.label = bundled ? label : `imported: ${label}`;
  // "modified" markers compare against the bundled file of the selected tree when there is one
  const bundledXml = S.entry ? (which === 'tree' ? S.entry.treeXml : S.entry.rootXml) : null;
  f.base = bundledXml ? ParamDB.fromXml(bundledXml) : db.clone();
}

// ---------------------------------------------------------------------------------------------
// Tree picker + seed
// ---------------------------------------------------------------------------------------------
function buildPicker() {
  const sel = $('treeSelect');
  for (const t of BUNDLED) {
    const op = document.createElement('option');
    op.value = t.name;
    op.textContent = t.name + (t.spawnsIn.length ? `  (${t.spawnsIn.map(biomeLabel).join(', ')})` : '');
    sel.append(op);
  }
}

function selectTree(name) {
  const entry = BUNDLED.find((t) => t.name === name) || BUNDLED.find((t) => t.name === 'tree.OAK') || BUNDLED[0];
  const oldLeaf = S.files.tree.db ? ownLeaf() : null;
  S.entry = entry;
  S.treeName = entry.name + '.xml';
  S.treeKey = entry.name + ':' + Math.random();
  $('treeSelect').value = entry.name;
  try {
    loadFileFromXml('tree', entry.treeXml, entry.name + '.xml', true);
    loadFileFromXml('root', entry.rootXml, entry.name + '.root.xml', true);
  } catch (e) {
    showError(`Could not parse ${entry.name}`, e.message);
    return;
  }
  // a different wood type has different own leaves: carry the mix over by swapping them
  const newLeaf = ownLeaf();
  if (oldLeaf && oldLeaf !== newLeaf && S.style.leaves.some((r) => r[0] === oldLeaf)) {
    for (const r of S.style.leaves) if (r[0] === oldLeaf) r[0] = newLeaf;
    renderLeafRows();
    requestMaterials();
  }
  updateYaml();
  buildParamEditor();
  saveHash();
  requestGenerate();
}

$('treeSelect').addEventListener('change', () => selectTree($('treeSelect').value));
$('seed').addEventListener('change', () => {
  const v = Math.trunc(+$('seed').value);
  if (!Number.isFinite(v)) return;
  S.seed = v | 0; // the plugin passes an int seed
  $('seed').value = S.seed;
  saveHash();
  requestGenerate();
});
$('seedRandom').onclick = () => {
  S.seed = (Math.random() * 4294967296) | 0;
  $('seed').value = S.seed;
  saveHash();
  requestGenerate();
};

function saveHash() {
  try {
    history.replaceState(null, '', `#tree=${encodeURIComponent(S.entry.name)}&seed=${S.seed}`);
  } catch { /* file:// in some browsers */ }
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
try {
  BUNDLED = await loadPluginTrees();
} catch (e) {
  showError('Could not load the plugin\'s trees', e.message);
  throw e;
}
buildPicker();
renderLeafRows();
updateYaml();
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('capture') === '1') document.body.classList.add('capture');
if (hash.has('seed') && Number.isFinite(+hash.get('seed'))) S.seed = +hash.get('seed') | 0;
$('seed').value = S.seed;
selectTree(hash.get('tree') || 'tree.OAK');
resize();
/** True once the current tree is generated and meshed (the gallery generator waits for this). */
function isIdle() {
  return !genBusy && !meshQueued && !!S.meshResult && !!S.data;
}

/**
 * Renders one gallery view (used by docs/viewer/scripts/gallery.mjs).
 * azimuth/elevation in degrees around the tree; zoom > 1 moves closer; focus 0..1 picks the
 * height the camera looks at (0 = lowest block, 1 = top; default: the middle), focusY an absolute
 * height (0 = the ground the tree is planted on); viewCut = depth
 * of a camera-facing cut plane relative to the tree's centre, or null for none.
 */
function shot({ azimuth = 40, elevation = 18, zoom = 1, focus = null, focusY = null, viewCut = null, showLeaves = true, showRoots = true }) {
  view.showLeaves = showLeaves;
  view.showRoots = showRoots;
  $('showLeaves').checked = showLeaves;
  $('showRoots').checked = showRoots;
  view.viewCut = viewCut != null;
  view.viewCutDepth = viewCut ?? 0;
  rebuildMesh(); // bbox for the current toggles
  const bb = S.meshResult.bbox;
  const lo = showRoots ? bb.minY : Math.max(0, bb.minY);
  const cy = focusY != null ? focusY : focus == null ? (lo + bb.maxY + 1) / 2 : lo + (bb.maxY + 1 - lo) * focus;
  // close-ups aim at the trunk (x = z = 0, where the plugin plants the tree); whole-tree shots
  // aim at the middle of the bounding box
  if (focusY != null) controls.target.set(0.5, cy, 0.5);
  else controls.target.set((bb.minX + bb.maxX + 1) / 2, cy, (bb.minZ + bb.maxZ + 1) / 2);
  const az = (azimuth * Math.PI) / 180, el = (elevation * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  // fit: move the camera until the bounding box's corners fill ~92% of the frame
  const corners = [];
  for (const X of [bb.minX, bb.maxX + 1]) for (const Y of [lo, bb.maxY + 1]) for (const Z of [bb.minZ, bb.maxZ + 1]) corners.push(new THREE.Vector3(X, Y, Z));
  let dist = Math.hypot(bb.maxX - bb.minX, bb.maxY - lo, bb.maxZ - bb.minZ) * 1.5;
  const place = (d) => {
    camera.position.copy(controls.target).addScaledVector(dir, d);
    camera.near = Math.max(0.1, d / 500);
    camera.far = d * 20;
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  for (let k = 0; k < 6; k++) {
    place(dist);
    let extent = 0;
    for (const c of corners) {
      const p = c.clone().project(camera);
      extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
    }
    dist *= Math.max(0.5, Math.min(2, extent / 0.92));
  }
  place(dist / zoom);
  controls.update();
  rebuildMesh(); // the view cut depends on the camera
  renderer.render(scene, camera);
}

window.__treePreview = { S, view, rebuildMesh, requestGenerate, isIdle, shot }; // debugging, tests, gallery
