// Enumerates the bundled tree/root files.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RES = join(REPO, 'src', 'main', 'resources');

/** [{name, file, rootFile|null, treeXml, rootXml|null}] sorted by name */
export function bundledTrees() {
  const files = readdirSync(RES).filter((f) => /^tree\..*\.xml$/.test(f) && !f.endsWith('.root.xml')).sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const f of files) {
    const base = f.slice(0, -4);
    const rootName = base + '.root.xml';
    const treeXml = readFileSync(join(RES, f), 'utf8');
    const rootXml = existsSync(join(RES, rootName)) ? readFileSync(join(RES, rootName), 'utf8') : null;
    out.push({ name: base, file: join(RES, f), rootFile: rootXml ? join(RES, rootName) : null, treeXml, rootXml });
  }
  return out;
}
