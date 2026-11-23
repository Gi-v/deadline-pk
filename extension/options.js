(() => {
  const $ = (s) => document.querySelector(s);
  const DEFAULTS = { apiKey: '', model: 'claude-sonnet-4-6', useAI: true, endpoint: 'https://api.anthropic.com/v1/messages' };

  const read = () => ({
    apiKey: $('#key').value.trim(),
    model: $('#model').value.trim() || DEFAULTS.model,
    endpoint: $('#endpoint').value.trim() || DEFAULTS.endpoint,
    useAI: $('#useAI').checked,
    waNumber: $('#wa').value.replace(/\D/g, ''),
    digest: $('#digest').checked,
    digestHour: Math.min(23, Math.max(0, parseInt($('#digestHour').value, 10) || 0)),
  });
  function say(text, cls) {
    const m = $('#msg');
    m.textContent = text;
    m.className = cls || '';
  }

  chrome.storage.local.get('settings').then(({ settings }) => {
    const s = Object.assign({}, DEFAULTS, settings || {});
    $('#key').value = s.apiKey;
    $('#model').value = s.model;
    $('#endpoint').value = s.endpoint;
    $('#useAI').checked = s.useAI;
    $('#wa').value = s.waNumber || '';
    $('#digest').checked = s.digest !== false;
    $('#digestHour').value = Number.isInteger(+s.digestHour) ? s.digestHour : 8;
  });

  const ORIGINS = { origins: ['https://*/*', 'http://*/*'] };
  chrome.permissions.contains(ORIGINS).then((on) => { $('#allSites').checked = !!on; });
  $('#allSites').addEventListener('change', async (e) => {
    const want = e.target.checked;
    try {
      if (want) {
        const granted = await chrome.permissions.request(ORIGINS); // must run inside this click
        if (!granted) { e.target.checked = false; return say('Permission not granted, so the button stays off.', 'err'); }
      } else {
        await chrome.permissions.remove(ORIGINS);
      }
      chrome.runtime.sendMessage({ action: 'setAllSites', on: want }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) { e.target.checked = !want; return say('Could not change that: ' + ((res && res.error) || 'unknown error'), 'err'); }
        say(want ? 'On. Reload open tabs to see the 📌 button.' : 'Off.', 'ok');
      });
    } catch (err) {
      e.target.checked = !want;
      say(String((err && err.message) || err), 'err');
    }
  });

  $('#save').addEventListener('click', async () => {
    await chrome.storage.local.set({ settings: read() });
    say('Saved ✓', 'ok');
  });

  $('#test').addEventListener('click', () => {
    say('Testing…');
    chrome.runtime.sendMessage({ action: 'testApi', settings: read() }, (res) => {
      if (chrome.runtime.lastError || !res) return say('Could not reach the extension', 'err');
      if (res.ok) say('Works ✓ — “Quiz kal hai 9 baje” parsed as ' + String(res.sample.date) + ' ' + String(res.sample.time || ''), 'ok');
      else say(res.error, 'err');
    });
  });
})();
