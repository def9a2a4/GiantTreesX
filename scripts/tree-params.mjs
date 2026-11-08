#!/usr/bin/env node
// Shows, compares, edits and derives Arbaro param files (tree.*.xml / biome.*.xml), editing the
// files in place so their formatting (comments, quoting, spacing) is kept.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { cli, die, resolveAll, resolveTrees, splitList, RES } from './lib/common.mjs';
import { PARAM_BY_NAME, PARAM_DEFS, parseParamXml, validateParam } from '../docs/viewer/src/params.js';

const USAGE = `
Usage: node scripts/tree-params.mjs COMMAND [options] ARGS

TREE is a name in src/main/resources ("OAK" = tree.OAK.xml, "OAK.root" = tree.OAK.root.xml,
"biome.FOREST-OAK", wildcards like "tree.*_SMALL") or a path to an .xml file.

Commands:
  show TREE...                 table of every param (one column per file); params a file does
                               not set show Arbaro's default in parentheses
  diff TREE TREE...            the same, only the params whose values differ (numerically:
                               70 and 70.0 are the same)
  set TREE... NAME=VALUE...    set params in place (checked against Arbaro's ranges). Files in
                               the same directory that are byte-identical to an edited file (the
                               biome.* copies of a tree.* file) are listed; --copies edits them too
  derive BASE NEW [NAME=VALUE...]
                               write tree.NEW.xml and tree.NEW.root.xml as copies of BASE's with
                               the params changed (in the tree file), plus biome copies (--biome)
  copies TREE...               list the byte-identical copies of each file

Options:
  -p, --params LIST   show/diff: only these params (comma-separated)
      --copies        set: also edit the byte-identical copies of each file
      --add           set/derive: add params the file does not have yet (after the other params
                      of the same level) instead of failing
      --biome BIOME   derive: also write biome.BIOME-NEW(.root).xml (repeatable)
      --force         derive: overwrite existing files; set: allow names Arbaro does not know
  -n, --dry-run       set/derive: print what would change, write nothing
  -d, --dir DIR       where tree names are looked up (default src/main/resources)
  -h, --help

After changing files in src/main/resources, run \`make docs-trees\` to update the copies the
website uses (docs/trees/).

Examples:
  node scripts/tree-params.mjs show OAK.root
  node scripts/tree-params.mjs diff OAK OAK_SMALL
  node scripts/tree-params.mjs diff -p Scale,Ratio,1Branches 'tree.*_SMALL'
  node scripts/tree-params.mjs set --copies OAK_SMALL Scale=28.0 1Branches=11
  node scripts/tree-params.mjs set tree.ACACIA.root 0Length=0.4 --copies
  node scripts/tree-params.mjs derive --biome FOREST OAK OAK_TALL Scale=70.0
`;

const { values: o, positionals } = cli(USAGE, {
  params: { type: 'string', short: 'p' },
  copies: { type: 'boolean' },
  add: { type: 'boolean' },
  biome: { type: 'string', multiple: true, default: [] },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean', short: 'n' },
  dir: { type: 'string', short: 'd', default: RES },
});
const [cmd, ...args] = positionals;
const rel = (f) => relative(process.cwd(), f) || f;

// ---- reading ----
/** Map name -> raw value string, in file order (params only; Species is the <species> name). */
const paramsOf = (text) => new Map(parseParamXml(text).filter(([k]) => k && k !== 'Species'));
const DEF_ORDER = new Map(PARAM_DEFS.map((d, i) => [d.name, i]));
const num = (v) => (v != null && v !== '' && !isNaN(+v) ? +v : null);
const same = (a, b) => (num(a) != null && num(b) != null ? num(a) === num(b) : a === b);

function table(files, onlyDiff) {
  const maps = files.map((f) => paramsOf(readFileSync(f.file, 'utf8')));
  let names = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort((a, b) => (DEF_ORDER.get(a) ?? 1e9) - (DEF_ORDER.get(b) ?? 1e9));
  if (o.params) names = splitList([o.params]);
  const cell = (m, k) => (m.has(k) ? m.get(k) : PARAM_BY_NAME.has(k) ? `(${PARAM_BY_NAME.get(k).deflt})` : '-');
  const effective = (m, k) => (m.has(k) ? m.get(k) : PARAM_BY_NAME.get(k)?.deflt?.toString());
  const rows = names.filter((k) => !onlyDiff || maps.some((m) => !same(effective(m, k), effective(maps[0], k))))
    .map((k) => [k, ...maps.map((m) => cell(m, k))]);
  if (!rows.length) return console.log(onlyDiff ? 'no differences' : 'no params');
  const head = ['param', ...files.map((f) => f.name)];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  for (const r of [head, ...rows]) console.log(r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd());
}

// ---- editing ----
const PARAM_RE = (k) => new RegExp(`(<param\\s+name=(['"])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\2\\s+value=)(['"])([^'"]*)\\3`);
/** Level of a param for placing new ones: 0..3, or -1 for the general params. */
const levelOf = (k) => { const l = PARAM_BY_NAME.get(k)?.level; return l == null || l < 0 ? (/^\d/.test(k) ? +k[0] : -1) : l; };

