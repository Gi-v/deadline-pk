/* DeadlinePinPK — background service worker.
 * Flow: content script / context menu -> handlePin() -> local Urdu-aware pre-parse
 *       -> (optional) Claude refinement if the user saved an API key -> storage -> alarms + badge.
 * The local parser alone is a complete fallback, so pinning never fails because of the network.
 */
importScripts('core.js');
const DC = self.DeadlineCore;

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-sonnet-4-6',
  useAI: true,
  endpoint: 'https://api.anthropic.com/v1/messages',
  digest: true, // daily summary notification
  digestHour: 8,
};

/* ---------------------------------------------------------------- storage */
// All read-modify-write on "deadlines" goes through one queue so two quick pins never overwrite each other.
let queue = Promise.resolve();
function locked(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return Object.assign({}, DEFAULT_SETTINGS, settings || {});
}
async function getDeadlines() {
  const { deadlines } = await chrome.storage.local.get('deadlines');
  return Array.isArray(deadlines) ? deadlines : [];
}

/* ---------------------------------------------------------------- Urdu pre-pass + Claude */
function preParseUrdu(text, today) {
  return DC.preParseUrdu(text, today);
}

function buildSystemPrompt(today) {
  return (
    "You are a deadline parser. The user will give you a text snippet. Extract the deadline date and event name. " +
    "Understand English AND Roman Urdu date expressions: 'kal' = tomorrow, 'parson' = day after tomorrow, 'agla week' = next week, " +
    "'Jumma' = Friday, 'Somwar' = Monday, 'Mangal' = Tuesday, 'Budh' = Wednesday, 'Jumerat' = Thursday, 'Hafta' = Saturday, 'Itwar' = Sunday. " +
    "Urdu script (کل، پرسوں، جمعہ، بجے) is also possible. 'kal' with a past-tense verb (tha/thi) means yesterday. " +
    'Today\'s date is ' + DC.toISO(today) + ' (' + DC.DAY_NAMES[today.getDay()] + '). ' +
    'Return ONLY valid JSON: {"title": string, "date": "YYYY-MM-DD or null", "time": "HH:MM or null", ' +
    '"confidence": "high|medium|low", "original": string}. No other text.'
  );
}

async function callClaude(settings, text, hint, ref) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(settings.endpoint || DEFAULT_SETTINGS.endpoint, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model || DEFAULT_SETTINGS.model,
        max_tokens: 300,
        system: buildSystemPrompt(ref),
        messages: [{ role: 'user', content: (hint ? hint + '\n\nText to parse:\n' : '') + text }],
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error.message; } catch (e) { /* ignore */ }
      throw new Error('API ' + res.status + (detail ? ': ' + detail : ''));
    }
    const data = await res.json();
    const out = (data.content || []).map((c) => c.text || '').join('');
    const arr = DC.extractJSON(out);
    if (!arr || !arr[0] || typeof arr[0] !== 'object') throw new Error('Unparseable AI reply');
    return arr[0];
  } finally {
    clearTimeout(timer);
  }
}

/** Combine the local parse with the AI parse. Valid AI values win; a local date rescues a null AI date. */
function mergeAI(local, ai) {
  const out = Object.assign({}, local);
  if (ai.title && String(ai.title).trim()) out.title = String(ai.title).trim().slice(0, 120);
  const aiDate = DC.isValidISO(ai.date) ? ai.date : null;
  const aiTime = DC.isValidTime(ai.time) ? ai.time : null;
  const conf = ['high', 'medium', 'low'].indexOf(String(ai.confidence).toLowerCase()) !== -1 ? String(ai.confidence).toLowerCase() : 'medium';
  if (aiDate) {
    out.date = aiDate;
    out.time = aiTime || local.time || null;
    out.confidence = conf;
  } else if (local.date) {
    out.confidence = local.confidence === 'high' ? 'medium' : local.confidence; // AI disagreed: be less sure
    out.time = local.time || aiTime || null;
  } else {
    out.date = null;
    out.time = aiTime;
    out.confidence = 'low';
  }
  return out;
}

