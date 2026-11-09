#!/usr/bin/env node
// Compares the JS port against the plugin's real Java code (harness/GeometryHarness), block for
// block, plus the WoodStyler pass for a set of wood styles. A digest of every Draw3d call's double
// arguments is reported too, for information only.
//
// The port uses the JS engine's Math.sin/cos/pow. HotSpot on x86_64 uses Intel LIBM intrinsics
// that differ from those in the last bit for a few percent of inputs, so a handful of blocks can
// come out differently. Each job passes when its mismatched blocks (geometry, and each wood style)
// stay within --tolerance (a fraction of the tree's blocks, default 0.001 = 0.1%).
//
//   node scripts/equivalence.mjs [--seeds 1,12345,-7] [--ref '0,64,0;123,70,-456'] [--trees OAK,JUNGLE]
//                                [--styles 'mixed/0/2/-;...' | --no-styles]
//                                [--quick] [--keep] [--quiet] [--tolerance 0.001]
//
// --quick: one ref point and two seeds (what scripts/check.sh runs by default).
// Exit code: 0 all within tolerance, 1 any job over it, 2 setup problem.
// Requires harness/build.sh to have been run (which requires `mvn -B -q package`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledTrees } from './bundled.mjs';
import { renderTree } from '../src/render.js';
import { Draw3d } from '../src/draw3d.js';
import { treeTypeMaterials, makeVoxelView, MaterialTable, woodStyleAssign } from '../src/materials.js';
import { KIND_WOOD, KIND_LEAF, KIND_VINE, KIND_HANGING, packKey } from '../src/voxels.js';
import { javaBin } from './env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes('--' + name);
const quick = flag('quick');
const quiet = flag('quiet');
const tolerance = Number(opt('tolerance', '0.001'));

// Style specs: mode/hollowChance/wallThickness/leaves ('-' or MAT:w+MAT:w)[/patch|block], as
// GeometryHarness parses. Without the last part a leaf mix follows the wood type's patchLeaves.
const DEFAULT_STYLES = [
  'all_log/0/2/-',
  'mixed/0/2/-',
  'mixed_log/0/2/-',
  'mixed/100/2/-',
  'all_log/100/1/-',
  'mixed_stripped/100/3/OAK_LEAVES:9+FLOWERING_AZALEA_LEAVES:1+AZALEA_LEAVES:2',
  'mixed_log/0/2/OAK_LEAVES:9+FLOWERING_AZALEA_LEAVES:1+AZALEA_LEAVES:2/patch',
  'mixed/37.5/2/CHERRY_LEAVES:1',
];
const seeds = opt('seeds', quick ? '12345,-559038737' : '1,12345,-559038737').split(',').map(Number);
const refs = opt('ref', quick ? '0,64,0' : '0,64,0;123,70,-456').split(';').map((s) => s.split(',').map(Number));
const treeFilter = opt('trees', null)?.split(',');
const styles = flag('no-styles') ? [] : opt('styles', DEFAULT_STYLES.join(';')).split(';').filter(Boolean);

function styleOpts(spec, seed, hasMaterial) {
  const [style, hollow, wall, leaves, patch] = spec.split('/');
  return {
    style,
    patchLeaves: patch === undefined ? undefined : patch === 'patch',
    hollowChance: Number(hollow),
    hollowWallThickness: Number(wall),
    leaves: leaves === '-' ? null : Object.fromEntries(leaves.split('+').map((kv) => { const [m, w] = kv.split(':'); return [m, Number(w)]; })),
    seed,
    hasMaterial,
  };
}

let trees = bundledTrees();
if (treeFilter) trees = trees.filter((t) => treeFilter.some((f) => t.name === f || t.name.endsWith('.' + f)));
if (!trees.length) {
  console.error('no trees selected');
  process.exit(2);
}

const jobs = [];
for (const t of trees) {
  for (const seed of seeds) {
    for (const [x, y, z] of refs) {
      jobs.push({ id: `${t.name}__${seed}__${x}_${y}_${z}`.replace(/[^\w.-]/g, '_'), t, seed, ref: { x, y, z } });
    }
  }
}

const cpFile = join(HERE, '..', 'harness', 'build', 'run-classpath.txt');
if (!existsSync(cpFile)) {
  console.error('harness not built: run docs/viewer/harness/build.sh first');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'tree-equiv-'));
const jobsFile = join(work, 'jobs.txt');
writeFileSync(jobsFile, jobs.map((j) => [j.id, j.t.file, j.t.rootFile ?? '-', j.seed, j.ref.x, j.ref.y, j.ref.z, styles.join(';') || '-'].join('|')).join('\n') + '\n');
if (!quiet) process.stderr.write(`running Java harness on ${jobs.length} jobs (${styles.length} styles each)...\n`);
try {
  execFileSync(javaBin(), ['-cp', readFileSync(cpFile, 'utf8').trim(), 'com.ryanmichela.trees.rendering.GeometryHarness', jobsFile, work], { stdio: ['ignore', 'ignore', quiet ? 'ignore' : 'inherit'] });
} catch (e) {
  console.error('Java harness failed: ' + e.message);
  process.exit(2);
}

