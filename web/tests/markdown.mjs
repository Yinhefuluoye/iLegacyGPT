/**
 * Local regression test for the markdown renderer. No test framework, no CI:
 *
 *   node web/tests/markdown.mjs
 *
 * Compiles src/markdown.ts with the project's own TypeScript into the OS temp
 * directory, then asserts the rendered HTML for every construct the AI bubble
 * relies on. Exits non-zero on the first failing case, printing the HTML.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(os.tmpdir(), 'ilegacy-md-' + process.pid);

execFileSync(
  process.execPath,
  [
    path.join(WEB, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(WEB, 'src', 'markdown.ts'),
    '--outDir', OUT,
    '--module', 'commonjs',
    '--target', 'es2015',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const { renderMarkdown } = require(path.join(OUT, 'markdown.js'));

let pass = 0;
const failures = [];

function check(name, input, expectAll, expectNone) {
  const html = renderMarkdown(input);
  const missing = (expectAll || []).filter((s) => html.indexOf(s) < 0);
  const unwanted = (expectNone || []).filter((s) => html.indexOf(s) >= 0);
  if (missing.length || unwanted.length) {
    failures.push({ name, html, missing, unwanted });
    return;
  }
  pass += 1;
}

// --- tables -----------------------------------------------------------------
check('table basic',
  '| 项目 | 说明 |\n| --- | --- |\n| A | 第一行 |\n| B | 第二行 |',
  ['<table>', '<thead>', '<th>项目</th>', '<tbody>', '<td>A</td>', '<td>第二行</td>', '</table>']);

check('table alignment',
  '| 左 | 中 | 右 |\n|:---|:---:|---:|\n| 1 | 2 | 3 |',
  ['style="text-align:left"', 'style="text-align:center"', 'style="text-align:right"']);

check('table wide (4+ columns)',
  '| a | b | c | d |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |',
  ['table-wrap is-wide']);

check('table escaped pipe',
  '| 表达式 | 含义 |\n|---|---|\n| a \\| b | 或 |',
  ['<td>a | b</td>']);

check('table inline markup in cells',
  '| k | v |\n|---|---|\n| **粗** | `x=1` |',
  ['<strong>粗</strong>', '<code>x=1</code>']);

check('table after paragraph',
  '先说明一句：\n\n| 键 | 值 |\n|---|---|\n| k | v |',
  ['<p>先说明一句：</p>', '<table>']);

check('table with header only',
  '| a | b |\n|---|---|',
  ['<thead>', '</table>'],
  ['<tbody>']);

check('no separator is not a table',
  'a | b\nc | d',
  ['<p>a | b<br>c | d</p>'],
  ['<table>']);

check('fenced code keeps table syntax verbatim',
  '```\n| a | b |\n| --- | --- |\n```',
  ['<pre><code>| a | b |', '| --- | --- |', '</code></pre>'],
  ['<table>']);

// --- inline -----------------------------------------------------------------
check('strikethrough', '这是 ~~删掉~~ 的内容', ['<del>删掉</del>']);

check('inline code url becomes link',
  '见 `https://example.com/a` 页面',
  ['<code><a href="https://example.com/a" target="_blank">https://example.com/a</a></code>']);

check('bare url autolink',
  '详见 https://example.com/post 一文',
  ['<a href="https://example.com/post" target="_blank">https://example.com/post</a>']);

check('bare url trailing punctuation',
  '详见 https://example.com/post。',
  ['<a href="https://example.com/post" target="_blank">https://example.com/post</a>。']);

check('url wrapped in parens keeps the paren',
  '(见 https://example.com/post)',
  ['<a href="https://example.com/post" target="_blank">https://example.com/post</a>)']);

check('url with query string',
  'https://example.com/s?a=1&b=2',
  ['href="https://example.com/s?a=1&amp;b=2"']);

check('www autolink',
  '打开 www.example.com 看看',
  ['href="http://www.example.com"']);

check('markdown link',
  '[站点](https://example.com)',
  ['<a href="https://example.com" target="_blank">站点</a>']);

check('image becomes link',
  '![截图](https://example.com/a.png)',
  ['<a href="https://example.com/a.png" target="_blank">[截图]</a>'],
  ['<img']);

check('raw html stays literal',
  '<script>alert(1)</script>',
  ['&lt;script&gt;'],
  ['<script>']);

check('bold italic combo', '***两者***', ['<em><strong>两者</strong></em>']);

check('cjk bold next to punctuation', '**重点**：别忘', ['<strong>重点</strong>：别忘']);

// --- lists ------------------------------------------------------------------
check('task list',
  '- [ ] 待办\n- [x] 已完成',
  ['<ul>', 'task-box', 'task-box is-done', '待办', '已完成']);

check('nested list',
  '- 一级\n  - 二级\n- 同级',
  ['<ul><li>一级<ul><li>二级</li></ul></li><li>同级</li></ul>']);

check('loose list keeps one list',
  '- 甲\n\n- 乙',
  ['<ul><li>甲</li><li>乙</li></ul>']);

check('ordered list start',
  '3. 三\n4. 四',
  ['<ol start="3">', '<li>三</li>', '<li>四</li>']);

// --- results ----------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });

for (const failure of failures) {
  console.log('FAIL ' + failure.name);
  if (failure.missing.length) {
    console.log('  missing : ' + JSON.stringify(failure.missing));
  }
  if (failure.unwanted.length) {
    console.log('  unwanted: ' + JSON.stringify(failure.unwanted));
  }
  console.log('  html    : ' + failure.html);
}
console.log(pass + ' passed, ' + failures.length + ' failed');
process.exit(failures.length ? 1 : 0);