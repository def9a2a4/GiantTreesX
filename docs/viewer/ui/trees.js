// Loads every tree the plugin ships from docs/trees/ (copies of src/main/resources/tree, kept in sync by
// `make docs-trees`; index.json lists the files, natural-trees.json the biomes each spawns in).

export const TREES = new URL('../../trees/', import.meta.url);

async function listFiles() {
  const r = await fetch(new URL('index.json', TREES));
  if (!r.ok) throw new Error(`Could not load ${TREES}index.json (HTTP ${r.status}). Run: make docs-trees`);
  return r.json();
}

/** [{name, treeXml, rootXml|null, spawnsIn: [biome]}] sorted by name; spawnsIn from config.yml */
export async function loadPluginTrees() {
  const files = new Set((await listFiles()).filter((f) => /^tree\..*\.xml$/.test(f)));
  const names = [...files].filter((f) => !f.endsWith('.root.xml')).map((f) => f.slice(0, -4));
  if (names.length === 0) {
    throw new Error(`No tree files listed in ${TREES}index.json.`);
  }
  names.sort((a, b) => a.localeCompare(b));

  const text = async (f) => {
    const r = await fetch(new URL(f, TREES));
    if (!r.ok) throw new Error(`Could not fetch ${f} (HTTP ${r.status})`);
    return r.text();
  };
  // only used for labels, so a missing file (scripts/tree-shots.mjs doesn't serve it) is fine
  const natural = await fetch(new URL('natural-trees.json', TREES)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return Promise.all(names.map(async (name) => ({
    name,
    treeXml: await text(name + '.xml'),
    rootXml: files.has(name + '.root.xml') ? await text(name + '.root.xml') : null,
    spawnsIn: natural[name] || [],
  })));
}

/** Biome key from config.yml's natural.trees, for display: DARK_FOREST -> Dark Forest. */
export function biomeLabel(key) {
  if (key === 'LUSH_CAVES') return 'any biome above Lush Caves'; // a pseudo-biome, not a real one
  return key.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
