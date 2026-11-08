// The trees the gallery shows: every tree file in docs/trees/index.json, with the biomes it spawns
// in (spawnsIn, from config.yml's natural-trees; see natural-trees.mjs). Shared by gallery.mjs
// (which renders them) and gallery-check.mjs (which checks the gallery still matches them).
//
// The gallery shows one card per tree file, i.e. per (type, size): tree.OAK (giant),
// tree.OAK_HUGE (huge) and tree.OAK_BIG (big) are three cards, each with its own pictures
// (CARD_IMAGES). Not every type has every size. The page filters cards by category (CATEGORIES:
// trees or fungi) and size tier, and groups them by type or size.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mangroveRaise } from '../src/render.js';
import { naturalTrees } from './natural-trees.mjs';

/** Size tiers, largest first (the order cards are shown in). */
export const TIERS = ['giant', 'huge', 'big'];

/**
 * Categories the gallery filters by, and the types in each. The one place that says what is a
 * fungus: any type not listed under another category is a tree.
 */
export const CATEGORIES = {
  tree: { label: 'Trees', types: [] }, // the default: everything not listed below
  fungi: { label: 'Fungi', types: ['RED_MUSHROOM', 'BROWN_MUSHROOM', 'CRIMSON_FUNGUS', 'WARPED_FUNGUS'] },
};

/** Category of a tree type (a key of CATEGORIES). */
export function categoryOf(type) {
  for (const [cat, { types }] of Object.entries(CATEGORIES)) if (types.includes(type)) return cat;
  return 'tree';
}

/** Size tier from the name: ..._HUGE -> huge, ..._BIG -> big, anything else giant. */
export function tierOf(name) {
  if (/_HUGE$/.test(name)) return 'huge';
  if (/_BIG$/.test(name)) return 'big';
  return 'giant';
}

/** Tree type from the name: tree.OAK_HUGE -> OAK, tree.AZALEA -> AZALEA. */
export function typeOf(name) {
  return name.replace(/^tree\./, '').replace(/_(HUGE|BIG)$/, '');
}

/**
 * [{name, spawnsIn: [biome], hash, type, category, tier}] for docs/trees/, ordered by type (as the
 * tree files sort) and within a type giant, huge, big.
 */
export function galleryTrees(docsDir) {
  const treesDir = join(docsDir, 'trees');
  const files = JSON.parse(readFileSync(join(treesDir, 'index.json'), 'utf8'));
  const names = files.filter((f) => /^tree\..*\.xml$/.test(f) && !f.endsWith('.root.xml')).map((f) => f.slice(0, -4))
    .sort((a, b) => a.localeCompare(b));
  const natural = naturalTrees(names);
  const read = (f) => (existsSync(join(treesDir, f)) ? readFileSync(join(treesDir, f), 'utf8') : '');
  const trees = names.map((name) => {
    // the refPoint raise (mangroves) depends on the file name, so it is part of the hash
    const raise = mangroveRaise(name + '.xml');
    const key = read(name + '.xml') + '\0' + read(name + '.root.xml') + (raise ? 'R' + raise : '');
    return { name, spawnsIn: natural[name] || [], hash: createHash('sha256').update(key).digest('hex').slice(0, 16) };
  });
  // by type, in the order the types first appear; within a type by tier, then file order
  const byType = new Map();
  for (const t of trees) {
    const type = typeOf(t.name);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push({ ...t, type, category: categoryOf(type), tier: tierOf(t.name) });
  }
  const out = [];
  for (const list of byType.values()) {
    list.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
    out.push(...list);
  }
  return out;
}

/** Pictures every card gets (gallery.mjs renders them, gallery-check.mjs expects them). */
export const CARD_IMAGES = ['hero', 'cut', 'top'];