/* ---------------------------------------------------------------- pin */
async function handlePin(msg) {
  const text = String((msg && msg.text) || '').trim().slice(0, 2000);
  if (text.length < 2) return { ok: false, error: 'empty' };
  const now = new Date();
  const sent = msg.sentAt ? DC.fromISO(msg.sentAt) : null;
  const ref = sent && sent <= now ? sent : now; // a WhatsApp message's own date anchors "kal"

  const pre = preParseUrdu(text, ref);
  const p = pre.parsed;
  let result = { title: p.title, date: p.date, time: p.time, confidence: p.confidence };
  let ai = false, aiError = null;

  const settings = await getSettings();
  if (settings.apiKey && settings.useAI) {
    try {
      // The system prompt states the real "today"; the hint says when the message itself was written.
      const hint = (ref !== now ? 'This message was sent on ' + DC.toISO(ref) + '. Resolve relative words like "kal" from that date, not from today. ' : '') + pre.hint;
      result = mergeAI(result, await callClaude(settings, text, hint, now));
      ai = true;
    } catch (e) {
      aiError = String((e && e.message) || e).slice(0, 200);
    }
  }

  return locked(async () => {
    const list = await getDeadlines();
    const dup = list.find((d) => d.original === text && d.sourceUrl === (msg.pageUrl || '') && !d.done);
    if (dup) return { ok: true, duplicate: true, deadline: dup, ai, aiError };
    let id = Date.now();
    while (list.some((d) => d.id === id)) id++;
    const record = {
      id,
      title: result.title,
      date: result.date,
      time: result.time,
      confidence: result.confidence,
      type: p.type,
      original: text,
      source: msg.pageTitle || (msg.pageUrl ? new URL(msg.pageUrl).hostname : 'Added manually'),
      sourceUrl: msg.pageUrl || '',
      pinned: Date.now(),
      done: false,
      ai,
    };
    list.push(record);
    await chrome.storage.local.set({ deadlines: list });
    await reconcile(list);
    return { ok: true, deadline: record, ai, aiError };
  });
}

/* ---------------------------------------------------------------- reminders + badge */
function remindersFor(d) {
  const day = DC.fromISO(d.date);
  if (!day) return [];
  if (DC.isValidTime(d.time)) {
    const [h, m] = d.time.split(':').map(Number);
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
    return [
      { kind: '24h', when: t - 24 * 3600 * 1000 },
      { kind: '1h', when: t - 3600 * 1000 },
    ];
  }
  const y = day.getFullYear(), mo = day.getMonth(), da = day.getDate();
  return [
    { kind: 'eve', when: new Date(y, mo, da - 1, 18, 0).getTime() }, // evening before
    { kind: 'morning', when: new Date(y, mo, da, 8, 0).getTime() }, // morning of
  ];
}

async function reconcile(list) {
  list = list || (await getDeadlines());
  const open = list.filter((d) => !d.done);
  try {
    await chrome.action.setBadgeText({ text: open.length ? String(open.length) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  } catch (e) { /* badge is cosmetic */ }

  const want = new Map();
  const soon = Date.now() + 2000;
  open.forEach((d) => remindersFor(d).forEach((r) => { if (r.when > soon) want.set('dl:' + d.id + ':' + r.kind, r.when); }));

  const existing = await chrome.alarms.getAll();
  for (const a of existing) {
    if (!a.name.startsWith('dl:')) continue;
    const w = want.get(a.name);
    if (w === undefined) await chrome.alarms.clear(a.name);
    else if (Math.abs(a.scheduledTime - w) < 1000) want.delete(a.name);
  }
  for (const [name, when] of want) chrome.alarms.create(name, { when });
}

/* ---------------------------------------------------------------- daily digest */
// Pure: builds the digest from the open list. Returns null when there is nothing worth saying.
function digestText(list, now) {
  now = now || new Date();
  const iso = DC.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const tom = DC.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const open = list.filter((d) => !d.done && DC.fromISO(d.date));
  const line = (d) => '• ' + d.title + (DC.isValidTime(d.time) ? ' (' + d.time + ')' : '');
  const sort = (a, b) => (a.time || '99').localeCompare(b.time || '99');
  const overdue = open.filter((d) => d.date < iso);
  const today = open.filter((d) => d.date === iso).sort(sort);
  const tomorrow = open.filter((d) => d.date === tom).sort(sort);
  const week = open.filter((d) => d.date > tom && d.date <= DC.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)));
  if (!overdue.length && !today.length && !tomorrow.length && !week.length) return null;
  const parts = [];
  if (overdue.length) parts.push('⚠️ Overdue (' + overdue.length + '):\n' + overdue.map(line).join('\n'));
  if (today.length) parts.push('📌 Today:\n' + today.map(line).join('\n'));
  if (tomorrow.length) parts.push('⏰ Tomorrow:\n' + tomorrow.map(line).join('\n'));
  if (week.length) parts.push('📅 Next 7 days: ' + week.length + ' more');
  return {
    counts: { overdue: overdue.length, today: today.length, tomorrow: tomorrow.length, week: week.length },
    text: 'Deadline digest\n\n' + parts.join('\n\n'),
  };
}

