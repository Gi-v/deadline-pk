/* DeadlinePinPK — content script.
 * 1) Select text anywhere -> floating "📌 Pin Deadline" button.
 * 2) On web.whatsapp.com: hover a message -> 📌 pins the whole bubble (no selection needed).
 *    The WhatsApp icon is a single floating overlay positioned over the hovered bubble rather than
 *    nodes injected into it: WhatsApp is a React app that re-renders bubbles and would wipe
 *    injected children, and the overlay can never break its layout.
 */
(() => {
  if (window.__dpkLoaded) return;
  window.__dpkLoaded = true;
  const DC = window.DeadlineCore;
  const IS_WA = location.hostname === 'web.whatsapp.com';
  const root = () => document.body || document.documentElement;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = 'dpk-ui ' + cls;
    if (text) n.textContent = text;
    return n;
  }

  /* ------------------------------------------------------------ toast */
  let toastEl = null, toastTimer = null;
  function toast(text, ms) {
    if (!toastEl) {
      toastEl = el('div', 'dpk-toast');
      root().appendChild(toastEl);
    }
    toastEl.textContent = text;
    // restart the transition so back-to-back toasts animate
    toastEl.classList.remove('dpk-show');
    void toastEl.offsetWidth;
    toastEl.classList.add('dpk-show');
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('dpk-show'), ms);
  }

  /* ------------------------------------------------------------ pin */
  function pin(text, sentAt) {
    text = String(text || '').trim();
    if (text.length < 2) return;
    const startedAt = Date.now();
    toast('Parsing deadline...');
    const finish = (msg) => {
      // keep "Parsing…" visible for at least ~600ms so it doesn't flicker
      setTimeout(() => toast(msg, 3200), Math.max(0, 600 - (Date.now() - startedAt)));
    };
    try {
      chrome.runtime.sendMessage(
        { action: 'parseDeadline', text, pageUrl: location.href, pageTitle: document.title, sentAt: sentAt || null },
        (res) => {
          if (chrome.runtime.lastError || !res || !res.ok) return finish('⚠️ Could not save — reload this page and try again');
          const d = res.deadline;
          if (res.duplicate) return finish('Already pinned');
          let msg = d.date && DC.isValidISO(d.date)
            ? '✅ Pinned: ' + DC.describeDate(d.date) + (d.time ? ' ' + d.time : '')
            : '⚠️ Saved (date unclear)';
          if (res.aiError) msg += ' · offline parser used';
          finish(msg);
        }
      );
    } catch (e) {
      finish('⚠️ Extension was updated — reload this page');
    }
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'toast') toast(msg.text, 3200);
  });

  /* ------------------------------------------------------------ selection button */
  let btn = null, pendingText = '';
  function hideBtn() { if (btn) btn.hidden = true; }
  function showBtn(rect) {
    if (!btn) {
      btn = el('button', 'dpk-pin-btn', '📌 Pin Deadline');
      btn.type = 'button';
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection alive
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const t = pendingText;
        hideBtn();
        pin(t, null);
      });
      root().appendChild(btn);
    }
    btn.hidden = false;
    const bw = 130, bh = 34;
    let top = rect.bottom + 8;
    if (top + bh > window.innerHeight) top = Math.max(8, rect.top - bh - 8);
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - bw / 2), window.innerWidth - bw - 8);
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
  }

  document.addEventListener('mouseup', (e) => {
    if (e.target instanceof Element && e.target.closest('.dpk-ui')) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!sel || !sel.rangeCount || text.length < 3) return hideBtn();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return hideBtn();
      pendingText = text.slice(0, 2000);
      showBtn(rect);
    }, 10);
  });
  document.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('.dpk-ui')) hideBtn();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideBtn(); }, true);
  document.addEventListener('scroll', hideBtn, true);

  /* ------------------------------------------------------------ WhatsApp Web */
  if (IS_WA) {
    let waBtn = null, waMsg = null, waTimer = null;

    // data-pre-plain-text looks like "[10:42 am, 22/11/2026] Name: " — the date anchors "kal".
    function sentDate(msgEl) {
      const a = msgEl.getAttribute('data-pre-plain-text') || '';
      const m = /\[[^\],]*,\s*(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})\]/.exec(a);
      if (!m) return null;
      let [, a1, a2, a3] = m;
      let y, mo, d;
      if (a1.length === 4) { y = +a1; mo = +a2; d = +a3; }
      else { d = +a1; mo = +a2; y = a3.length === 2 ? 2000 + +a3 : +a3; if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } }
      const iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      return DC.isValidISO(iso) ? iso : null;
    }
    function bubbleText(msgEl) {
      const spans = [...msgEl.querySelectorAll('span.selectable-text, span[data-testid="selectable-text"]')]
        .filter((s) => !(s.parentElement && s.parentElement.closest('span.selectable-text')));
      const t = spans.map((s) => s.innerText).join('\n').trim();
      return t || (msgEl.innerText || '').replace(/\n?\d{1,2}:\d{2}\s*(?:am|pm)?\s*$/i, '').trim();
    }
    function placeWa() {
      if (!waBtn || !waMsg || !waMsg.isConnected) return hideWa();
      const r = waMsg.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return hideWa();
      waBtn.style.top = Math.max(4, r.top + 2) + 'px';
      waBtn.style.left = Math.min(window.innerWidth - 34, r.right - 4) + 'px';
    }
    function hideWa() { if (waBtn) waBtn.hidden = true; waMsg = null; }
    function showWa(msgEl) {
      if (!waBtn) {
        waBtn = el('button', 'dpk-wa-pin', '📌');
        waBtn.type = 'button';
        waBtn.title = 'Pin this message as a deadline';
        waBtn.addEventListener('mousedown', (e) => e.preventDefault());
        waBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!waMsg) return;
          const text = bubbleText(waMsg), sent = sentDate(waMsg);
          waBtn.textContent = '✓';
          setTimeout(() => waBtn && (waBtn.textContent = '📌'), 900);
          pin(text, sent);
        });
        root().appendChild(waBtn);
      }
      waMsg = msgEl;
      waBtn.hidden = false;
      placeWa();
    }

    document.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.dpk-wa-pin')) return clearTimeout(waTimer);
      const msgEl = t.closest('div[data-pre-plain-text]');
      if (msgEl) {
        clearTimeout(waTimer);
        if (msgEl !== waMsg) showWa(msgEl);
      } else if (waBtn && !waBtn.hidden) {
        clearTimeout(waTimer);
        waTimer = setTimeout(hideWa, 350);
      }
    }, true);
    document.addEventListener('scroll', placeWa, true);
    window.addEventListener('resize', placeWa);
  }
})();
