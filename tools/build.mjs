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
// Printable flyer with a QR code (generated here, inline SVG, no external requests)
const APP_URL = 'https://gi-v.github.io/deadline-pk/';
const qr = require('qrcode-generator')(0, 'M');
qr.addData(APP_URL); qr.make();
const flyer = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeadlineSync PK — flyer</title>
<style>body{margin:0;background:#f6f1e4;color:#1d1b16;font-family:Georgia,serif;text-align:center}main{max-width:640px;margin:0 auto;padding:32px 20px}h1{font-size:2.2rem;margin:.2em 0}p,li{font-size:1.15rem;line-height:1.5}ol{text-align:left;display:inline-block}.qr{width:260px;height:260px;margin:16px auto;display:block;background:#fff;padding:12px;border:3px solid #1d1b16}.ur{color:#1f7a4d;font-weight:bold}small{display:block;margin-top:18px}@media print{body{background:#fff}}</style></head>
<body><main>
<h1>📌 Deadline miss mat karein</h1>
<p>Class group ka message paste karein — date aur time khud mil jayega, aur phone ke calendar mein reminder lag jayega.</p>
<p class="ur">Free · No login · Roman Urdu, اردو, English</p>
<div class="qr">${qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true })}</div>
<p><strong>${APP_URL.replace('https://', '')}</strong></p>
<ol><li>Scan the QR (Chrome) → Install / Add to Home Screen.</li><li>WhatsApp mein message dabayein → Share → DeadlineSync.</li><li>Date check karein → Save → Add to calendar.</li></ol>
<small>Your list stays on your phone. Nothing is uploaded.</small>
</main></body></html>`;
writeFileSync(join(root, 'web', 'flyer.html'), flyer);
console.log(`built${out} (${(html.length / 1024).toFixed(1)} KB, css ${(css.css.length / 1024).toFixed(1)} KB)`);
