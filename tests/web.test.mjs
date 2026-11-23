// Static checks on the built single-file web app.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'DeadlineSync-PK.html'), 'utf8');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.log('FAIL', n, '\n   ', e.message.split('\n')[0]); } };

t('no unreplaced build markers', () => { assert.ok(!html.includes('/*__CSS__*/') && !html.includes('/*__CORE__*/')); });
t('self-contained: no external scripts/styles/images', () => {
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+rel=["']stylesheet/i.test(html));
  assert.ok(!/(src|href)=["']https?:\/\/(?!calendar\.google\.com)/i.test(html));
});
t('inline scripts parse', () => {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2);
  blocks.forEach((b, i) => new vm.Script(b, { filename: 'inline-' + i }));
});
t('tailwind compiled the classes the app uses', () => {
  ['.bg-brand', '.text-brand', '.animate-spin', '.sm\\:table-row', '.bg-yellow-50', '.bg-red-50', '.border-dashed'].forEach((c) => assert.ok(html.includes(c), c));
});
t('required UI present', () => {
  ['DeadlineSync', 'Drop your syllabus. Get your calendar.', 'Semester start date', 'Course name', 'Extract Deadlines',
    'Add to Google Calendar', 'Copy as text', 'Free forever. No login. Built for Pakistani students.',
    'Reading your syllabus...', 'Finding deadlines...', 'Building your calendar...', 'claude-sonnet-4-6'].forEach((s) => assert.ok(html.includes(s), s));
});
t('system prompt matches the spec', () => {
  ['You are a deadline extraction engine for university syllabi.', 'RELATIVE: Week X', 'Never hallucinate dates', 'Return ONLY a valid JSON array'].forEach((s) => assert.ok(html.includes(s), s));
});

t('daily tracker + PWA pieces present', () => {
  ['id="mine"', 'id="quickIn"', 'My deadlines', 'Send this week to WhatsApp', 'Save to My deadlines', 'deadlinesync.mine.v1'].forEach((x) => assert.ok(html.includes(x), x));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
  ['manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png'].forEach((f) => assert.ok(existsSync(join(root, f)), f));
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.sizes === '192x192'));
});

console.log(`web tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
