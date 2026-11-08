// The distinct trees the gallery shows: every tree file in docs/trees/index.json, with
// byte-identical copies (usually the biome.* duplicates of a tree.* file) folded in as aliases.
// Shared by gallery.mjs (which renders them) and gallery-check.mjs (which checks the gallery
// still matches them). Same grouping as ui/trees.js.
//
// The gallery shows one card per tree type (OAK, BIRCH, ...): the type's giant tree (plain
// tree.<TYPE>) as the hero, with its huge (<TYPE>_HUGE) and big (<TYPE>_BIG) variants beside it.
// Each tree has a role: 'lead' (the card's hero; the giant when there is one) or 'variant'.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const TIERS = ['giant', 'huge', 'big'];

/** Size tier from the name: ..._HUGE -> huge, ..._BIG -> big, anything else giant. */
export function tierOf(name) {
  if (/_HUGE$/.test(name)) return 'huge';
  if (/_BIG$/.test(name)) return 'big';
  return 'giant';
}

/** Tree type from the name: tree.OAK_HUGE -> OAK, biome.FOREST-OAK_BIG -> OAK, tree.AZALEA -> AZALEA. */
export function typeOf(name) {
  let n = name.replace(/^tree\./, '');
  if (n.startsWith('biome.')) {
    n = n.slice('biome.'.length);
    const hyphen = n.indexOf('-');
    if (hyphen >= 0) n = n.slice(hyphen + 1);
  }
  return n.replace(/_(HUGE|BIG)$/, '');
}

/**
 * [{name, aliases: [name], hash, type, tier, role}] for docs/trees/, ordered by type (as the tree
 * files sort, tree.* first) and within a type giant, huge, big.
 */
export function galleryTrees(docsDir) {
  const treesDir = join(docsDir, 'trees');
  const files = JSON.parse(readFileSync(join(treesDir, 'index.json'), 'utf8'));
  const names = files.filter((f) => f.endsWith('.xml') && !f.endsWith('.root.xml')).map((f) => f.slice(0, -4))
    .sort((a, b) => (a.startsWith('tree.') === b.startsWith('tree.') ? a.localeCompare(b) : a.startsWith('tree.') ? -1 : 1));
  const read = (f) => (existsSync(join(treesDir, f)) ? readFileSync(join(treesDir, f), 'utf8') : '');
  const groups = new Map(); // identity -> { name, aliases, hash }
  for (const name of names) {
    // the MANGROVE refPoint rule depends on the file name, so it is part of the identity
    const key = read(name + '.xml') + '\0' + read(name + '.root.xml') + (name.includes('MANGROVE') ? 'M' : '');
    if (groups.has(key)) groups.get(key).aliases.push(name);
    else groups.set(key, { name, aliases: [], hash: createHash('sha256').update(key).digest('hex').slice(0, 16) });
  }
  // by type, in the order the types first appear; within a type by tier, then file order
  const byType = new Map();
  for (const t of groups.values()) {
    const type = typeOf(t.name);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push({ ...t, type, tier: tierOf(t.name) });
  }
  const out = [];
  for (const list of byType.values()) {
    list.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
    list.forEach((t, i) => out.push({ ...t, role: i === 0 ? 'lead' : 'variant' }));
  }
  return out;
}

/** Image files each role gets (gallery.mjs renders them, gallery-check.mjs expects them). */
export const ROLE_IMAGES = { lead: ['hero', 'cut'], variant: ['view'] };
