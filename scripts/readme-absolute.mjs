#!/usr/bin/env node
// Prints README.md with every relative link and image made absolute, for pasting where relative
// paths don't resolve (Modrinth's description). Images under docs/ point at the GitHub Pages site,
// which serves them with the right type (raw.githubusercontent.com serves SVGs as plain text);
// other images at raw.githubusercontent.com; other links at the file (or folder) on GitHub.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cli, REPO, readText } from './lib/common.mjs';

const USAGE = `Usage: node scripts/readme-absolute.mjs [FILE]

Prints FILE (default README.md) with relative links and images made absolute.`;
const { positionals } = cli(USAGE, {});

const GITHUB = 'https://github.com/def9a2a4/GiantTreesX';
const RAW = 'https://raw.githubusercontent.com/def9a2a4/GiantTreesX/master';
const PAGES = 'https://def9a2a4.github.io/GiantTreesX';
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;

function absolute(url, isImage) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return url; // already absolute, mailto:, anchor
  const [path, anchor = ''] = url.split(/(?=#)/);
  const clean = path.replace(/^\.\//, '');
  if (isImage || IMAGE.test(clean)) {
    return clean.startsWith('docs/') ? `${PAGES}/${clean.slice('docs/'.length)}` : `${RAW}/${clean}`;
  }
  const full = join(REPO, clean);
  const kind = existsSync(full) && statSync(full).isDirectory() ? 'tree' : 'blob';
  return `${GITHUB}/${kind}/master/${clean}${anchor}`;
}

const text = readText(join(REPO, positionals[0] || 'README.md'));
const out = text
  // markdown images and links: ![alt](url "title") / [text](url)
  .replace(/(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g,
    (m, bang, label, url, title) => `${bang}[${label}](${absolute(url, bang === '!')}${title})`)
  // HTML src= and href=
  .replace(/\b(src|href)=(["'])([^"']+)\2/g, (m, attr, q, url) => `${attr}=${q}${absolute(url, attr === 'src')}${q}`);
process.stdout.write(out);
