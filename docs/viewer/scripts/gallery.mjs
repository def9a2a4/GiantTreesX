#!/usr/bin/env node
// Renders the tree gallery (docs/gallery/) with the viewer in headless Chromium.
//
//   make gallery                              (from the repo root; installs Playwright on first run)
//   node docs/viewer/scripts/gallery.mjs [--seed 12345] [--trees tree.OAK,tree.JUNGLE]
//                                        [--types OAK,BIRCH] [--out <dir>]
//
// For every tree file in docs/trees/ it writes pictures to docs/gallery/<tree>/, plus
// docs/gallery/gallery.json, which docs/index.html turns into the gallery page: one card per tree
// file, i.e. per type and size (tree.OAK, tree.OAK_HUGE and tree.OAK_BIG are three cards), each
// with the pictures in CARD_IMAGES (a hero shot, a cut through the middle, a view from above) and
// the biomes it spawns in (spawnsIn, from config.yml's natural-trees).
// --types renders whole types; --out writes somewhere else than docs/gallery/ (for trying it out;
// image paths in gallery.json still say gallery/..., so use e.g. --out <site>/gallery).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { REPO } from './bundled.mjs';
import { galleryTrees, CARD_IMAGES, CATEGORIES, TIERS } from './gallery-trees.mjs';

const DOCS = join(REPO, 'docs');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const OUT = opt('out', null) ? resolve(opt('out', null)) : join(DOCS, 'gallery');
const SEED = Number(opt('seed', '12345')) | 0;
const onlyTrees = opt('trees', null)?.split(',');
const onlyTypes = opt('types', null)?.split(',');
const only = onlyTrees || onlyTypes ? { trees: onlyTrees || [], types: onlyTypes || [] } : null;

// Shots by name (CARD_IMAGES in gallery-trees.mjs says which a card gets): caption, viewport,
// view options for the viewer's shot() hook. docs/index.html lays a card out as the 4:5 hero
// beside the two square shots stacked, so keep those proportions.
const SHOTS = {
  hero: { caption: 'Tree', size: [720, 900], view: { azimuth: 40, elevation: 14 } },
  cut: { caption: 'Cut open', size: [480, 480], view: { azimuth: 40, elevation: 14, viewCut: 0 } },
  top: { caption: 'From above', size: [480, 480], view: { azimuth: 40, elevation: 70 } },
};

// ---- tree files ----
const allTrees = galleryTrees(DOCS);
const trees = allTrees.filter((t) => !only || only.trees.includes(t.name) || only.types.includes(t.type));

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
const page = await browser.newPage({ viewport: { width: SHOTS.hero.size[0], height: SHOTS.hero.size[1] } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));

const entries = [];
if (!only) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const t of trees) {
  process.stdout.write(`${t.name} ... `);
  await page.goto('about:blank');
  await page.setViewportSize({ width: SHOTS.hero.size[0], height: SHOTS.hero.size[1] });
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
  rmSync(dir, { recursive: true, force: true }); // no pictures left over from an older layout
  mkdirSync(dir, { recursive: true });
  const images = {};
  for (const shot of CARD_IMAGES) {
    const s = SHOTS[shot];
    await page.setViewportSize({ width: s.size[0], height: s.size[1] });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // let resize() run
    await page.evaluate((v) => window.__treePreview.shot(v), s.view);
    await page.screenshot({ path: join(dir, `${shot}.jpg`), type: 'jpeg', quality: 85 });
    images[shot] = { src: `gallery/${t.name}/${shot}.jpg`, caption: s.caption };
  }
  // hash: the tree files' content, so gallery-check.mjs can tell when an entry is out of date
  entries.push({ name: t.name, spawnsIn: t.spawnsIn, hash: t.hash, type: t.type, category: t.category, tier: t.tier, seed: SEED, ...info,
    viewer: `viewer/#tree=${encodeURIComponent(t.name)}&seed=${SEED}`, images });
  console.log(`${info.blocks} blocks`);
}
await browser.close();
server.close();

if (only && existsSync(join(OUT, 'gallery.json'))) {
  // partial run: replace just these entries (and drop entries for trees that no longer exist)
  const exist = new Set(allTrees.map((t) => t.name));
  const old = JSON.parse(readFileSync(join(OUT, 'gallery.json'), 'utf8')).trees.filter((o) => exist.has(o.name));
  for (const e of entries) {
    const i = old.findIndex((o) => o.name === e.name);
    if (i >= 0) old[i] = e; else old.push(e);
  }
  entries.splice(0, entries.length, ...old);
}
// in gallery order (by type, giant first), which docs/index.html relies on
const order = new Map(allTrees.map((t, i) => [t.name, i]));
entries.sort((a, b) => (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity));
mkdirSync(OUT, { recursive: true });
// categories and tiers: the filter buttons on the page, in this order
const categories = Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.label]));
writeFileSync(join(OUT, 'gallery.json'), JSON.stringify({ seed: SEED, categories, tiers: TIERS, trees: entries }, null, 2) + '\n');
console.log(`wrote ${entries.length} trees to ${OUT}`);
if (problems.length) {
  console.error('problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
