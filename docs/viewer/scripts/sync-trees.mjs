#!/usr/bin/env node
// Copies the plugin's tree files (src/main/resources/tree.*.xml) into docs/trees/ and writes
// docs/trees/index.json (the file list) and docs/trees/natural-trees.json (the biomes each tree
// spawns in, from config.yml's natural.trees; see natural-trees.mjs), so GitHub Pages (serving
// docs/) can show them. Anything else in docs/trees/ is removed.
//
//   node docs/viewer/scripts/sync-trees.mjs           update docs/trees/
//   node docs/viewer/scripts/sync-trees.mjs --check   exit 1 if docs/trees/ is out of date (CI)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, RES } from './bundled.mjs';
import { naturalTrees } from './natural-trees.mjs';

const OUT = join(REPO, 'docs', 'trees');
const check = process.argv.includes('--check');

const files = readdirSync(RES).filter((f) => /^tree\..*\.xml$/.test(f)).sort();
const wanted = new Map(files.map((f) => [f, readFileSync(join(RES, f), 'utf8')]));
wanted.set('index.json', JSON.stringify(files, null, 2) + '\n');
const names = files.filter((f) => !f.endsWith('.root.xml')).map((f) => f.slice(0, -4));
wanted.set('natural-trees.json', JSON.stringify(naturalTrees(names), null, 2) + '\n');

const have = existsSync(OUT) ? readdirSync(OUT) : [];
const stale = have.filter((f) => !wanted.has(f));
const changed = [...wanted].filter(([f, text]) => !have.includes(f) || readFileSync(join(OUT, f), 'utf8') !== text).map(([f]) => f);

if (check) {
  if (stale.length || changed.length) {
    console.error(`docs/trees/ is out of date (${[...changed, ...stale].join(', ')}). Run: make docs-trees`);
    process.exit(1);
  }
  console.log(`docs/trees/ is up to date (${files.length} files)`);
} else {
  mkdirSync(OUT, { recursive: true });
  for (const f of stale) rmSync(join(OUT, f));
  for (const f of changed) writeFileSync(join(OUT, f), wanted.get(f));
  console.log(`docs/trees/: ${changed.length} written, ${stale.length} removed, ${files.length} tree files`);
}
