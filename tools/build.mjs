// Build script.
//   node tools/build.mjs
// 1. Copies shared/deadline-core.js -> extension/core.js
// 2. Compiles Tailwind CSS (uses the tailwindcss + @tailwindcss/postcss already installed in ../../node_modules)
// 3. Inlines CSS + core into web/src/index.template.html -> web/DeadlineSync-PK.html (one self-contained file)
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));

copyFileSync(join(root, 'shared', 'deadline-core.js'), join(root, 'extension', 'core.js'));

const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');

const tplPath = join(root, 'web', 'src', 'index.template.html');
const cssPath = join(root, 'web', 'src', 'styles.css');
const css = await postcss([tailwind({ optimize: { minify: true } })]).process(readFileSync(cssPath, 'utf8'), { from: cssPath });

let html = readFileSync(tplPath, 'utf8');
const core = readFileSync(join(root, 'shared', 'deadline-core.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
let gcid = '';
try { gcid = String(JSON.parse(readFileSync(join(root, 'web', 'config.json'), 'utf8')).googleClientId || '').replace(/[^A-Za-z0-9._-]/g, ''); } catch (e) { /* no config: users paste their own Client ID */ }
for (const [marker, value] of [['/*__CSS__*/', css.css], ['/*__CORE__*/', core], ['/*__GCID__*/', gcid]]) {
  if (!html.includes(marker)) throw new Error('marker missing in template: ' + marker);
  html = html.split(marker).join(value); // split/join: no $-pattern surprises like String.replace
}
const out = join(root, 'web', 'DeadlineSync-PK.html');
writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(1)} KB, css ${(css.css.length / 1024).toFixed(1)} KB)`);
