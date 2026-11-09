// Enumerates the bundled tree/root files.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RES = join(REPO, 'src', 'main', 'resources');
/** The plugin's tree files: src/main/resources/tree/tree.*.xml. */
export const TREES = join(RES, 'tree');

/** [{name, file, rootFile|null, treeXml, rootXml|null}] sorted by name */
export function bundledTrees() {
  const files = readdirSync(TREES).filter((f) => /^tree\..*\.xml$/.test(f) && !f.endsWith('.root.xml')).sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const f of files) {
    const base = f.slice(0, -4);
    const rootName = base + '.root.xml';
    const treeXml = readFileSync(join(TREES, f), 'utf8');
    const rootXml = existsSync(join(TREES, rootName)) ? readFileSync(join(TREES, rootName), 'utf8') : null;
    out.push({ name: base, file: join(TREES, f), rootFile: rootXml ? join(TREES, rootName) : null, treeXml, rootXml });
  }
  return out;
}
