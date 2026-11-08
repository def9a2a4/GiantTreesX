#!/usr/bin/env node
// Screenshots of trees rendered by the viewer (docs/viewer/) in headless Chromium, the same way
// docs/viewer/scripts/gallery.mjs renders the gallery, optionally combined into a contact sheet.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, normalize, resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { cli, die, parseSeeds, resolveAll, splitList, RES, REPO, TEMP, VIEWER } from './lib/common.mjs';

// shot() options (see shot() in docs/viewer/ui/app.js) and default image size per view
const VIEWS = {
  hero: { size: [480, 600], view: { azimuth: 40, elevation: 14 } },
  side: { size: [480, 600], view: { azimuth: 130, elevation: 5 } },
  low: { size: [480, 600], view: { azimuth: 40, elevation: -5 } },
  top: { size: [480, 480], view: { azimuth: 40, elevation: 70 } },
  cut: { size: [480, 480], view: { azimuth: 40, elevation: 14, viewCut: 0 } },
  base: { size: [480, 480], view: { azimuth: 40, elevation: 10, zoom: 2.6, focusY: 2, showLeaves: false } },
  wood: { size: [480, 600], view: { azimuth: 40, elevation: 14, showLeaves: false } },
};
const STYLES = ['all_log', 'mixed', 'mixed_stripped'];

const USAGE = `
Usage: node scripts/tree-shots.mjs [options] TREE...

Renders each tree for every seed, view and wood style with the viewer and saves the images. TREE
is a name in src/main/resources ("OAK" = tree.OAK, wildcards like "tree.*_HUGE") or a path to a
tree .xml file anywhere (its .root.xml next to it is used if present). Tree files are served
straight from src/main/resources (or --dir), so docs/trees/ does not need to be synced first.
Lists may be comma-separated.

Options:
  -s, --seeds LIST     seeds: numbers and ranges, e.g. 12345,7 or 1..4 (default 12345)
  -v, --views LIST     views (default hero): ${Object.keys(VIEWS).join(', ')}
      --view JSON      an extra view from shot() options, e.g. '{"azimuth":90,"elevation":30,"zoom":2}'
                       ("name" names it; also focus, focusY, viewCut, showLeaves, showRoots);
                       repeatable
      --size WxH       image size for every view (default: per view, 480 wide)
      --style LIST     wood styles: ${STYLES.join(', ')} (default mixed)
      --hollow         carve hollow trunks
  -o, --out DIR        output directory (default .temp/shots)
      --prefix STR     file name prefix
      --png            write PNG instead of JPEG
      --sheet FILE     also write a contact sheet of all images (one row per tree, captioned)
      --cols N         contact sheet columns (default: the images per tree, at most 8)
      --thumb N        contact sheet image width in pixels (default 240)
  -d, --dir DIR        where tree names are looked up (default src/main/resources)
  -h, --help

Images are named <prefix><tree>_<seed>_<view>[_<style>][_hollow].jpg. Needs Playwright:
  npm install --prefix docs/viewer && npx --prefix docs/viewer playwright install chromium

Examples:
  node scripts/tree-shots.mjs OAK OAK_HUGE
  node scripts/tree-shots.mjs --seeds 1..4 --views hero,cut --sheet .temp/shots/oak.jpg OAK
  node scripts/tree-shots.mjs --style all_log,mixed_stripped --views base,cut DARK_OAK
  node scripts/tree-shots.mjs --sheet .temp/huge.jpg --thumb 200 'tree.*_HUGE'
  node scripts/tree-shots.mjs --view '{"name":"close","elevation":20,"zoom":2.5,"focusY":25}' JUNGLE
`;

const { values: o, positionals } = cli(USAGE, {
  seeds: { type: 'string', short: 's', default: '12345' },
  views: { type: 'string', short: 'v' },
  view: { type: 'string', multiple: true, default: [] },
  size: { type: 'string' },
  style: { type: 'string', default: 'mixed' },
  hollow: { type: 'boolean' },
  out: { type: 'string', short: 'o', default: join(TEMP, 'shots') },
  prefix: { type: 'string', default: '' },
  png: { type: 'boolean' },
  sheet: { type: 'string' },
  cols: { type: 'string' },
  thumb: { type: 'string', default: '240' },
  dir: { type: 'string', short: 'd', default: RES },
});
if (!positionals.length) die(USAGE.trim());