// ---- JS side: digest of Draw3d calls, identical to GeometryHarness.Digest ----
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const digest = { h: 17, calls: 0 };
const mixI = (v) => { digest.h = Math.imul(digest.h, 1000003) ^ v; };
const mixD = (d) => { f64[0] = d; mixI(u32[0] | 0); mixI(u32[1] | 0); };
const mixV = (v) => { mixD(v.x); mixD(v.y); mixD(v.z); };
const P = Draw3d.prototype;
const orig = { drawCone: P.drawCone, drawWoodSphere: P.drawWoodSphere, drawLeafCluster: P.drawLeafCluster, drawRootJunction: P.drawRootJunction };
P.drawCone = function (l1, rad1, l2, rad2, level) { digest.calls++; mixI(1); mixV(l1); mixD(rad1); mixV(l2); mixD(rad2); mixI(level); return orig.drawCone.call(this, l1, rad1, l2, rad2, level); };
P.drawWoodSphere = function (pos, r, o, level) { digest.calls++; mixI(2); mixV(pos); mixD(r); mixI(o); mixI(level); return orig.drawWoodSphere.call(this, pos, r, o, level); };
P.drawLeafCluster = function (pos, length, width) { digest.calls++; mixI(3); mixV(pos); mixD(length); mixD(width); return orig.drawLeafCluster.call(this, pos, length, width); };
P.drawRootJunction = function (pos, r) { digest.calls++; mixI(4); mixV(pos); mixD(r); return orig.drawRootJunction.call(this, pos, r); };

const AXIS = ['X', 'Y', 'Z']; // Draw3d.orient(): xMajor->X, yMajor->Y, zMajor->Z
const FACE = ['SOUTH', 'NORTH', 'WEST', 'EAST'];
const KIND = { [KIND_WOOD]: 'WOOD', [KIND_LEAF]: 'LEAVES', [KIND_VINE]: 'VINE', [KIND_HANGING]: 'HANGING' };

function jsRun(job, hasMaterial) {
  digest.h = 17;
  digest.calls = 0;
  const r = renderTree({ treeXml: job.t.treeXml, rootXml: job.t.rootXml, seed: job.seed, refPoint: job.ref, treeName: job.t.name + '.xml', hasMaterial });
  const s = r.store;
  const map = new Map();
  for (let i = 0; i < s.n; i++) {
    const k = s.kind[i];
    const tt = treeTypeMaterials(r.woodTypes[s.wood[i]], hasMaterial);
    const mat = k === KIND_WOOD ? tt.wood : k === KIND_LEAF ? tt.leaf : k === KIND_HANGING ? (s.orient[i] === 1 ? tt.hangingTip : tt.hanging) : 'VINE';
    const axis = k === KIND_WOOD ? AXIS[s.orient[i]] : '-';
    const face = k === KIND_VINE ? FACE[s.orient[i]] : k === KIND_HANGING && s.orient[i] === 1 ? 'TIP' : '-';
    const level = k === KIND_WOOD ? s.level[i] : -1;
    map.set(`${s.x[i]},${s.y[i]},${s.z[i]}`, `${KIND[k]},${level},${mat},${axis},${face}`);
  }
  return { map, r, digest: digest.h, calls: digest.calls };
}