async function ensureDigestAlarm() {
  const s = await getSettings();
  const existing = await chrome.alarms.get('digest');
  if (s.digest === false) { if (existing) await chrome.alarms.clear('digest'); return; }
  const hour = Number.isInteger(+s.digestHour) && +s.digestHour >= 0 && +s.digestHour <= 23 ? +s.digestHour : 8;
  const n = new Date();
  let when = new Date(n.getFullYear(), n.getMonth(), n.getDate(), hour, 0).getTime();
  if (when <= Date.now() + 2000) when = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, hour, 0).getTime();
  // Keep an alarm already set for the same wall-clock hour; otherwise (re)create.
  if (existing && new Date(existing.scheduledTime).getHours() === hour && existing.periodInMinutes) return;
  await chrome.alarms.create('digest', { when, periodInMinutes: 1440 });
}

async function sendDigest() {
  const s = await getSettings();
  if (s.digest === false) return null;
  const dg = digestText(await getDeadlines());
  if (!dg) return null;
  const c = dg.counts;
  const bits = [];
  if (c.overdue) bits.push(c.overdue + ' overdue');
  if (c.today) bits.push(c.today + ' today');
  if (c.tomorrow) bits.push(c.tomorrow + ' tomorrow');
  if (c.week) bits.push(c.week + ' this week');
  chrome.notifications.create('digest:' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '📌 Your deadlines: ' + bits.join(' · '),
    message: dg.text.replace(/^Deadline digest\n\n/, '').slice(0, 300),
    priority: 1,
  });
  return dg;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'digest') { await sendDigest(); return; }
  const m = /^dl:(\d+):(\w+)$/.exec(alarm.name);
  if (!m) return;
  const d = (await getDeadlines()).find((x) => String(x.id) === m[1]);
  if (!d || d.done) return;
  const titles = { '24h': 'Deadline Tomorrow', eve: 'Deadline Tomorrow', '1h': 'Due in 1 hour', morning: 'Due Today' };
  chrome.notifications.create('dlnote:' + d.id + ':' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: (titles[m[2]] || 'Deadline') + ': ' + d.title,
    message: (d.original || d.title).slice(0, 200),
    priority: 2,
  });
});

chrome.notifications.onClicked.addListener(async (nid) => {
  if (nid.startsWith('digest:')) {
    chrome.notifications.clear(nid);
    const s = await getSettings();
    const dg = digestText(await getDeadlines());
    // Clicking the digest opens WhatsApp with it pre-typed (to your own number if saved); you press send.
    if (dg) chrome.tabs.create({ url: DC.waUrl(dg.text, s.waNumber || '') });
    return;
  }
  const m = /^dlnote:(\d+):/.exec(nid);
  chrome.notifications.clear(nid);
  if (!m) return;
  const d = (await getDeadlines()).find((x) => String(x.id) === m[1]);
  if (d && /^https?:/i.test(d.sourceUrl || '')) chrome.tabs.create({ url: d.sourceUrl });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.deadlines) reconcile(changes.deadlines.newValue || []);
  if (area === 'local' && changes.settings) ensureDigestAlarm();
});

/* ---------------------------------------------------------------- context menu + messages */
function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'dpk-pin', title: '📌 Pin as deadline', contexts: ['selection'] });
  });
}
chrome.runtime.onInstalled.addListener(() => { setupMenus(); reconcile(); });
chrome.runtime.onStartup.addListener(() => reconcile());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'dpk-pin' || !info.selectionText) return;
  let text;
  try {
    const res = await handlePin({ text: info.selectionText, pageUrl: (tab && tab.url) || '', pageTitle: (tab && tab.title) || '' });
    text = res.duplicate ? 'Already pinned' : res.deadline && res.deadline.date ? '✅ Pinned: ' + DC.describeDate(res.deadline.date) + (res.deadline.time ? ' ' + res.deadline.time : '') : '⚠️ Saved (date unclear)';
  } catch (e) {
    text = '⚠️ Could not save deadline';
  }
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { action: 'toast', text }).catch(() => {});
});

async function testApi(s) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
  if (!settings.apiKey) return { ok: false, error: 'No API key entered' };
  try {
    const out = await callClaude(settings, 'Quiz kal hai 9 baje', '', new Date());
    return { ok: true, sample: out };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.action === 'parseDeadline') {
    handlePin(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.action === 'testApi') {
    testApi(msg.settings).then(sendResponse);
    return true;
  }
  return false;
});

// Test hook (harmless in the browser).
self.DPK = { handlePin, reconcile, remindersFor, mergeAI, preParseUrdu, buildSystemPrompt, testApi, digestText, ensureDigestAlarm, sendDigest };
reconcile();
ensureDigestAlarm();
