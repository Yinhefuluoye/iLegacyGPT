import { build, transform } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = here;                         // web/
const dist = join(root, 'dist');
const shellWeb = resolve(root, '..', 'ios', 'Resources', 'web');
const es5Dir = join(root, '.build', 'es5');

mkdirSync(dist, { recursive: true });
mkdirSync(shellWeb, { recursive: true });

// 1. TypeScript to ES5, then bundle. esbuild cannot lower to ES5, so tsc emits first
// and esbuild only bundles the result. iOS 9.3 WebKit has no let, arrow or class.
rmSync(join(root, '.build'), { recursive: true, force: true });
execFileSync(process.execPath, [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p', join(root, 'tsconfig.es5.json')
], { stdio: 'inherit' });
if (!existsSync(join(es5Dir, 'main.js'))) {
  throw new Error('tsc did not emit ES5 output into ' + es5Dir);
}
// the emitted files are CommonJS, but web/package.json declares "type": "module"
writeFileSync(join(es5Dir, 'package.json'), '{ "type": "commonjs" }\n', 'utf8');

await build({
  entryPoints: [join(es5Dir, 'main.js')],
  outfile: join(dist, 'app.js'),
  bundle: true,
  format: 'iife',
  target: ['es5'],
  platform: 'browser',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info'
});

// The bundle must parse as ES5: catch a regression before it reaches the iPad.
{
  const code = readFileSync(join(dist, 'app.js'), 'utf8');
  try {
    await transform(code, { target: 'es5', loader: 'js' });
  } catch (err) {
    throw new Error('bundle still contains syntax iOS 9 WebKit cannot parse: ' + err.message);
  }
  const leftovers = [/\bclass\s+[A-Za-z_$]/, /=>/, /\bconst\s/, /\blet\s/].filter((re) => re.test(code));
  if (leftovers.length) {
    throw new Error('bundle is not ES5 (matched ' + leftovers.map(String).join(', ') + ')');
  }
}

// 2. stylesheet = prototype tokens + production additions
const css =
  readFileSync(join(root, 'src', 'styles.css'), 'utf8') +
  '\n/* ---- production ---- */\n' +
  readFileSync(join(root, 'src', 'extra.css'), 'utf8');

// Guard rails: the target is iOS 10.3 WebKit (Safari 10.1). These features are
// silently ignored there and usually break layout in subtle ways, so fail the
// build instead of shipping them.
const FORBIDDEN_CSS = [
  [/(?:^|[;{\s])inset\s*:/, 'CSS `inset` shorthand'],
  [/(?:^|[;{\s])gap\s*:/, 'flex/grid `gap`'],
  [/:has\(/, ':has()'],
  [/aspect-ratio\s*:/, 'aspect-ratio'],
  [/\b(?:dvh|svh)\b/, 'dvh/svh units'],
  [/backdrop-filter/, 'backdrop-filter'],
  [/scroll-behavior\s*:\s*smooth/, 'scroll-behavior: smooth'],
  [/position\s*:\s*sticky/, 'position: sticky']
];
for (const [re, why] of FORBIDDEN_CSS) {
  if (re.test(css)) {
    throw new Error('CSS uses ' + why + ', which iOS 10 WebKit does not support');
  }
}
writeFileSync(join(dist, 'app.css'), css, 'utf8');

// 3. single self-contained html shell (external CSS/JS do not survive the
//    SVG foreignObject snapshot used for screenshots, and one file is a
//    simpler WKWebView load anyway)
const js = readFileSync(join(dist, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="app\.css">/, function () {
  return '<style>\n' + css + '\n</style>';
});
html = html.replace(/<script src="app\.js"><\/script>/, function () {
  return '<script>\n' + js + '\n</script>';
});
if (html.indexOf('<style>') < 0 || html.indexOf('<script>') < 0) {
  throw new Error('failed to inline css/js into index.html');
}
writeFileSync(join(dist, 'index.html'), html, 'utf8');

// 4. ship only the self-contained shell into the native app resources
rmSync(join(shellWeb, 'app.js'), { force: true });
rmSync(join(shellWeb, 'app.css'), { force: true });
copyFileSync(join(dist, 'index.html'), join(shellWeb, 'index.html'));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('web build ok ->', shellWeb);
console.log('  index.html', kb(Buffer.byteLength(html)));
console.log('  (bundled js ' + kb(Buffer.byteLength(js)) + ', css ' + kb(Buffer.byteLength(css)) + ')');