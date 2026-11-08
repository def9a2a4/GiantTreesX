#!/usr/bin/env node
// Renders the tree gallery (docs/gallery/) with the viewer in headless Chromium.
//
//   make gallery                              (from the repo root; installs Playwright on first run)
//   node docs/viewer/scripts/gallery.mjs [--seed 12345] [--trees tree.OAK,tree.JUNGLE]
//
// For every distinct tree file in docs/trees/ (byte-identical biome copies are listed as aliases)
// it writes a hero shot and three smaller views to docs/gallery/<tree>/, plus
// docs/gallery/gallery.json, which docs/index.html turns into the gallery page.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright';
import { REPO } from './bundled.mjs';
import { galleryTrees } from './gallery-trees.mjs';

const DOCS = join(REPO, 'docs');
const OUT = join(DOCS, 'gallery');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SEED = Number(opt('seed', '12345')) | 0;
const only = opt('trees', null)?.split(',');

// Shots: name, caption, viewport, view options for the viewer's shot() hook.
const HERO = { file: 'hero.jpg', caption: 'Tree', size: [720, 900], view: { azimuth: 40, elevation: 14 } };
const SMALL = [
  { file: 'cut.jpg', caption: 'Cut through the trunk', size: [480, 480], view: { azimuth: 40, elevation: 14, viewCut: 0 } },
  { file: 'top.jpg', caption: 'From above', size: [480, 480], view: { azimuth: 40, elevation: 70 } },
  { file: 'base.jpg', caption: 'Trunk base and roots', size: [480, 480], view: { azimuth: 40, elevation: 10, zoom: 2.6, focusY: 2, showLeaves: false } },
];

// ---- distinct tree files (same grouping as ui/trees.js) ----
const trees = galleryTrees(DOCS).filter((t) => !only || only.includes(t.name));

// ---- static server for docs/ ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DOCS, path);
  if (path.endsWith('/')) file = join(file, 'index.html');
  if (!file.startsWith(DOCS) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/viewer/`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: HERO.size[0], height: HERO.size[1] } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));

const entries = [];
if (!only) rmSync(OUT, { recursive: true, force: true });
for (const t of trees) {
  process.stdout.write(`${t.name} ... `);
  await page.goto('about:blank');
  await page.setViewportSize({ width: HERO.size[0], height: HERO.size[1] });
  await page.goto(`${base}#tree=${encodeURIComponent(t.name)}&seed=${SEED}&capture=1`);
  await page.waitForFunction(() => window.__treePreview?.isIdle(), null, { timeout: 120000 });
  const err = await page.evaluate(() => (document.getElementById('error').hidden ? null : document.getElementById('errorText').textContent));
  if (err) { problems.push(`${t.name}: ${err}`); console.log('error'); continue; }
  const info = await page.evaluate(() => {
    const { S } = window.__treePreview;
    const bb = S.meshResult.bbox;
    return { woodType: S.data.treeWoodType, blocks: S.data.n, height: bb.maxY + 1, width: Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ) + 1 };
  });
  const dir = join(OUT, t.name);
  mkdirSync(dir, { recursive: true });
  const images = {};
  for (const s of [HERO, ...SMALL]) {
    await page.setViewportSize({ width: s.size[0], height: s.size[1] });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // let resize() run
    await page.evaluate((v) => window.__treePreview.shot(v), s.view);
    await page.screenshot({ path: join(dir, s.file), type: 'jpeg', quality: 85 });
    images[s.file.replace('.jpg', '')] = { src: `gallery/${t.name}/${s.file}`, caption: s.caption };
  }
  // hash: the tree files' content, so gallery-check.mjs can tell when an entry is out of date
  entries.push({ name: t.name, aliases: t.aliases, hash: t.hash, seed: SEED, ...info, viewer: `viewer/#tree=${encodeURIComponent(t.name)}&seed=${SEED}`, images });
  console.log(`${info.blocks} blocks`);
}
await browser.close();
server.close();

if (only && existsSync(join(OUT, 'gallery.json'))) {
  // partial run: replace just these entries (and drop entries for trees that no longer exist)
  const exist = new Set(galleryTrees(DOCS).map((t) => t.name));
  const old = JSON.parse(readFileSync(join(OUT, 'gallery.json'), 'utf8')).trees.filter((o) => exist.has(o.name));
  for (const e of entries) {
    const i = old.findIndex((o) => o.name === e.name);
    if (i >= 0) old[i] = e; else old.push(e);
  }
  entries.splice(0, entries.length, ...old);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'gallery.json'), JSON.stringify({ seed: SEED, trees: entries }, null, 2) + '\n');
console.log(`wrote ${entries.length} trees to docs/gallery/`);
if (problems.length) {
  console.error('problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
