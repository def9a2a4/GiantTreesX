#!/usr/bin/env node
// Block counts and dimensions of trees over a set of seeds, from the viewer's JS port of the
// plugin's generator (docs/viewer/src/render.js), so no server or browser is needed.
import { cli, die, parseSeeds, resolveAll, readText, RES } from './lib/common.mjs';
import { renderTree } from '../docs/viewer/src/render.js';
import { makeVoxelView, MaterialTable, woodStyleAssign, woodStyleMode, WOOD_STYLE_MODES } from '../docs/viewer/src/materials.js';
import { KIND_WOOD, KIND_LEAF, PART_ROOT } from '../docs/viewer/src/voxels.js';

const USAGE = `
Usage: node scripts/tree-stats.mjs [options] TREE...

Generates each tree for every seed and prints its block counts and size. TREE is a name in
src/main/resources/tree ("OAK" = tree.OAK, wildcards like "tree.*_HUGE") or a path to a tree .xml
file anywhere (its .root.xml next to it is used if present). Lists may be comma-separated.

Columns: blocks placed (after the wood style; hollow trunks remove blocks), wood / leaf / vine
(vines + hanging moss) / root blocks, height above the ground, crown width (largest x or z extent
of everything but the roots), root depth below the ground, trunk radius at some heights above the
tree's base (the radius of a disc with the trunk's cross-section area; split trunks count
together; MANGROVE files start their tree above the ground, on their roots: 18 blocks for the
giant, 10 for _HUGE, 7 for _BIG) and the generation time.

Options:
  -s, --seeds LIST      seeds: numbers and ranges, e.g. 12345,7 or 1..10 (default 12345,1..9)
  -t, --trunk-at LIST   heights above the tree's base for the trunk radius (default 2,6,12)
      --style STYLE     wood style for the block counts: ${WOOD_STYLE_MODES.join(', ')} (default mixed)
      --hollow          carve hollow trunks (as with hollow_chance 100)
  -m, --materials       also print the average count of each block material
      --summary         one line per tree (min-max and median over the seeds), no per-seed rows
      --format FMT      text (default), csv or json
  -d, --dir DIR         where tree names are looked up (default src/main/resources/tree)
  -h, --help

Examples:
  node scripts/tree-stats.mjs OAK OAK_HUGE
  node scripts/tree-stats.mjs --seeds 1..20 --summary 'tree.*_HUGE'
  node scripts/tree-stats.mjs -m --style mixed_stripped --seeds 12345 tree.DARK_OAK
  node scripts/tree-stats.mjs --format csv .temp/work/tree.FOO.xml > foo.csv
`;

const { values: o, positionals } = cli(USAGE, {
  seeds: { type: 'string', short: 's', default: '12345,1..9' },
  'trunk-at': { type: 'string', short: 't', default: '2,6,12' },
  style: { type: 'string', default: 'mixed' },
  hollow: { type: 'boolean' },
  materials: { type: 'boolean', short: 'm' },
  summary: { type: 'boolean' },
  format: { type: 'string', default: 'text' },
  dir: { type: 'string', short: 'd', default: RES },
});
if (!positionals.length) die(USAGE.trim());
if (!woodStyleMode(o.style)) die(`--style must be one of ${WOOD_STYLE_MODES.join(', ')}`);
if (!['text', 'csv', 'json'].includes(o.format)) die('--format must be text, csv or json');
const seeds = parseSeeds(o.seeds);
const trunkAt = parseSeeds(o['trunk-at']);
const trees = resolveAll(positionals, { dir: o.dir });

/** Stats of one generated tree. */
function measure(tree, seed) {
  const t0 = performance.now();
  const r = renderTree({ treeXml: readText(tree.file), rootXml: tree.rootFile ? readText(tree.rootFile) : null, seed, treeName: tree.name + '.xml' });
  const ms = performance.now() - t0;
  const view = makeVoxelView(r);
  const table = new MaterialTable();
  const mat = woodStyleAssign(view, { style: o.style, forceHollow: !!o.hollow, seed }, table);
  const air = table.names.indexOf('AIR');
  const s = r.store;
  const yOff = r.refPoint.y - 64; // store y is relative to refPoint; the tree is planted at y 64
  const row = { seed, blocks: 0, wood: 0, leaf: 0, vine: 0, root: 0, height: 0, width: 0, rootDepth: 0 };
  let top = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, rootMin = 0;
  const trunkArea = new Map(trunkAt.map((h) => [h, 0]));
  const mats = {};
  for (let i = 0; i < s.n; i++) {
    if (mat[i] === air) continue;
    row.blocks++;
    const name = table.names[mat[i]];
    mats[name] = (mats[name] || 0) + 1;
    const y = s.y[i] + yOff;
    if (s.part[i] === PART_ROOT) {
      row.root++;
      rootMin = Math.min(rootMin, y);
      continue;
    }
    if (s.kind[i] === KIND_WOOD) {
      row.wood++;
      // trunk heights count from the tree's base (refPoint), which MANGROVE files raise above the ground
      if (s.level[i] === 0 && trunkArea.has(s.y[i])) trunkArea.set(s.y[i], trunkArea.get(s.y[i]) + 1);
    } else if (s.kind[i] === KIND_LEAF) row.leaf++;
    else row.vine++;
    if (y > top) top = y;
    if (s.x[i] < minX) minX = s.x[i];
    if (s.x[i] > maxX) maxX = s.x[i];
    if (s.z[i] < minZ) minZ = s.z[i];
    if (s.z[i] > maxZ) maxZ = s.z[i];
  }
  row.height = top + 1;
  row.width = Math.max(maxX - minX, maxZ - minZ) + 1;
  row.rootDepth = -rootMin;
  for (const [h, a] of trunkArea) row[`r@${h}`] = +Math.sqrt(a / Math.PI).toFixed(1);
  row.ms = Math.round(ms);
  return { row, mats };
}

