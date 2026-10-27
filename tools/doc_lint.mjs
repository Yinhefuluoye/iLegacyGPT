#!/usr/bin/env node
/**
 * Documentation lint for this repository. Run locally: node tools/doc_lint.mjs
 *
 * Checks the rules in docs/style.md:
 *   1. no first person and no colloquialisms
 *   2. no emoji
 *   3. no TODO/FIXME markers
 *   4. English and zh-CN mirrors have the same number of headings
 *   5. relative links point at existing files
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');

const FIRST_PERSON = [
  /\bI\b/, /\bwe\b/i, /\bour\b/i, /\bus\b/i,
  /我们/, /咱们/, /我的/, /笔者/
];
const COLLOQUIAL = [
  /\bjust\b/i, /\bsimply\b/i, /\bof course\b/i, /\bnice\b/i, /\bfriends\b/i,
  /顺手/, /顺便/, /踩坑/, /踩过/, /历史 bug/, /其实/, /感觉/, /千万别/, /牛逼/, /一句话/
];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2705}\u{274C}\u{26A0}\u{2753}\u{2757}]/u;
const TODO = /\b(TODO|FIXME|XXX)\b/;
const MIRRORS = [
  ['README.md', 'README.zh-CN.md'],
  ['PRIVACY.md', 'PRIVACY.zh-CN.md'],
  ['SECURITY.md', 'SECURITY.zh-CN.md'],
  ['docs/build-wsl.md', 'docs/build-wsl.zh-CN.md']
];

function markdownFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const SKIP_FILES = new Set(['docs/style.md']);
const SKIP_DIRS = new Set(['.toolchain']);
const problems = [];

for (const file of markdownFiles(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_FILES.has(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.startsWith('```')) return;
    const at = rel + ':' + (index + 1);
    for (const re of FIRST_PERSON) if (re.test(line)) problems.push(at + ' first person (' + re + ')');
    for (const re of COLLOQUIAL) if (re.test(line)) problems.push(at + ' colloquial (' + re + ')');
    if (EMOJI.test(line)) problems.push(at + ' emoji');
    if (TODO.test(line)) problems.push(at + ' TODO marker');
    const links = line.matchAll(/\]\(([^)#:\s][^)\s]*)\)/g);
    for (const match of links) {
      const target = match[1];
      if (/^https?:|^\.\.\/\.\.\//.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) problems.push(at + ' broken link ' + target);
    }
  });
}

for (const [en, zh] of MIRRORS) {
  const count = (rel) => {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return -1;
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^#{1,6}\s/.test(l)).length;
  };
  const a = count(en);
  const b = count(zh);
  if (a !== b) problems.push('mirror mismatch ' + en + ' (' + a + ') vs ' + zh + ' (' + b + ')');
}

if (problems.length) {
  for (const problem of problems) console.log(problem);
  console.log(problems.length + ' problem(s)');
  process.exit(1);
}
console.log('doc lint ok (' + MIRRORS.length + ' mirrored pairs checked)');