// ---- options ----
const seeds = parseSeeds(o.seeds);
const styles = splitList([o.style]);
for (const s of styles) if (!STYLES.includes(s)) die(`unknown style ${s} (${STYLES.join(', ')})`);
const size = o.size ? o.size.split('x').map(Number) : null;
if (size && (size.length !== 2 || size.some((n) => !(n > 0)))) die('--size must look like 640x800');
const views = [];
for (const v of splitList([o.views ?? (o.view.length ? '' : 'hero')])) {
  if (!VIEWS[v]) die(`unknown view ${v} (${Object.keys(VIEWS).join(', ')})`);
  views.push({ name: v, ...VIEWS[v] });
}
o.view.forEach((json, i) => {
  let v;
  try { v = JSON.parse(json); } catch (e) { die(`--view ${json}: ${e.message}`); }
  const { name = `view${i + 1}`, ...view } = v;
  views.push({ name, size: [480, 600], view });
});
const ext = o.png ? 'png' : 'jpg';
const show = (f) => { const r = relative(process.cwd(), f); return r.startsWith('..') ? f : r; };
const outDir = resolve(o.out);
const trees = resolveAll(positionals, { dir: o.dir });

let chromium;
try {
  ({ chromium } = createRequire(join(VIEWER, 'package.json'))('playwright'));
} catch {
  die('Playwright is missing. Run:\n  npm install --prefix docs/viewer && npx --prefix docs/viewer playwright install chromium');
}

// ---- static server: docs/, with /trees/ (the viewer's tree list) served from the tree files ----
const treeFiles = new Map(); // file name in /trees/ -> path
for (const f of readdirSync(o.dir).filter((f) => /^tree\..*\.xml$/.test(f))) treeFiles.set(f, join(o.dir, f));
// the viewer only lists tree.* files, so a path named otherwise (my-oak.xml) is served as tree.<name>
const served = (t) => (t.name.startsWith('tree.') ? t.name : 'tree.' + t.name);
for (const t of trees) {
  treeFiles.set(served(t) + '.xml', t.file);
  if (t.rootFile) treeFiles.set(served(t) + '.root.xml', t.rootFile);
}
const DOCS = join(REPO, 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/trees/index.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...treeFiles.keys()].sort()));
    return;
  }
  let file = path.startsWith('/trees/') ? treeFiles.get(path.slice(7)) : join(DOCS, path);
  if (file && path.endsWith('/')) file = join(file, 'index.html');
  if (!file || (!path.startsWith('/trees/') && !file.startsWith(DOCS)) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/viewer/`;

// ---- render ----
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 600 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const viewerError = () => page.evaluate(() => (document.getElementById('error').hidden ? null : document.getElementById('errorText').textContent));
const nextFrames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Switches the viewer's wood style controls and waits for the new materials. */
async function setStyle(style, hollow) {
  await page.evaluate(([style, hollow]) => {
    const { S } = window.__treePreview;
    window.__shotsOldMat = S.data.mat;
    const sel = document.getElementById('woodStyle');
    const box = document.getElementById('forceHollow');
    if (sel.value === style && box.checked === hollow) { window.__shotsOldMat = null; return; }
    box.checked = hollow;
    box.dispatchEvent(new Event('change'));
    sel.value = style;
    sel.dispatchEvent(new Event('change'));
  }, [style, hollow]);
  await page.waitForFunction(() => {
    const p = window.__treePreview;
    return p.isIdle() && (window.__shotsOldMat === null || p.S.data.mat !== window.__shotsOldMat);
  }, null, { timeout: 120000 });
}

mkdirSync(outDir, { recursive: true });
const images = []; // { file, tree, seed, view, style }
for (const t of trees) {
  for (const seed of seeds) {
    await page.goto('about:blank');
    await page.goto(`${base}#tree=${encodeURIComponent(served(t))}&seed=${seed}&capture=1`);
    // idle, or an error (a tree that fails to load or generate never becomes idle)
    await page.waitForFunction(() => window.__treePreview?.isIdle() || !document.getElementById('error')?.hidden, null, { timeout: 180000 });
    let err = await viewerError();
    if (err) { problems.push(`${t.name} seed ${seed}: ${err.trim()}`); console.log(`${t.name} ${seed}: ERROR`); continue; }
    const info = await page.evaluate(() => {
      const { S } = window.__treePreview;
      const bb = S.meshResult.bbox;
      return { blocks: S.data.n, height: bb.maxY + 1, width: Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ) + 1 };
    });
    console.log(`${t.name} seed ${seed}: ${info.blocks} blocks, ${info.height} high, ${info.width} wide`);
    for (const style of styles) {
      await setStyle(style, !!o.hollow);
      if ((err = await viewerError())) { problems.push(`${t.name} seed ${seed} ${style}: ${err.trim()}`); continue; }
      for (const v of views) {
        const [w, h] = size || v.size;
        await page.setViewportSize({ width: w, height: h });
        await nextFrames(); // let the viewer's resize() run
        await page.evaluate((view) => window.__treePreview.shot(view), v.view);
        const tag = `${styles.length > 1 || style !== 'mixed' ? '_' + style : ''}${o.hollow ? '_hollow' : ''}`;
        const file = join(outDir, `${o.prefix}${t.name}_${seed}_${v.name}${tag}.${ext}`);
        await page.screenshot({ path: file, type: o.png ? 'png' : 'jpeg', ...(o.png ? {} : { quality: 85 }) });
        images.push({ file, tree: t.name, seed, view: v.name, style: style + (o.hollow ? ', hollow' : '') });
        console.log(`  ${show(file)}`);
      }
    }
  }
}

