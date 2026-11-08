// Enumerates the bundled tree/root files and groups byte-identical ones.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mangroveRaise } from '../src/render.js';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RES = join(REPO, 'src', 'main', 'resources');

/** [{name, file, rootFile|null, treeXml, rootXml|null, hash, aliasOf|null}] sorted tree.* first */
export function bundledTrees() {
  const files = readdirSync(RES).filter((f) => /^(tree|biome)\..*\.xml$/.test(f) && !f.endsWith('.root.xml'));
  files.sort((a, b) => (a.startsWith('tree.') === b.startsWith('tree.') ? a.localeCompare(b) : a.startsWith('tree.') ? -1 : 1));
  const out = [];
  const seen = new Map();
  for (const f of files) {
    const base = f.slice(0, -4);
    const rootName = base + '.root.xml';
    const treeXml = readFileSync(join(RES, f), 'utf8');
    const rootXml = existsSync(join(RES, rootName)) ? readFileSync(join(RES, rootName), 'utf8') : null;
    // the refPoint raise (mangroves) depends on the file name, so it is part of the identity
    const raise = mangroveRaise(f);
    const hash = createHash('md5').update(treeXml).update('\0').update(rootXml ?? '').update(raise ? 'R' + raise : '').digest('hex');
    const aliasOf = seen.get(hash) ?? null;
    if (!aliasOf) seen.set(hash, base);
    out.push({ name: base, file: join(RES, f), rootFile: rootXml ? join(RES, rootName) : null, treeXml, rootXml, hash, aliasOf });
  }
  return out;
}