/** Returns the text with the params set; throws on unknown/out-of-range/missing params. */
function applyParams(text, assigns, file) {
  for (const [k, v] of assigns) {
    if (!PARAM_BY_NAME.has(k) && !o.force) throw new Error(`${k}: not an Arbaro param (--force to set it anyway)`);
    if (PARAM_BY_NAME.has(k)) validateParam(k, v);
    const re = PARAM_RE(k);
    if (re.test(text)) {
      text = text.replace(re, (_, pre, _q, q) => `${pre}${q}${v}${q}`);
      continue;
    }
    if (!o.add) throw new Error(`${rel(file)} has no ${k} (--add to add it)`);
    // add after the last param line of the same level (else after the last param), copying its format
    const lines = text.split('\n');
    let at = -1, any = -1;
    lines.forEach((l, i) => {
      const m = /<param\s+name=(['"])([^'"]+)\1/.exec(l);
      if (!m) return;
      any = i;
      if (levelOf(m[2]) === levelOf(k)) at = i;
    });
    if (any < 0) throw new Error(`${rel(file)} has no <param> lines to copy the format from`);
    const tpl = lines[at >= 0 ? at : any];
    lines.splice((at >= 0 ? at : any) + 1, 0, tpl.replace(/(name=(['"]))[^'"]*\2/, `$1${k}$2`).replace(/(value=(['"]))[^'"]*\2/, `$1${v}$2`));
    text = lines.join('\n');
  }
  return text;
}

/** Other files in the same directory with exactly this content. */
function copiesOf(file, text = readFileSync(file, 'utf8')) {
  const dir = dirname(file);
  return readdirSync(dir).filter((f) => f.endsWith('.xml')).map((f) => join(dir, f))
    .filter((f) => f !== file && readFileSync(f, 'utf8') === text);
}

function write(file, text) {
  if (!o['dry-run']) writeFileSync(file, text);
}

function parseAssigns(list) {
  return list.map((a) => {
    const i = a.indexOf('=');
    if (i < 1) die(`expected NAME=VALUE, got "${a}"`);
    return [a.slice(0, i), a.slice(i + 1)];
  });
}

function diffLine(before, after) {
  const a = paramsOf(before), b = paramsOf(after);
  return [...b].filter(([k, v]) => a.get(k) !== v).map(([k, v]) => `${k} ${a.get(k) ?? '(none)'} -> ${v}`).join(', ');
}

function reminder(files) {
  if (files.some((f) => f.startsWith(RES + '/'))) console.log('Run `make docs-trees` to update docs/trees/.');
}

// ---- commands ----
const dryTag = () => (o['dry-run'] ? ' (dry run, nothing written)' : '');
switch (cmd) {
  case 'show':
  case 'diff': {
    const files = resolveAll(args, { dir: o.dir, allowRoot: true });
    if (!files.length || (cmd === 'diff' && files.length < 2)) die(USAGE.trim());
    table(files, cmd === 'diff');
    break;
  }
  case 'copies': {
    for (const f of resolveAll(args, { dir: o.dir, allowRoot: true })) {
      const c = copiesOf(f.file);
      console.log(`${f.name}: ${c.length ? c.map((x) => rel(x)).join(', ') : 'no copies'}`);
    }
    break;
  }
  case 'set': {
    const assigns = parseAssigns(args.filter((a) => a.includes('=')));
    const files = resolveAll(args.filter((a) => !a.includes('=')), { dir: o.dir, allowRoot: true });
    if (!files.length || !assigns.length) die(USAGE.trim());
    const written = [];
    for (const f of files) {
      const before = readFileSync(f.file, 'utf8');
      const copies = copiesOf(f.file, before);
      let after;
      try { after = applyParams(before, assigns, f.file); } catch (e) { die(`${f.name}: ${e.message}`); }
      if (after === before) { console.log(`${f.name}: unchanged`); continue; }
      write(f.file, after);
      written.push(f.file);
      console.log(`${f.name}: ${diffLine(before, after)}${dryTag()}`);
      if (copies.length && o.copies) {
        for (const c of copies) write(c, after);
        written.push(...copies);
        console.log(`  and its copies: ${copies.map(rel).join(', ')}`);
      } else if (copies.length) {
        console.log(`  NOT updated, identical copies (pass --copies to edit them too): ${copies.map(rel).join(', ')}`);
      }
    }
    if (!o['dry-run']) reminder(written);
    break;
  }
  case 'derive': {
    const [baseArg, newArg, ...rest] = args;
    if (!baseArg || !newArg || newArg.includes('=')) die(USAGE.trim());
    const [base] = resolveTrees(baseArg, { dir: o.dir });
    if (!base.rootFile) die(`${base.name} has no root file`);
    const dir = dirname(base.file);
    const name = newArg.replace(/^tree\./, '');
    if (!/^[A-Za-z0-9_-]+$/.test(name)) die(`tree name "${name}" may only use letters, digits, _ and -`);
    let tree = readFileSync(base.file, 'utf8');
    const root = readFileSync(base.rootFile, 'utf8');
    try { tree = applyParams(tree, parseAssigns(rest), base.file); } catch (e) { die(e.message); }
    const targets = [`tree.${name}`, ...o.biome.map((b) => `biome.${b}-${name}`)];
    const out = targets.flatMap((t) => [[join(dir, t + '.xml'), tree], [join(dir, t + '.root.xml'), root]]);
    const exist = out.filter(([f]) => existsSync(f)).map(([f]) => rel(f));
    if (exist.length && !o.force) die(`already exist (--force to overwrite): ${exist.join(', ')}`);
    for (const [f, text] of out) write(f, text);
    console.log(`wrote ${out.map(([f]) => rel(f)).join(', ')}${dryTag()}`);
    if (rest.length) console.log(`  ${diffLine(readFileSync(base.file, 'utf8'), tree)}`);
    if (!o['dry-run']) reminder(out.map(([f]) => f));
    break;
  }
  default:
    die(USAGE.trim());
}