const COLS = ['blocks', 'wood', 'leaf', 'vine', 'root', 'height', 'width', 'rootDepth', ...trunkAt.map((h) => `r@${h}`), 'ms'];
const median = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const summarize = (rows) => Object.fromEntries(COLS.map((c) => {
  const v = rows.map((r) => r[c]);
  const med = v.every(Number.isInteger) ? Math.round(median(v)) : +median(v).toFixed(1);
  return [c, { min: Math.min(...v), median: med, max: Math.max(...v) }];
}));

const results = [];
const failed = [];
for (const tree of trees) {
  const rows = [];
  const matTotals = {};
  for (const seed of seeds) {
    let m;
    try { m = measure(tree, seed); } catch (e) { failed.push(`${tree.name} seed ${seed}: ${String(e.message).trim()}`); continue; }
    const { row, mats } = m;
    rows.push(row);
    for (const [k, v] of Object.entries(mats)) matTotals[k] = (matTotals[k] || 0) + v;
  }
  if (!rows.length) continue;
  const materials = Object.fromEntries(Object.entries(matTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / seeds.length)]));
  const res = { tree: tree.name, file: tree.file, rootFile: tree.rootFile, rows, summary: summarize(rows), ...(o.materials ? { materials } : {}) };
  results.push(res);
  if (o.format === 'text' && !o.summary) printRows(res);
}
if (o.format === 'text' && o.summary) printSummary(results);
if (o.format === 'json') console.log(JSON.stringify(results, null, 2));
if (o.format === 'csv') {
  console.log(['tree', 'seed', ...COLS].join(','));
  for (const r of results) for (const row of r.rows) console.log([r.tree, row.seed, ...COLS.map((c) => row[c])].join(','));
}

function printRows(res) {
  console.log(`${res.tree}${res.rootFile ? '' : ' (no root file)'}`);
  const w = COLS.map((c) => Math.max(c.length, ...res.rows.map((r) => String(r[c]).length)));
  const sw = Math.max(4, ...res.rows.map((r) => String(r.seed).length));
  const line = (first, vals) => console.log(`  ${String(first).padStart(sw)}  ${vals.map((v, i) => String(v).padStart(w[i])).join('  ')}`);
  line('seed', COLS);
  for (const r of res.rows) line(r.seed, COLS.map((c) => r[c]));
  if (res.rows.length > 1) for (const k of ['min', 'median', 'max']) line(k.slice(0, 3), COLS.map((c) => res.summary[c][k]));
  printMaterials(res);
  console.log('');
}

function printSummary(results) {
  const range = (s) => (s.min === s.max ? `${s.min}` : `${s.min}-${s.max} (${s.median})`);
  const rows = [['tree', ...COLS], ...results.map((r) => [r.tree, ...COLS.map((c) => range(r.summary[c]))])];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((v, i) => (i ? v.padStart(w[i]) : v.padEnd(w[i]))).join('  '));
  if (seeds.length > 1) console.log(`(min-max (median) over ${seeds.length} seeds)`);
  for (const r of results) if (r.materials) { console.log(`\n${r.tree}`); printMaterials(r); }
}

function printMaterials(res) {
  if (!res.materials) return;
  console.log(`  materials (average over ${seeds.length} seed${seeds.length > 1 ? 's' : ''}, style ${o.style}${o.hollow ? ', hollow' : ''}):`);
  for (const [k, v] of Object.entries(res.materials)) console.log(`    ${k.padEnd(28)} ${v}`);
}

if (failed.length) {
  console.error('failed:\n  ' + failed.join('\n  '));
  process.exit(1);
}
