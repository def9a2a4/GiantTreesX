#!/usr/bin/env node
// Checks that docs/gallery/ still matches the tree files in docs/trees/ (what CI runs):
//   - every tree file has an entry in docs/gallery/gallery.json, and there are no entries for
//     trees that no longer exist,
//   - each entry lists the biomes the tree spawns in (spawnsIn) that config.yml's natural.trees
//     gives it now,
//   - each entry (one card per tree file) has the type, category (trees / fungi) and size tier
//     the tree files give it now, and every card picture (CARD_IMAGES), and they exist,
//   - the gallery's category and tier tables (the page's filters) match gallery-trees.mjs,
//   - entries carrying a content hash (written by gallery.mjs) were rendered from the current
//     tree files. Entries without one, from older gallery runs, skip this check.
//
//   node docs/viewer/scripts/gallery-check.mjs
//
// Fix failures with `make gallery` (or `node docs/viewer/scripts/gallery.mjs --trees <names>`).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './bundled.mjs';
import { galleryTrees, CARD_IMAGES, CATEGORIES, TIERS } from './gallery-trees.mjs';

const DOCS = join(REPO, 'docs');
const GALLERY = join(DOCS, 'gallery');
const problems = [];

const trees = galleryTrees(DOCS);
let entries = [];
let gallery = {};
try {
  gallery = JSON.parse(readFileSync(join(GALLERY, 'gallery.json'), 'utf8'));
  entries = gallery.trees;
  if (!Array.isArray(entries)) throw new Error('no "trees" array');
} catch (e) {
  problems.push(`docs/gallery/gallery.json is missing or unreadable: ${e.message}`);
  entries = [];
}
if (entries.length) {
  const cats = Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.label]));
  if (JSON.stringify(gallery.categories) !== JSON.stringify(cats)) {
    problems.push(`gallery.json categories ${JSON.stringify(gallery.categories)}, gallery-trees.mjs has ${JSON.stringify(cats)}`);
  }
  if (JSON.stringify(gallery.tiers) !== JSON.stringify(TIERS)) {
    problems.push(`gallery.json tiers ${JSON.stringify(gallery.tiers)}, gallery-trees.mjs has ${JSON.stringify(TIERS)}`);
  }
}

const byName = new Map(entries.map((e) => [e.name, e]));
const treeNames = new Set(trees.map((t) => t.name));
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

for (const t of trees) {
  const e = byName.get(t.name);
  if (!e) {
    problems.push(`${t.name}: no gallery entry`);
    continue;
  }
  if (!sameSet(e.spawnsIn || [], t.spawnsIn)) {
    problems.push(`${t.name}: gallery says it spawns in [${(e.spawnsIn || []).join(', ')}], config.yml says [${t.spawnsIn.join(', ')}]`);
  }
  if (e.hash && e.hash !== t.hash) problems.push(`${t.name}: tree files changed since the gallery was rendered`);
  for (const field of ['type', 'category', 'tier']) {
    if (e[field] !== t[field]) problems.push(`${t.name}: gallery has ${field} ${e[field]}, tree files make it ${t[field]}`);
  }
  for (const shot of CARD_IMAGES) {
    if (!e.images?.[shot]) problems.push(`${t.name}: no ${shot} picture`);
  }
  for (const img of Object.values(e.images || {})) {
    if (!img?.src || !existsSync(join(DOCS, img.src))) problems.push(`${t.name}: missing image ${img?.src}`);
  }
}
for (const e of entries) {
  if (!treeNames.has(e.name)) problems.push(`${e.name}: gallery entry for a tree that no longer exists`);
}
// leftover image folders from trees that were removed
if (existsSync(GALLERY)) {
  for (const f of readdirSync(GALLERY)) {
    if (statSync(join(GALLERY, f)).isDirectory() && !byName.has(f)) problems.push(`docs/gallery/${f}/: no gallery entry uses it`);
  }
}

if (problems.length) {
  console.error(`docs/gallery/ is out of date (${problems.length} problem(s)):\n  ${problems.join('\n  ')}\nRun: make gallery`);
  process.exit(1);
}
console.log(`docs/gallery/ is up to date (${trees.length} trees)`);