// ---- contact sheet: an HTML grid of the images, screenshotted ----
if (o.sheet && images.length) {
  const perTree = images.length / trees.length;
  const cols = Number(o.cols) || (perTree > 1 ? Math.min(perTree, 8) : Math.min(images.length, 6));
  const thumb = Number(o.thumb) || 240;
  const label = (im) => [trees.length > 1 && im.tree, seeds.length > 1 && `seed ${im.seed}`, views.length > 1 && im.view, styles.length > 1 && im.style].filter(Boolean).join(' · ') || im.tree;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const title = [trees.length === 1 && trees[0].name, seeds.length === 1 && `seed ${seeds[0]}`, views.length === 1 && views[0].name, styles.length === 1 && (styles[0] !== 'mixed' || o.hollow) && styles[0] + (o.hollow ? ', hollow' : '')].filter(Boolean).join(' · ');
  const html = `<!doctype html><html><head><style>
    body { margin: 0; padding: 8px; background: #fff; font: 12px system-ui, sans-serif; color: #222; width: max-content; }
    h1 { font-size: 14px; margin: 0 0 6px; }
    .grid { display: grid; grid-template-columns: repeat(${cols}, ${thumb}px); gap: 6px; align-items: start; }
    figure { margin: 0; } img { width: 100%; display: block; } figcaption { padding: 2px 0; overflow-wrap: anywhere; }
  </style></head><body>${title ? `<h1>${esc(title)}</h1>` : ''}<div class="grid">${images.map((im) => {
    const data = readFileSync(im.file).toString('base64');
    return `<figure><img src="data:image/${o.png ? 'png' : 'jpeg'};base64,${data}"><figcaption>${esc(label(im))}</figcaption></figure>`;
  }).join('')}</div></body></html>`;
  await page.setViewportSize({ width: 200, height: 200 });
  await page.setContent(html, { waitUntil: 'load' });
  const sheet = resolve(o.sheet);
  mkdirSync(dirname(sheet), { recursive: true });
  const png = /\.png$/i.test(sheet);
  await page.locator('body').screenshot({ path: sheet, type: png ? 'png' : 'jpeg', ...(png ? {} : { quality: 85 }) });
  console.log(`contact sheet: ${show(sheet)} (${images.length} images)`);
}

await browser.close();
server.close();
if (problems.length) {
  console.error('problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
