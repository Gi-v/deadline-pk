/* DeadlinePinPK popup. All user text is inserted with textContent (never innerHTML). */
(() => {
  const DC = window.DeadlineCore;
  const $ = (s) => document.querySelector(s);
  const DAY = 86400000;

  let deadlines = [];
  let tab = 'all';
  let openId = null;
  let editId = null;

  /* ---------------------------------------------------------- helpers */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c)); });
    return n;
  }
  const todayStart = () => DC.startOfDay(new Date());
  function dayDiff(iso) {
    const d = DC.fromISO(iso);
    if (!d) return null;
    const t = todayStart();
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / DAY);
  }
  function relLabel(d) {
    const n = dayDiff(d.date);
    if (n === null) return null;
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n < 0) return 'Overdue ' + -n + 'd';
    if (n < 14) return 'In ' + n + ' days';
    return null;
  }
  function sortKey(d) {
    const n = DC.isValidISO(d.date) ? d.date + ' ' + (d.time || '23:59') : null;
    return n;
  }
  function cmp(a, b) {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka && kb) return ka < kb ? -1 : ka > kb ? 1 : 0;
    if (ka) return -1;
    if (kb) return 1;
    return (b.pinned || 0) - (a.pinned || 0);
  }
  function inTab(d, name) {
    const n = dayDiff(d.date);
    if (name === 'done') return d.done;
    if (d.done) return false;
    if (name === 'all') return true;
    if (name === 'today') return n === 0;
    if (name === 'week') return n !== null && n >= 0 && n <= 6;
    return true;
  }
  function host(d) {
    if (/^https?:/i.test(d.sourceUrl || '')) {
      try {
        const u = new URL(d.sourceUrl);
        const name = u.hostname.replace(/^www\./, '');
        return { name: name === 'web.whatsapp.com' ? 'WhatsApp Web' : name, icon: u.origin + '/favicon.ico' };
      } catch (e) { /* fall through */ }
    }
    return { name: d.source || 'Added manually', icon: null };
  }
  let statusTimer;
  function say(text) {
    const s = $('#status');
    s.textContent = text;
    s.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => s.classList.remove('show'), 2600);
  }

  /* ---------------------------------------------------------- storage */
  async function load() {
    const r = await chrome.storage.local.get('deadlines');
    deadlines = Array.isArray(r.deadlines) ? r.deadlines : [];
  }
  async function save() {
    await chrome.storage.local.set({ deadlines });
  }
  function mutate(id, fn) {
    const d = deadlines.find((x) => x.id === id);
    if (d) fn(d);
    return save().then(render);
  }

  /* ---------------------------------------------------------- render */
  function render() {
    // tab counts + selection
    document.querySelectorAll('#tabs button').forEach((b) => {
      const name = b.dataset.tab;
      b.setAttribute('aria-selected', String(name === tab));
      b.querySelector('.n').textContent = deadlines.filter((d) => inTab(d, name)).length || '';
    });

    const list = $('#list');
    list.textContent = '';
    const items = deadlines.filter((d) => inTab(d, tab)).sort(cmp);
    if (tab === 'done') items.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    if (!items.length) {
      list.append(
        h('div', { class: 'empty' },
          h('span', { class: 'big' }, tab === 'done' ? '✅' : '📌'),
          tab === 'done' ? 'Nothing done yet.' : deadlines.some((d) => !d.done) ? 'Nothing here.' : 'Highlight any deadline text and tap 📌 to pin it.'
        )
      );
      return;
    }
    items.forEach((d) => list.append(card(d)));
  }

  function card(d) {
    const validDate = DC.isValidISO(d.date);
    const rel = validDate && !d.done ? relLabel(d) : null;
    const n = validDate ? dayDiff(d.date) : null;
    const low = d.confidence === 'low' || !validDate;
    const src = host(d);
    const open = openId === d.id;

    const when = validDate
      ? h('div', { class: 'when' }, DC.describeDate(d.date) + (d.time ? ' · ' + d.time : ''), rel ? h('span', { class: 'rel' }, '  ' + rel) : null)
      : h('div', { class: 'when' }, 'No date found');

    const img = src.icon ? h('img', { src: src.icon, alt: '', onerror: (e) => e.target.remove() }) : null;

    const el = h('div', { class: 'card' + (low ? ' low' : '') + (d.done ? ' done' : '') + (n !== null && n < 0 && !d.done ? ' overdue' : '') + (open ? ' open' : ''), 'data-id': d.id },
      h('div', { class: 'row' },
        h('div', { class: 'main', onclick: () => { if (el.__moved) return; openId = open ? null : d.id; editId = null; render(); } },
          h('div', { class: 'title' }, d.title || 'Untitled'),
          when,
          h('div', { class: 'meta' },
            img, h('span', { class: 'host', title: src.name }, src.name),
            h('span', { class: 'badge b-' + (d.confidence || 'low') }, d.confidence || 'low'),
            low ? h('span', { class: 'check' }, '⚠️ Check date') : null
          )
        ),
        h('div', { class: 'actions' },
          d.done
            ? h('button', { class: 'ok', title: 'Mark as not done', onclick: () => mutate(d.id, (x) => { x.done = false; delete x.doneAt; }) }, '↩ Undo')
            : h('button', { class: 'ok', title: 'Mark done', onclick: () => mutate(d.id, (x) => { x.done = true; x.doneAt = Date.now(); }) }, '✓ Done'),
          h('button', { class: 'del', title: 'Delete', onclick: () => { deadlines = deadlines.filter((x) => x.id !== d.id); save().then(render); } }, '🗑 Delete')
        )
      ),
      h('div', { class: 'details' },
        h('div', null,
          editId === d.id ? editForm(d) : [
            h('div', { class: 'orig' }, d.original || ''),
            h('div', { class: 'link-row' },
              h('button', { onclick: () => { editId = d.id; render(); } }, '✏️ Edit title / date'),
              /^https?:/i.test(d.sourceUrl || '') ? h('button', { onclick: () => chrome.tabs.create({ url: d.sourceUrl }) }, '↗ Open source') : null,
              d.ai ? h('span', { class: 'meta' }, '✨ AI-checked') : null
            ),
            validDate ? h('div', { class: 'link-row' },
              h('button', { onclick: () => chrome.tabs.create({ url: DC.gcalUrl(d) }) }, '📅 Google Calendar'),
              h('button', { onclick: openWhatsApp(d) }, '💬 WhatsApp'),
              h('button', { onclick: () => chrome.tabs.create({ url: DC.mailUrl(d) }) }, '✉️ Email')
            ) : null,
          ]
        )
      )
    );
    attachSwipe(el, d);
    return el;
  }

  // Opens WhatsApp with the reminder pre-filled (to your own number if saved in settings). WhatsApp can't be auto-sent; you press send.
  function openWhatsApp(d) {
    return async () => {
      const { settings } = await chrome.storage.local.get('settings');
      chrome.tabs.create({ url: DC.waUrl(DC.shareText(d), settings && settings.waNumber) });
    };
  }

  function editForm(d) {
    const t = h('input', { class: 'full', value: d.title || '', 'aria-label': 'Title' });
    const dt = h('input', { type: 'date', value: DC.isValidISO(d.date) ? d.date : '', 'aria-label': 'Date' });
    const tm = h('input', { type: 'time', value: DC.isValidTime(d.time) ? d.time : '', 'aria-label': 'Time' });
    return h('div', { class: 'edit' }, t, dt, tm,
      h('div', { class: 'btns' },
        h('button', { onclick: () => { editId = null; render(); } }, 'Cancel'),
        h('button', {
          class: 'save',
          onclick: () => {
            editId = null;
            mutate(d.id, (x) => {
              x.title = t.value.trim() || x.title;
              x.date = dt.value || null;
              x.time = tm.value || null;
              if (x.date) x.confidence = 'high'; // the user just confirmed it
            });
          },
        }, 'Save')
      )
    );
  }

  /* swipe left (touch, pen or mouse drag) = mark done */
  function attachSwipe(el, d) {
    if (d.done) return;
    let x0 = null, dx = 0, id = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, a, .orig')) return;
      x0 = e.clientX; dx = 0; id = e.pointerId; el.__moved = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (x0 === null || e.pointerId !== id) return;
      dx = Math.min(0, e.clientX - x0);
      if (dx < -6) {
        el.__moved = true;
        try { el.setPointerCapture(id); } catch (err) { /* ignore */ }
        el.style.transition = 'none';
        el.style.transform = 'translateX(' + dx + 'px)';
        el.style.opacity = String(Math.max(0.4, 1 + dx / 300));
      }
    });
    const end = () => {
      if (x0 === null) return;
      x0 = null;
      el.style.transition = '';
      if (dx < -90) {
        el.style.transform = 'translateX(-420px)';
        el.style.opacity = '0';
        setTimeout(() => mutate(d.id, (x) => { x.done = true; x.doneAt = Date.now(); }), 150);
      } else {
        el.style.transform = '';
        el.style.opacity = '';
      }
      setTimeout(() => { el.__moved = false; }, 0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /* ---------------------------------------------------------- actions */
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    openId = editId = null;
    try { sessionStorage.setItem('dpkTab', tab); } catch (err) { /* ignore */ }
    render();
  });

  $('#gear').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL('options.html'));
  });

  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#addInput');
    const text = input.value.trim();
    if (!text) return;
    chrome.runtime.sendMessage({ action: 'parseDeadline', text, pageUrl: '', pageTitle: 'Added manually' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) return say('⚠️ Could not save');
      input.value = '';
      say(res.duplicate ? 'Already pinned' : res.deadline.date ? '✅ Pinned: ' + DC.describeDate(res.deadline.date) : '⚠️ Saved (date unclear)');
    });
  });

  $('#clearBtn').addEventListener('click', () => {
    const n = deadlines.filter((d) => d.done).length;
    if (!n) return say('No done items to clear');
    deadlines = deadlines.filter((d) => !d.done);
    save().then(() => { render(); say('Cleared ' + n + ' done item' + (n > 1 ? 's' : '')); });
  });

  $('#exportBtn').addEventListener('click', () => {
    const open = deadlines.filter((d) => !d.done);
    const usable = open.filter((d) => DC.isValidISO(d.date));
    if (!usable.length) return say(open.length ? 'No pinned item has a valid date yet' : 'Nothing to export');
    const events = usable.map((d) => ({
      title: d.title, date: d.date, time: d.time, type: d.type, uidSeed: String(d.id),
      description: (d.original || '') + (d.sourceUrl ? '\nSource: ' + d.sourceUrl : ''),
    }));
    const ics = DC.buildICS(events, { calName: 'DeadlinePinPK', alarm: '-P1D', alarmTimed: '-PT1H' });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = h('a', { href: url, download: 'deadlines-' + DC.toISO(new Date()) + '.ics' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const skipped = open.length - usable.length;
    say('Exported ' + usable.length + ' deadline' + (usable.length > 1 ? 's' : '') + (skipped ? ' · ' + skipped + ' skipped (no date)' : ''));
  });

  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.deadlines) { deadlines = c.deadlines.newValue || []; render(); }
  });

  try { tab = sessionStorage.getItem('dpkTab') || 'all'; } catch (e) { tab = 'all'; }
  load().then(render);
})();
