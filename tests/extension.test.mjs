// Loads extension/background.js in a sandbox with a mocked chrome.* API and drives it end to end.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ext = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

function makeEnv({ fetch } = {}) {
  const store = {};
  const alarms = new Map();
  const notes = [];
  const badge = { text: '' };
  const handlers = {};
  const chrome = {
    storage: {
      local: {
        async get(k) { return k in store ? { [k]: JSON.parse(JSON.stringify(store[k])) } : {}; },
        async set(o) { for (const k of Object.keys(o)) store[k] = JSON.parse(JSON.stringify(o[k])); },
      },
      onChanged: { addListener() {} },
    },
    alarms: {
      create(n, i) { alarms.set(n, { name: n, scheduledTime: i.when, periodInMinutes: i.periodInMinutes }); },
      async get(n) { return alarms.get(n); },
      async getAll() { return [...alarms.values()]; },
      async clear(n) { alarms.delete(n); },
      onAlarm: { addListener(f) { handlers.alarm = f; } },
    },
    action: { async setBadgeText({ text }) { badge.text = text; }, async setBadgeBackgroundColor() {} },
    notifications: { create(id, o) { notes.push({ id, ...o }); }, clear() {}, onClicked: { addListener() {} } },
    contextMenus: { removeAll(cb) { cb && cb(); }, create() {}, onClicked: { addListener() {} } },
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(f) { handlers.message = f; } } },
    tabs: { create() {}, async sendMessage() {} },
  };
  const ctx = vm.createContext({
    chrome, console, fetch, AbortController, setTimeout, clearTimeout, URL, TextEncoder, JSON,
    importScripts: (f) => vm.runInContext(readFileSync(join(ext, f), 'utf8'), ctx, { filename: f }),
  });
  ctx.self = ctx;
  vm.runInContext(readFileSync(join(ext, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  return { ctx, store, alarms, notes, badge, handlers, DPK: ctx.DPK, DC: ctx.DeadlineCore };
}
const aiReply = (obj, status = 200) => async () => ({
  ok: status === 200, status,
  json: async () => (status === 200 ? { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } : { error: { message: 'boom' } }),
});

t('manifest is valid MV3 and every referenced file exists', () => {
  const m = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  const files = [m.background.service_worker, m.action.default_popup, m.options_ui.page, ...m.content_scripts.flatMap((c) => [...c.js, ...c.css]),
    ...Object.values(m.icons), ...Object.values(m.action.default_icon)];
  files.forEach((f) => assert.ok(existsSync(join(ext, f)), 'missing ' + f));
  ['contextMenus', 'storage', 'notifications', 'alarms'].forEach((p) => assert.ok(m.permissions.includes(p), p));
});

t('every extension script parses', () => {
  ['background.js', 'content.js', 'popup.js', 'options.js', 'core.js'].forEach((f) => new vm.Script(readFileSync(join(ext, f), 'utf8'), { filename: f }));
});

t('icons are real PNGs', () => {
  [16, 32, 48, 128].forEach((s) => {
    const b = readFileSync(join(ext, 'icons', `icon${s}.png`));
    assert.equal(b.slice(1, 4).toString(), 'PNG');
    assert.equal(b.readUInt32BE(16), s); assert.equal(b.readUInt32BE(20), s);
  });
});

t('offline pin: WhatsApp date anchors "kal"', async () => {
  const e = makeEnv({ fetch: () => { throw new Error('no network expected'); } });
  const r = await e.DPK.handlePin({ text: 'Quiz kal hai 9 baje', pageUrl: 'https://web.whatsapp.com/', pageTitle: 'WhatsApp', sentAt: '2020-01-10' });
  assert.equal(r.ok, true);
  assert.equal(r.deadline.date, '2020-01-11');
  assert.equal(r.deadline.time, '09:00');
  assert.equal(r.deadline.confidence, 'high');
  assert.equal(r.deadline.done, false);
  assert.equal(e.store.deadlines.length, 1);
  assert.equal(e.badge.text, '1');
});

t('duplicate pin is not stored twice', async () => {
  const e = makeEnv({});
  const m = { text: 'Assignment Friday tak', pageUrl: 'https://x.test/', pageTitle: 'X' };
  await e.DPK.handlePin(m);
  const r = await e.DPK.handlePin(m);
  assert.equal(r.duplicate, true);
  assert.equal(e.store.deadlines.length, 1);
});

t('concurrent pins all survive (storage queue)', async () => {
  const e = makeEnv({});
  await Promise.all(['Quiz 1 kal', 'Quiz 2 parson', 'Lab 3 jumma', 'Viva somwar', 'Final 15 Dec 2099'].map((text) => e.DPK.handlePin({ text, pageUrl: 'https://x.test/', pageTitle: 'X' })));
  assert.equal(e.store.deadlines.length, 5);
  assert.equal(new Set(e.store.deadlines.map((d) => d.id)).size, 5);
  assert.equal(e.badge.text, '5');
});

t('timed future deadline schedules 24h + 1h alarms; done clears them and the badge', async () => {
  const e = makeEnv({});
  const r = await e.DPK.handlePin({ text: 'Submit report 5 March 2099 at 3pm', pageUrl: 'https://x.test/', pageTitle: 'X' });
  const id = r.deadline.id;
  assert.equal(r.deadline.date, '2099-03-05');
  assert.equal(r.deadline.time, '15:00');
  const t0 = new Date(2099, 2, 5, 15, 0).getTime();
  assert.equal(e.alarms.get(`dl:${id}:24h`).scheduledTime, t0 - 86400000);
  assert.equal(e.alarms.get(`dl:${id}:1h`).scheduledTime, t0 - 3600000);
  e.store.deadlines[0].done = true;
  await e.DPK.reconcile();
  assert.equal([...e.alarms.keys()].filter((k) => k.startsWith('dl:')).length, 0);
  assert.equal(e.badge.text, '');
});

t('all-day deadline: evening-before + morning-of reminders', async () => {
  const e = makeEnv({});
  const r = await e.DPK.handlePin({ text: 'Project due 20 June 2099', pageUrl: 'https://x.test/', pageTitle: 'X' });
  const id = r.deadline.id;
  assert.equal(e.alarms.get(`dl:${id}:eve`).scheduledTime, new Date(2099, 5, 19, 18, 0).getTime());
  assert.equal(e.alarms.get(`dl:${id}:morning`).scheduledTime, new Date(2099, 5, 20, 8, 0).getTime());
});

t('alarm fire -> notification; done items stay silent', async () => {
  const e = makeEnv({});
  const r = await e.DPK.handlePin({ text: 'Quiz 5 March 2099 at 3pm', pageUrl: 'https://x.test/', pageTitle: 'X' });
  await e.handlers.alarm({ name: `dl:${r.deadline.id}:24h` });
  assert.equal(e.notes.length, 1);
  assert.match(e.notes[0].title, /^Deadline Tomorrow: Quiz/);
  assert.equal(e.notes[0].iconUrl, 'icons/icon128.png');
  e.store.deadlines[0].done = true;
  await e.handlers.alarm({ name: `dl:${r.deadline.id}:24h` });
  assert.equal(e.notes.length, 1);
});

t('AI path: request shape + AI result wins', async () => {
  let seen;
  const e = makeEnv({ fetch: async (url, init) => { seen = { url, init }; return aiReply({ title: 'Physics quiz', date: '2020-02-03', time: '09:00', confidence: 'high', original: 'x' })(); } });
  await e.ctx.chrome.storage.local.set({ settings: { apiKey: 'sk-test', model: 'claude-sonnet-4-6', useAI: true } });
  const r = await e.DPK.handlePin({ text: 'Quiz kal hai 9 baje', pageUrl: 'https://x.test/', pageTitle: 'X', sentAt: '2020-02-02' });
  assert.equal(r.ai, true);
  assert.equal(r.deadline.title, 'Physics quiz');
  assert.equal(r.deadline.date, '2020-02-03');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'sk-test');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'claude-sonnet-4-6');
  assert.equal(body.max_tokens, 300);
  const realToday = e.DC.toISO(new Date());
  assert.ok(body.system.includes("Today's date is " + realToday));
  assert.match(body.system, /'kal' = tomorrow/);
  assert.match(body.messages[0].content, /sent on 2020-02-02/); // message date is given separately from today
  assert.match(body.messages[0].content, /resolved the date as 2020-02-03/); // local pre-pass hint reaches the model
  assert.match(body.messages[0].content, /Quiz kal hai 9 baje$/);
});

