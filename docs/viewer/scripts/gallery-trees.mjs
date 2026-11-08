// The distinct trees the gallery shows: every tree file in docs/trees/index.json, with
// byte-identical copies (usually the biome.* duplicates of a tree.* file) folded in as aliases.
// Shared by gallery.mjs (which renders them) and gallery-check.mjs (which checks the gallery
// still matches them). Same grouping as ui/trees.js.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** [{name, aliases: [name], hash}] for docs/trees/, tree.* first. */
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
  return [...groups.values()];
}
