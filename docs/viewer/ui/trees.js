// Loads every tree the plugin ships from docs/trees/ (copies of src/main/resources, kept in sync by
// `make docs-trees`; index.json lists the files).

import { mangroveRaise } from '../src/render.js';

export const TREES = new URL('../../trees/', import.meta.url);

async function listFiles() {
  const r = await fetch(new URL('index.json', TREES));
  if (!r.ok) throw new Error(`Could not load ${TREES}index.json (HTTP ${r.status}). Run: make docs-trees`);
  return r.json();
}

/** [{name, treeXml, rootXml|null, aliasOf|null}], tree.* first; aliasOf = identical earlier file */
export async function loadPluginTrees() {
  const files = new Set((await listFiles()).filter((f) => /^(tree|biome)\..*\.xml$/.test(f)));
  const names = [...files].filter((f) => !f.endsWith('.root.xml')).map((f) => f.slice(0, -4));
  if (names.length === 0) {
    throw new Error(`No tree files listed in ${TREES}index.json.`);
  }
  names.sort((a, b) => (a.startsWith('tree.') === b.startsWith('tree.') ? a.localeCompare(b) : a.startsWith('tree.') ? -1 : 1));

  const text = async (f) => {
    const r = await fetch(new URL(f, TREES));
    if (!r.ok) throw new Error(`Could not fetch ${f} (HTTP ${r.status})`);
    return r.text();
  };
  const trees = await Promise.all(names.map(async (name) => ({
    name,
    treeXml: await text(name + '.xml'),
    rootXml: files.has(name + '.root.xml') ? await text(name + '.root.xml') : null,
  })));

  // byte-identical files are folded into the first one; the refPoint raise (mangroves) depends on
  // the file name, so it is part of the identity
  const seen = new Map();
  for (const t of trees) {
    const raise = mangroveRaise(t.name + '.xml');
    const key = t.treeXml + '\0' + (t.rootXml ?? '') + (raise ? 'R' + raise : '');
    t.aliasOf = seen.get(key) ?? null;
    if (!t.aliasOf) seen.set(key, t.name);
  }
  return trees;
}