t('AI fenced JSON reply still parses', async () => {
  const e = makeEnv({ fetch: aiReply('```json\n{"title":"T","date":"2099-02-03","time":null,"confidence":"medium","original":"x"}\n```') });
  await e.ctx.chrome.storage.local.set({ settings: { apiKey: 'k' } });
  const r = await e.DPK.handlePin({ text: 'Quiz kal', pageUrl: 'https://x.test/', pageTitle: 'X' });
  assert.equal(r.ai, true);
  assert.equal(r.deadline.date, '2099-02-03');
});

t('AI failure falls back to the offline parser', async () => {
  const e = makeEnv({ fetch: aiReply({}, 500) });
  await e.ctx.chrome.storage.local.set({ settings: { apiKey: 'k' } });
  const r = await e.DPK.handlePin({ text: 'Quiz kal hai 9 baje', pageUrl: 'https://x.test/', pageTitle: 'X', sentAt: '2020-01-10' });
  assert.equal(r.ok, true);
  assert.equal(r.ai, false);
  assert.match(r.aiError, /500/);
  assert.equal(r.deadline.date, '2020-01-11');
});

t('AI network error falls back too', async () => {
  const e = makeEnv({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await e.ctx.chrome.storage.local.set({ settings: { apiKey: 'k' } });
  const r = await e.DPK.handlePin({ text: 'Lab parson', pageUrl: 'https://x.test/', pageTitle: 'X' });
  assert.equal(r.ok, true);
  assert.ok(r.aiError);
});

t('useAI=false never calls the network', async () => {
  const e = makeEnv({ fetch: () => { throw new Error('must not be called'); } });
  await e.ctx.chrome.storage.local.set({ settings: { apiKey: 'k', useAI: false } });
  const r = await e.DPK.handlePin({ text: 'Lab parson', pageUrl: 'https://x.test/', pageTitle: 'X' });
  assert.equal(r.ai, false);
  assert.equal(r.aiError, null);
});

t('mergeAI: null AI date keeps local date with lower confidence; invalid AI date ignored', () => {
  const e = makeEnv({});
  const local = { title: 'Quiz', date: '2099-01-02', time: null, confidence: 'high' };
  const a = e.DPK.mergeAI(local, { title: 'Quiz 1', date: null, confidence: 'high' });
  assert.equal(a.date, '2099-01-02'); assert.equal(a.confidence, 'medium'); assert.equal(a.title, 'Quiz 1');
  const b = e.DPK.mergeAI(local, { date: '31/02/2099', confidence: 'high' });
  assert.equal(b.date, '2099-01-02');
  const c = e.DPK.mergeAI({ title: 'x', date: null, time: null, confidence: 'low' }, { date: null });
  assert.equal(c.date, null); assert.equal(c.confidence, 'low');
});

t('runtime message handler responds asynchronously (returns true)', async () => {
  const e = makeEnv({});
  const res = await new Promise((resolve) => {
    const ret = e.handlers.message({ action: 'parseDeadline', text: 'Quiz kal', pageUrl: 'https://x.test/', pageTitle: 'X' }, {}, resolve);
    assert.equal(ret, true);
  });
  assert.equal(res.ok, true);
});

t('empty / junk text is rejected', async () => {
  const e = makeEnv({});
  assert.equal((await e.DPK.handlePin({ text: ' ' })).ok, false);
  assert.equal(e.store.deadlines, undefined);
});

t('system prompt carries dynamic date and the Urdu glossary', () => {
  const e = makeEnv({});
  const p = e.DPK.buildSystemPrompt(new Date(2026, 10, 23));
  assert.match(p, /2026-11-23 \(Monday\)/);
  ['kal', 'parson', 'Jumma', 'Somwar', 'Mangal', 'Budh', 'Jumerat', 'Hafta', 'Itwar'].forEach((w) => assert.ok(p.includes(w), w));
});

t('digest: buckets overdue/today/tomorrow/week, skips done, null when empty', () => {
  const e = makeEnv({});
  const now = new Date(2026, 10, 23, 8, 0);
  const L = [
    { title: 'Old', date: '2026-11-20' }, { title: 'Quiz', date: '2026-11-23', time: '09:00' },
    { title: 'Lab', date: '2026-11-24' }, { title: 'Paper', date: '2026-11-28' },
    { title: 'Far', date: '2026-12-25' }, { title: 'Done', date: '2026-11-23', done: true },
  ];
  const dg = e.DPK.digestText(L, now);
  assert.deepEqual(JSON.parse(JSON.stringify(dg.counts)), { overdue: 1, today: 1, tomorrow: 1, week: 1 });
  assert.match(dg.text, /Quiz \(09:00\)/);
  assert.ok(!dg.text.includes('Done') && !dg.text.includes('Far'));
  assert.equal(e.DPK.digestText([{ title: 'Far', date: '2026-12-25' }], now), null);
});

t('digest alarm: daily, at chosen hour, off when disabled', async () => {
  const e = makeEnv({});
  await e.DPK.ensureDigestAlarm();
  const a = e.alarms.get('digest');
  assert.equal(a.periodInMinutes, 1440);
  assert.equal(new Date(a.scheduledTime).getHours(), 8);
  assert.ok(a.scheduledTime > Date.now());
  e.store.settings = { digestHour: 20 };
  await e.DPK.ensureDigestAlarm();
  assert.equal(new Date(e.alarms.get('digest').scheduledTime).getHours(), 20);
  e.store.settings = { digest: false };
  await e.DPK.ensureDigestAlarm();
  assert.equal(e.alarms.has('digest'), false);
});

t('digest alarm fires a notification; reconcile leaves the digest alarm alone', async () => {
  const e = makeEnv({});
  const iso = e.DC.toISO(new Date());
  e.store.deadlines = [{ id: 1, title: 'Quiz', date: iso, done: false }];
  await e.DPK.ensureDigestAlarm();
  await e.DPK.reconcile();
  assert.ok(e.alarms.has('digest'));
  await e.handlers.alarm({ name: 'digest' });
  assert.equal(e.notes.length, 1);
  assert.match(e.notes[0].title, /1 today/);
  e.store.settings = { digest: false };
  await e.handlers.alarm({ name: 'digest' });
  assert.equal(e.notes.length, 1);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; } catch (err) { fail++; console.log('FAIL', name, '\n   ', String(err.message).split('\n').slice(0, 5).join('\n    ')); }
  }
  console.log(`extension tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
