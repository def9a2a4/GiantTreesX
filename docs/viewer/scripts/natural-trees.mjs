// Where trees spawn naturally: the `natural-trees:` block of the plugin's bundled config.yml, which
// maps biomes to tree names. GitHub Pages can't read src/main/resources, so sync-trees.mjs bakes
// the result into docs/trees/natural-trees.json (for the viewer) and gallery-trees.mjs into each
// gallery card's spawnsIn.
//
// Only the flow-list form the bundled config uses is understood (`  FOREST: [OAK, COTTONWOOD]`);
// anything else inside the block (block lists, the longer per-biome map form) throws, so a config
// edit can't silently break the gallery. A name N grows tree.N, tree.N_HUGE and tree.N_BIG,
// whichever exist; a name ending in _HUGE/_BIG names just that file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RES } from './bundled.mjs';

export const CONFIG = join(RES, 'config.yml');

/** config.yml text -> { BIOME: [name, ...] } in file order. */
export function parseNaturalTrees(text, where = 'config.yml') {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^natural-trees:/.test(l));
  if (start < 0) throw new Error(`${where}: no "natural-trees:" block`);
  if (/^natural-trees:\s*\{\s*\}\s*(#.*)?$/.test(lines[start])) return {};
  if (!/^natural-trees:\s*(#.*)?$/.test(lines[start])) throw new Error(`${where}:${start + 1}: can't read "${lines[start]}"`);
  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (!/^\s/.test(l)) break; // next top-level key
    const m = /^ {2}([A-Z_]+):\s*\[([^\]]*)\]\s*(#.*)?$/.exec(l);
    if (!m) {
      throw new Error(`${where}:${i + 1}: can't read "${l.trim()}" in natural-trees (the docs tooling only understands `
        + '"  BIOME: [NAME, ...]"; see docs/viewer/scripts/natural-trees.mjs)');
    }
    out[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

/**
 * { 'tree.X': [BIOME, ...] } for the trees among `names` (tree file names without .xml) that
 * spawn naturally; trees that don't are left out. Throws on a name with no tree file.
 */
export function naturalTrees(names, config = CONFIG) {
  const have = new Set(names);
  const out = {};
  for (const [biome, list] of Object.entries(parseNaturalTrees(readFileSync(config, 'utf8'), config))) {
    for (const n of list) {
      const files = (/_(HUGE|BIG)$/.test(n) ? [n] : [n, n + '_HUGE', n + '_BIG']).map((f) => 'tree.' + f).filter((f) => have.has(f));
      if (!files.length) throw new Error(`${config}: natural-trees.${biome} names ${n}, but there is no tree.${n}.xml`);
      for (const f of files) if (!(out[f] ||= []).includes(biome)) out[f].push(biome);
    }
  }
  return out;
}