let totalJava = 0, totalBad = 0, exactJobs = 0, passJobs = 0, styleBad = 0, styleChecks = 0, digestBad = 0;
const rows = [];
for (const job of jobs) {
  const jf = join(work, job.id + '.json');
  if (!existsSync(jf)) { rows.push({ job, err: 'no java output' }); continue; }
  const java = JSON.parse(readFileSync(jf, 'utf8'));
  // the Java side runs against the paper-api the plugin compiles with, which may lack newer blocks
  const absent = new Set(java.absentMaterials || []);
  const hasMaterial = (name) => !absent.has(name);
  let js, jsErr = null;
  try { js = jsRun(job, hasMaterial); } catch (e) { jsErr = String(e); }
  if (java.error || jsErr) {
    const same = !!java.error && !!jsErr;
    rows.push({ job, err: `java: ${java.error ?? 'ok'} | js: ${jsErr ?? 'ok'}`, same });
    if (same) { exactJobs++; passJobs++; }
    continue;
  }
  const jkeys = [];
  const jmap = new Map();
  for (const v of java.voxels) {
    const p = v.split(',');
    const k = `${p[0]},${p[1]},${p[2]}`;
    jkeys.push(k);
    jmap.set(k, p.slice(3).join(','));
  }
  let missing = 0, extra = 0, diff = 0;
  const examples = [];
  for (const [k, v] of jmap) {
    const w = js.map.get(k);
    if (w === undefined) { missing++; if (examples.length < 5) examples.push(`missing ${k} ${v}`); }
    else if (w !== v) { diff++; if (examples.length < 5) examples.push(`diff ${k} java=${v} js=${w}`); }
  }
  for (const [k, w] of js.map) if (!jmap.has(k)) { extra++; if (examples.length < 5) examples.push(`extra ${k} ${w}`); }

  // styled materials, compared per Java voxel present on both sides
  const styleRes = [];
  {
    const view = makeVoxelView(js.r);
    const s = js.r.store;
    const jsIndex = jkeys.map((k) => { const [x, y, z] = k.split(',').map(Number); return s.index.get(packKey(x, y, z)); });
    for (const st of java.styles) {
      const table = new MaterialTable();
      const mats = woodStyleAssign(view, styleOpts(st.spec, job.seed, hasMaterial), table);
      let bad = 0;
      for (let i = 0; i < jkeys.length; i++) {
        if (jsIndex[i] === undefined) continue;
        const want = java.matNames[st.mats[i]];
        const got = table.names[mats[jsIndex[i]]];
        if (want !== got) { if (bad === 0 && examples.length < 8) examples.push(`style ${st.spec}: ${jkeys[i]} java=${want} js=${got}`); bad++; }
      }
      styleChecks++;
      if (bad) styleBad++;
      styleRes.push(bad);
    }
  }
  const digestOk = java.drawDigest === js.digest && java.drawCalls === js.calls;
  if (!digestOk) digestBad++;
  const bad = missing + extra + diff + styleRes.reduce((a, b) => a + b, 0);
  const limit = tolerance * jmap.size;
  const pass = missing + extra + diff <= limit && styleRes.every((b) => b <= limit);
  totalJava += jmap.size;
  totalBad += missing + extra + diff;
  if (bad === 0) exactJobs++;
  if (pass) passJobs++;
  rows.push({ job, n: jmap.size, missing, extra, diff, styleRes, digestOk, calls: java.drawCalls, bad, pass, examples, hashOk: java.refHash === js.r.refPoint.hash, scaleOk: java.scaleTree === js.r.scaleTree, treeified: js.r.vineInfo?.treeified });
}

console.log('tree'.padEnd(30) + 'seed'.padStart(12) + '  ref'.padEnd(14) + 'blocks'.padStart(8) + 'draws'.padStart(7) + '  result');
for (const r of rows) {
  const { job } = r;
  const head = job.t.name.padEnd(30) + String(job.seed).padStart(12) + '  ' + `${job.ref.x},${job.ref.y},${job.ref.z}`.padEnd(12);
  if (r.err) { console.log(head + ''.padStart(15) + `  ${r.same ? 'BOTH-ERROR' : 'ERROR'} ${r.err}`); continue; }
  const geo = r.missing + r.extra + r.diff;
  const parts = [];
  parts.push(geo === 0 ? 'geometry EXACT' : `geometry MISMATCH ${geo} (${((100 * geo) / r.n).toFixed(4)}%: -${r.missing} +${r.extra} ~${r.diff})`);
  parts.push(r.digestOk ? 'draw digest EXACT' : 'draw digest differs (info)');
  if (styles.length) {
    const sb = r.styleRes.filter((b) => b).length;
    parts.push(r.styleRes.length !== styles.length ? 'styles SKIPPED' : sb === 0 ? `${styles.length} styles EXACT` : `styles differ in ${sb}/${styles.length} (max ${Math.max(...r.styleRes)} blocks)`);
  }
  const notes = [!r.hashOk && 'refHash!', !r.scaleOk && 'scale_tree!', r.treeified && 'treeified-bin'].filter(Boolean).join(' ');
  if (r.bad) parts.push(r.pass ? 'WITHIN TOLERANCE' : 'OVER TOLERANCE');
  console.log(head + String(r.n).padStart(8) + String(r.calls).padStart(7) + '  ' + parts.join(', ') + (notes ? '  [' + notes + ']' : ''));
  if (r.bad && !r.pass) for (const e of r.examples) console.log('      ' + e);
}
const ok = passJobs === rows.length;
console.log(`\n${passJobs}/${rows.length} jobs within tolerance (${tolerance}), ${exactJobs} fully exact; geometry: ${totalBad} mismatched blocks of ${totalJava}; draw digests: ${rows.length - digestBad}/${rows.length} equal; styled passes: ${styleChecks - styleBad}/${styleChecks} exact`);
if (!flag('keep')) rmSync(work, { recursive: true, force: true });
else console.log('kept outputs in ' + work);
process.exitCode = ok ? 0 : 1;
