// Shared helpers for the tree tools in scripts/: repo paths, argument parsing, tree file lookup.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RES = join(REPO, 'src', 'main', 'resources');
export const VIEWER = join(REPO, 'docs', 'viewer');
export const TEMP = join(REPO, '.temp');

/**
 * util.parseArgs wrapper: prints `usage` and exits on --help or on a bad option.
 * options: { name: { type: 'string'|'boolean', short?, multiple?, default? } }
 */
export function cli(usage, options, argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { help: { type: 'boolean', short: 'h' }, ...options }, allowPositionals: true });
  } catch (e) {
    console.error(`${e.message}\n\n${usage.trim()}`);
    process.exit(2);
  }
  if (parsed.values.help) {
    console.log(usage.trim());
    process.exit(0);
  }
  return parsed;
}

export function die(msg) {
  console.error(msg);
  process.exit(1);
}

/** "12345,7" / "1..10" / "1..5,777" -> [12345, 7] ... (Java ints, as the plugin uses) */
export function parseSeeds(spec) {
  const out = [];
  for (const part of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(-?\d+)\.\.(-?\d+)$/.exec(part);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      for (let s = a; a <= b ? s <= b : s >= b; s += a <= b ? 1 : -1) out.push(s | 0);
    } else if (/^-?\d+$/.test(part)) out.push(Number(part) | 0);
    else die(`bad seed "${part}" (use numbers, ranges like 1..10, separated by commas)`);
  }
  return out;
}

/** Positional args may also be comma-separated lists. */
export const splitList = (args) => args.flatMap((a) => a.split(',')).map((s) => s.trim()).filter(Boolean);

/** Tree names (tree.X, no .xml, no .root) in a directory, sorted. */
export function treeNames(dir = RES) {
  const names = readdirSync(dir).filter((f) => /^tree\..*\.xml$/.test(f) && !f.endsWith('.root.xml')).map((f) => f.slice(0, -4));
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * Resolves a tree argument to its files: a path to an .xml file, or a name looked up in `dir`
 * ("OAK" = "tree.OAK", "OAK.root" for a root file). Names may contain * as a wildcard
 * ("tree.*_HUGE", "*MANGROVE*"); those expand to every matching tree file.
 * Returns [{name, file, rootFile|null}]; with allowRoot, ".root" names resolve to the root file itself.
 */
export function resolveTrees(arg, { dir = RES, allowRoot = false } = {}) {
  if (arg.endsWith('.xml') || arg.includes('/')) {
    const file = resolve(arg.endsWith('.xml') ? arg : arg + '.xml');
    if (!existsSync(file)) die(`no such file: ${arg}`);
    const base = file.slice(0, -4);
    const rootFile = !base.endsWith('.root') && existsSync(base + '.root.xml') ? base + '.root.xml' : null;
    return [{ name: basename(base), file, rootFile }];
  }
  let name = arg;
  let root = false;
  if (name.endsWith('.root')) {
    if (!allowRoot) die(`${arg}: give the tree name; its .root file is used automatically`);
    root = true;
    name = name.slice(0, -5);
  }
  if (!name.startsWith('tree.')) name = 'tree.' + name;
  let names;
  if (name.includes('*')) {
    const re = new RegExp('^' + name.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    names = treeNames(dir).filter((n) => re.test(n));
    if (!names.length) die(`no tree files in ${dir} match ${arg}`);
  } else {
    if (!existsSync(join(dir, name + '.xml'))) die(`no tree file ${name}.xml in ${dir}`);
    names = [name];
  }
  return names.map((n) => {
    const rootFile = existsSync(join(dir, n + '.root.xml')) ? join(dir, n + '.root.xml') : null;
    if (root) {
      if (!rootFile) die(`no root file ${n}.root.xml in ${dir}`);
      return { name: n + '.root', file: rootFile, rootFile: null };
    }
    return { name: n, file: join(dir, n + '.xml'), rootFile };
  });
}

/** resolveTrees over several (possibly comma-separated) args, without duplicates. */
export function resolveAll(args, opts) {
  const seen = new Set();
  return splitList(args).flatMap((a) => resolveTrees(a, opts)).filter((t) => !seen.has(t.file) && seen.add(t.file));
}

export const readText = (f) => readFileSync(f, 'utf8');
