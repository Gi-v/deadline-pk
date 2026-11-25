/*
 * deadline-core.js — shared engine for DeadlineSync PK (web) and DeadlinePinPK (extension).
 *
 * Works with no network and no API key:
 *   - Roman-Urdu / Urdu-script / English date + time parsing
 *   - event-type detection and clean title extraction
 *   - WhatsApp export prefix stripping
 *   - AI-response normalisation (JSON recovery, relative "Week N" resolution, dedupe)
 *   - RFC 5545 .ics generation (all-day or timed events, VALARM, line folding, UTF-8 safe)
 *
 * UMD: loads as a <script> (window.DeadlineCore / self.DeadlineCore) or via require().
 * Source of truth lives in /shared; build.mjs inlines it into the web app and
 * copies it to extension/core.js. Do not edit the copies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeadlineCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['Quiz', 'Assignment', 'Exam', 'Project', 'Presentation', 'Lab', 'Other'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ------------------------------------------------------------------ date helpers */
  const pad = (n) => String(n).padStart(2, '0');
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const toISO = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  function validDate(y, m, d) {
    const dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
    return dt;
  }
  function fromISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    return m ? validDate(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const isValidISO = (s) => !!fromISO(s);
  function isValidTime(t) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
    return !!m && +m[1] <= 23 && +m[2] <= 59;
  }
  function describeDate(iso) {
    const d = fromISO(iso);
    if (!d) return String(iso || '');
    return DAY_NAMES[d.getDay()].slice(0, 3) + ', ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  }
  const mondayOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
  const nextOnOrAfter = (d, wd) => addDays(d, (wd - d.getDay() + 7) % 7);
  const nextStrictlyAfter = (d, wd) => addDays(d, (wd - d.getDay() + 7) % 7 || 7);
  const prevStrictlyBefore = (d, wd) => addDays(d, -((d.getDay() - wd + 7) % 7 || 7));

  /** Day of week + month/day with no year: pick the year that keeps it near `ref`. */
  function inferYear(month, day, ref, pastDays) {
    let y = ref.getFullYear();
    let c = validDate(y, month, day);
    if (c && c < addDays(ref, -(pastDays == null ? 90 : pastDays))) c = validDate(y + 1, month, day);
    return c;
  }

  /** "RELATIVE: Week 3" / "week 3" + semester start -> ISO (week 1 starts on the start date). */
  function resolveRelative(str, startISO) {
    const m = /week\s*#?\s*(\d{1,2})/i.exec(String(str || ''));
    const start = fromISO(startISO);
    if (!m || !start) return null;
    return toISO(addDays(start, 7 * (+m[1] - 1)));
  }

  /* ------------------------------------------------------------------ text normalisation */
  const B1 = '(?<![\\p{L}\\p{N}_])';
  const B2 = '(?![\\p{L}\\p{N}_])';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = (words) =>
    '(?:' + words.slice().sort((a, b) => b.length - a.length).map(esc).join('|') + ')';

  function normalize(text) {
    return String(text == null ? '' : text)
      .normalize('NFKC')
      .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))
      .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
      .replace(/[\u064B-\u065F\u0670\u200c\u200d\u200e\u200f]/g, '')
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '');
  }
  const blank = (s, a, b) => s.slice(0, a) + ' '.repeat(b - a) + s.slice(b);

  /** Remove "[10:42 am, 22/11/2026] Name:" or "22/11/26, 10:42 - Name:" WhatsApp export prefixes. */
  function stripWhatsAppPrefix(line) {
    return String(line || '')
      .replace(/^\s*\[[^\]\n]{4,40}\]\s*[^:\n]{1,40}:\s*/, '')
      .replace(/^\s*\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*-\s*[^:\n]{1,40}:\s*/i, '');
  }

  /* ------------------------------------------------------------------ vocab */
  const WEEKDAY_WORDS = {
    0: ['sunday', 'sun', 'itwar', 'itwaar', 'etwar', 'aitwar', 'ittwar', 'اتوار'],
    1: ['monday', 'mon', 'somwar', 'somvar', 'sombar', 'peer', 'pir', 'پیر'],
    2: ['tuesday', 'tues', 'tue', 'mangal', 'mangalwar', 'mangl', 'منگل'],
    3: ['wednesday', 'wed', 'budh', 'budhwar', 'budhar', 'بدھ'],
    4: ['thursday', 'thurs', 'thur', 'thu', 'jumerat', 'jumeraat', 'jummerat', 'jumarat', 'jumayrat', 'جمعرات'],
    5: ['friday', 'fri', 'jumma', 'jummah', 'jumah', 'juma', 'jumay', 'jumaay', 'jume', 'jumu', 'جمعہ', 'جمعه'],
    6: ['saturday', 'sat', 'hafta', 'haftah', 'sanichar', 'ہفتہ', 'ہفته'],
  };
  const WORD_TO_WD = {};
  Object.keys(WEEKDAY_WORDS).forEach((k) => WEEKDAY_WORDS[k].forEach((w) => (WORD_TO_WD[w] = +k)));
  const WD_ALT = alt(Object.keys(WORD_TO_WD));

  const MONTHS = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
    june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8,
    october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
  };
  const MONTH_ALT = alt(Object.keys(MONTHS));

  const DP = {
    morning: ['subah', 'subha', 'subeh', 'sawere', 'savere', 'صبح', 'morning'],
    afternoon: ['dopahar', 'dopehar', 'dupahar', 'دوپہر', 'afternoon'],
    evening: ['shaam', 'شام', 'evening'],
    night: ['raat', 'رات', 'night'],
  };
  const DP_ALT = alt([].concat(DP.morning, DP.afternoon, DP.evening, DP.night));
  const dayPartOf = (w) => {
    w = w.toLowerCase();
    for (const k in DP) if (DP[k].indexOf(w) !== -1) return k;
    return null;
  };

  const NEXT_W = '(?:next|agla|agle|agli|اگلے|اگلا|اگلی|coming)';
  const THIS_W = '(?:this|iss|is|اس)';
  const WEEK_W = '(?:week|hafta|hafte|haftah|ہفتے|ہفتہ)';

  const RE = {
    // times
    tBaje: new RegExp(
      B1 + '(?:(' + DP_ALT + ')\\s*(?:ko\\s*)?)?(\\d{1,2})(?::(\\d{2}))?\\s*(?:baje|bje|bajay|bajey|bajy|بجے|o\'clock)' + B2 +
        '(?:\\s*(?:ko\\s*)?(' + DP_ALT + ')' + B2 + ')?', 'giu'),
    tColon: new RegExp(B1 + '(\\d{1,2})([:.])(\\d{2})(?!\\d)(?:\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![\\p{L}]))?', 'giu'),
    tMer: new RegExp(B1 + '(\\d{1,2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![\\p{L}])', 'giu'),
    // Bare "hai 9" / "at 5" / "kal 9": only after a cue word, and only when the number ends the phrase
    // (so "Lab 4 kal", "kal 2 quizzes hain", "by 5 Dec", "chapters 1-3" are NOT times).
    tBare: new RegExp(
      B1 + '(?:at|by|@|ko|hai|he|hy|hay|hain|kal|aaj|parson|today|tomorrow|tonight|until|till)\\s*(\\d{1,2})(?![\\p{N}:./\\/-])' +
        '(?=\\s*(?:$|[.,;!?)]|-\\s|(?:tak|tk|sharp|se|ko|hai|he|hy|hay|hain|ho|ga|gi|ka|ki|ke|par|pe|baad|subah|shaam|raat|dopahar)(?![\\p{L}])))', 'gimu'),
    // "evening 6", "shaam 5", "subah 9": a day-part word directly followed by an hour that ends the phrase.
    tDP: new RegExp(B1 + '(' + DP_ALT + ')\\s*(\\d{1,2})(?![\\p{N}:./\\/-])(?=\\s*(?:$|[.,;!?)]|-\\s|(?:tak|tk|sharp|se|ko|hai|he|hy|hay|hain|ho|ga|gi|ka|ki|ke|par|pe|baad)(?![\\p{L}])))', 'giu'),
    tWord: new RegExp(B1 + '(eod|end of day|cob|midnight|noon)' + B2, 'giu'),
    // absolute dates
    iso: new RegExp('(?<![\\p{N}])(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})(?![\\p{N}])', 'gu'),
    num: new RegExp('(?<![\\p{N}.\\/-])(\\d{1,2})([\\/.-])(\\d{1,2})(?:\\2(\\d{4}|\\d{2}))?(?![\\p{N}]|[\\/.-]\\p{N})', 'gu'),
    dm: new RegExp('(?<![\\p{N}])(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(' + MONTH_ALT + ')\\.?(?![\\p{L}])(?:\\s*,?\\s*(20\\d{2})(?!\\d))?', 'giu'),
    md: new RegExp(B1 + '(' + MONTH_ALT + ')\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?![\\p{N}])(?:\\s*,?\\s*(20\\d{2})(?!\\d))?', 'giu'),
    // relative
    nextWeek: new RegExp(B1 + NEXT_W + '\\s+' + WEEK_W + '(?!\\s*\\d)' + B2, 'giu'),
    thisWeek: new RegExp(B1 + THIS_W + '\\s+' + WEEK_W + '(?!\\s*\\d)' + B2, 'giu'),
    nextWd: new RegExp(B1 + NEXT_W + '\\s+(?:ka\\s+|ke\\s+)?(' + WD_ALT + ')' + B2, 'giu'),
    lastWd: new RegExp(B1 + '(?:last|pichla|pichle|pichli|پچھلے|پچھلا)\\s+(' + WD_ALT + ')' + B2, 'giu'),
    dayAfter: new RegExp(B1 + '(?:day after tomorrow|parson|parso|parsoon|parsoo|پرسوں)' + B2, 'giu'),
    in3: new RegExp(B1 + '(?:narson|narsoo|narsoon|nrson|ترسوں)' + B2, 'giu'),
    tomorrow: new RegExp(B1 + '(?:tomorrow|tommorow|tomorow|tmrw|tmr|kal|kall|کل)' + B2, 'giu'),
    today: new RegExp(B1 + '(?:today|tonight|aaj|aj|آج)' + B2, 'giu'),
    inN1: new RegExp(B1 + 'in\\s+(\\d{1,2})\\s+days?' + B2, 'giu'),
    inN2: new RegExp(B1 + '(\\d{1,2})\\s*(?:din|days?)\\s*(?:baad|bad|mein|me|later)' + B2, 'giu'),
    weekN: new RegExp(B1 + '(?:week|wk|hafta|haftah)\\s*#?\\s*(\\d{1,2})(?![\\p{N}])', 'giu'),
    wd: new RegExp(B1 + '(' + WD_ALT + ')' + B2, 'giu'),
    past: new RegExp(B1 + '(?:tha|thi|hua|hui|huwa|chuka|chuki|was|were|yesterday)' + B2, 'iu'),
  };

  function firstMatch(re, s, accept) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      if (!accept || accept(m)) return m;
      if (m[0].length === 0) re.lastIndex++;
    }
    return null;
  }
  function allMatches(re, s, accept) {
    re.lastIndex = 0;
    const out = [];
    let m;
    while ((m = re.exec(s))) {
      if (!accept || accept(m)) out.push(m);
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }
  // "peer review" is not Monday.
  const wdAccept = (s) => (m) =>
    !(/^(peer|pir)$/i.test(m[1]) && /^\s*(review|feedback|evaluation|assessment|grading|teaching|mentor)/i.test(s.slice(m.index + m[0].length)));

  /* ------------------------------------------------------------------ time */
  function to24(h, mer, dp) {
    let assumed = false;
    if (mer) {
      const pm = /^p/i.test(mer);
      h = pm ? (h % 12) + 12 : h % 12;
    } else if (dp === 'morning') {
      h = h % 12;
    } else if (dp === 'afternoon') {
      if (h >= 1 && h <= 6) h += 12;
    } else if (dp === 'evening') {
      if (h < 12) h += 12;
    } else if (dp === 'night') {
      if (h === 12) h = 0;
      else if (h >= 6 && h < 12) h += 12;
    } else if (h >= 1 && h <= 6) {
      h += 12;
      assumed = true;
    } else if (h <= 12) {
      assumed = true;
    }
    return { h, assumed };
  }

  function findTime(s) {
    const cands = [];
    let m = firstMatch(RE.tBaje, s);
    if (m) {
      const dp = dayPartOf(m[1] || m[4] || '') || null;
      const hh = +m[2], mm = m[3] ? +m[3] : 0;
      if (hh <= 24 && mm < 60) {
        const r = to24(hh === 24 ? 0 : hh, null, dp);
        cands.push({ i: m.index, e: m.index + m[0].length, h: r.h, mm, assumed: r.assumed });
      }
    }
    // "11.59pm" is a time, but "15.10" / "15.10.26" are dates: a dot needs am/pm to count.
    m = firstMatch(RE.tColon, s, (x) => +x[1] <= 24 && +x[3] < 60 && (x[2] === ':' || !!x[4]));
    if (m) {
      const hh = +m[1], mm = +m[3];
      if (m[4]) {
        if (hh >= 1 && hh <= 12) cands.push({ i: m.index, e: m.index + m[0].length, h: to24(hh, m[4]).h, mm, assumed: false });
      } else {
        const r = hh >= 13 ? { h: hh, assumed: false } : to24(hh, null, null);
        cands.push({ i: m.index, e: m.index + m[0].length, h: r.h, mm, assumed: r.assumed });
      }
    }
    m = firstMatch(RE.tMer, s, (x) => +x[1] >= 1 && +x[1] <= 12);
    if (m) cands.push({ i: m.index, e: m.index + m[0].length, h: to24(+m[1], m[2]).h, mm: 0, assumed: false });
    m = firstMatch(RE.tWord, s);
    if (m) {
      const w = m[1].toLowerCase();
      cands.push({ i: m.index, e: m.index + m[0].length, h: w === 'noon' ? 12 : 23, mm: w === 'noon' ? 0 : 59, assumed: false });
    }
    if (!cands.length) {
      m = firstMatch(RE.tDP, s, (x) => +x[2] >= 1 && +x[2] <= 12);
      if (m) {
        const r = to24(+m[2], null, dayPartOf(m[1]));
        cands.push({ i: m.index + m[1].length, e: m.index + m[0].length, h: r.h, mm: 0, assumed: r.assumed });
      }
    }
    if (!cands.length) {
      m = firstMatch(RE.tBare, s, (x) => +x[1] >= 1 && +x[1] <= 12);
      if (m) {
        const r = to24(+m[1], null, null);
        const e = m.index + m[0].length;
        cands.push({ i: e - m[1].length, e, h: r.h, mm: 0, assumed: true });
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.i - b.i);
    const c = cands[0];
    if (c.h > 23) return null;
    return { time: pad(c.h) + ':' + pad(c.mm), start: c.i, end: c.e, assumed: c.assumed };
  }

  /* ------------------------------------------------------------------ date */
  function findDate(s, ctx) {
    const { today, ref, start, pastDays } = ctx;
    const abs = [];

    let m = firstMatch(RE.iso, s, (x) => validDate(+x[1], +x[2] - 1, +x[3]));
    if (m) abs.push({ i: m.index, e: m.index + m[0].length, date: validDate(+m[1], +m[2] - 1, +m[3]), kind: 'iso', conf: 'high' });

    m = firstMatch(RE.num, s, (x) => {
      if (!x[4] && x[2] !== '/') return false;
      let d = +x[1], mo = +x[3];
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
      return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
    });
    if (m) {
      let d = +m[1], mo = +m[3], swapped = false;
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; swapped = true; }
      let y = m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : null;
      const dt = y ? validDate(y, mo - 1, d) : inferYear(mo - 1, d, ref, pastDays);
      if (dt) abs.push({ i: m.index, e: m.index + m[0].length, date: dt, kind: 'numeric', conf: y && !swapped ? 'high' : 'medium' });
    }

    m = firstMatch(RE.dm, s, (x) => !!validDate(2000, MONTHS[x[2].toLowerCase()], +x[1]) || +x[1] === 29);
    if (m) {
      const mo = MONTHS[m[2].toLowerCase()], d = +m[1];
      const dt = m[3] ? validDate(+m[3], mo, d) : inferYear(mo, d, ref, pastDays);
      if (dt) abs.push({ i: m.index, e: m.index + m[0].length, date: dt, kind: 'day-month', conf: 'high' });
    }

    m = firstMatch(RE.md, s, (x) => +x[2] >= 1 && +x[2] <= 31);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()], d = +m[2];
      const dt = m[3] ? validDate(+m[3], mo, d) : inferYear(mo, d, ref, pastDays);
      if (dt) abs.push({ i: m.index, e: m.index + m[0].length, date: dt, kind: 'month-day', conf: 'high' });
    }

    // "Quiz 1 Oct 18": the "1" belongs to the quiz, so "1 Oct" loses to "Oct 18".
    const dmC = abs.find((a) => a.kind === 'day-month'), mdC = abs.find((a) => a.kind === 'month-day');
    if (dmC && mdC && mdC.i < dmC.e && /(?:quiz|assignment|asgn|lab|test|project|hw|homework|chapter|ch|part|set|problem|q|week|wk|lecture|lec|#)\s*$/i.test(s.slice(0, dmC.i))) {
      abs.splice(abs.indexOf(dmC), 1);
    }

    if (abs.length) {
      abs.sort((a, b) => a.i - b.i);
      return abs[0];
    }

    // "hafta" means both "week" and "Saturday": hide week phrases before looking for a weekday.
    let sw = s;
    [RE.nextWeek, RE.thisWeek].forEach((re) => allMatches(re, s).forEach((x) => { sw = blank(sw, x.index, x.index + x[0].length); }));
    const wdTok = firstMatch(RE.wd, sw, wdAccept(sw));
    const wd = wdTok ? WORD_TO_WD[wdTok[1].toLowerCase()] : null;
    const pastWord = RE.past.test(s);

    // "next week" / "agle hafte [monday]"
    m = firstMatch(RE.nextWeek, s);
    if (m) {
      let end = m.index + m[0].length;
      if (wdTok) {
        const dt = addDays(mondayOf(today), 7 + ((wd + 6) % 7));
        return { i: Math.min(m.index, wdTok.index), e: Math.max(end, wdTok.index + wdTok[0].length), date: dt, kind: 'next-week-weekday', conf: 'medium', wdBlank: wdTok };
      }
      return { i: m.index, e: end, date: addDays(today, 7), kind: 'next-week', conf: 'medium' };
    }
    // "this week" / "is hafta [friday]"
    m = firstMatch(RE.thisWeek, s);
    if (m) {
      const end = m.index + m[0].length;
      if (wdTok) {
        const dt = addDays(mondayOf(today), (wd + 6) % 7);
        return { i: Math.min(m.index, wdTok.index), e: Math.max(end, wdTok.index + wdTok[0].length), date: dt, kind: 'this-week-weekday', conf: dt < today ? 'low' : 'medium', wdBlank: wdTok };
      }
      return { i: m.index, e: end, date: addDays(mondayOf(today), 4), kind: 'this-week', conf: 'medium' };
    }
    m = firstMatch(RE.nextWd, s);
    if (m) {
      // "next Thursday" is read both ways by people: the coming one, or the one after. Offer the other as an alternative.
      const dt = nextStrictlyAfter(today, WORD_TO_WD[m[1].toLowerCase()]);
      // (Only when the coming one is under a week away; a full 7 days out there is nothing else to mean.)
      const soon = (dt - today) / 864e5 < 7;
      return { i: m.index, e: m.index + m[0].length, date: dt, kind: 'next-weekday', conf: 'medium', alt: soon ? [addDays(dt, 7)] : [] };
    }
    m = firstMatch(RE.lastWd, s);
    if (m) return { i: m.index, e: m.index + m[0].length, date: prevStrictlyBefore(today, WORD_TO_WD[m[1].toLowerCase()]), kind: 'last-weekday', conf: 'low' };

    // "kal ka quiz postpone ho gaya, ab Thursday ko hoga": the weekday is the NEW date; "kal" names the old one.
    if (wdTok && /(?<![\p{L}])(?:postpone[d]?|reschedule[d]?|re-?schedule[d]?|shift(?:ed)?|moved|preponed)(?![\p{L}])|(?<![\p{L}])ab\s/iu.test(s)) {
      return { i: wdTok.index, e: wdTok.index + wdTok[0].length, date: nextStrictlyAfter(today, wd), kind: 'weekday-moved', conf: 'medium' };
    }
    m = firstMatch(RE.dayAfter, s);
    if (m) return { i: m.index, e: m.index + m[0].length, date: addDays(today, pastWord ? -2 : 2), kind: 'day-after-tomorrow', conf: pastWord ? 'low' : 'high' };
    m = firstMatch(RE.in3, s);
    if (m) return { i: m.index, e: m.index + m[0].length, date: addDays(today, 3), kind: 'in-3-days', conf: 'medium' };
    m = firstMatch(RE.tomorrow, s);
    if (m) return { i: m.index, e: m.index + m[0].length, date: addDays(today, pastWord ? -1 : 1), kind: 'tomorrow', conf: pastWord ? 'low' : 'high' };
    m = firstMatch(RE.today, s);
    if (m) return { i: m.index, e: m.index + m[0].length, date: today, kind: 'today', conf: 'high' };
    m = firstMatch(RE.inN1, s) || firstMatch(RE.inN2, s);
    if (m) return { i: m.index, e: m.index + m[0].length, date: addDays(today, +m[1]), kind: 'in-n-days', conf: 'medium' };

    m = firstMatch(RE.weekN, s);
    if (m) {
      const n = +m[1];
      const span = { i: m.index, e: m.index + m[0].length };
      if (!start) return Object.assign(span, { date: null, kind: 'week-n', conf: 'low', relative: 'Week ' + n });
      let dt = addDays(start, 7 * (n - 1));
      let wdb = null;
      if (wdTok) {
        dt = addDays(dt, (wd - start.getDay() + 7) % 7);
        wdb = wdTok;
      }
      return Object.assign(span, { date: dt, kind: 'week-n', conf: 'medium', relative: 'Week ' + n, wdBlank: wdb });
    }

    m = firstMatch(/(?<![\p{L}\p{N}:./-])(\d{1,2})(?:st|nd|rd|th)(?![\p{L}\p{N}])/giu, s, (x) => +x[1] >= 1 && +x[1] <= 31);
    if (m) {
      let c = null;
      for (let k = 0; k < 3 && !c; k++) {
        const t = validDate(today.getFullYear(), today.getMonth() + k, +m[1]);
        if (t && t >= today) c = t;
      }
      if (c) return { i: m.index, e: m.index + m[0].length, date: c, kind: 'day-of-month', conf: 'medium' };
    }

    if (wdTok) {
      // Said on a Monday, "Monday" means next Monday (today's would be "aaj").
      const dt = nextStrictlyAfter(today, wd);
      return { i: wdTok.index, e: wdTok.index + wdTok[0].length, date: dt, kind: 'weekday', conf: 'medium' };
    }
    return null;
  }

  /* ------------------------------------------------------------------ type + title */
  const TYPE_RES = [
    ['Quiz', /(?<![\p{L}])(quizzes|quiz|class test|test|tests|کوئز|ٹیسٹ)(?![\p{L}])/iu],
    ['Assignment', /(?<![\p{L}])(assignments?|assgn|asgn|homework|hw|problem set|pset|worksheet|اسائنمنٹ|اسائینمنٹ|ہوم ورک)(?![\p{L}])/iu],
    ['Exam', /(?<![\p{L}])(mid-?term|mid term|midsem|mids|finals?(?!\s+(?:project|report|presentation|submission|assignment|lab|draft|viva))|exams?|(?<!research\s)(?<!term\s)paper|sessional|oht|امتحان|مڈ ?ٹرم|فائنل|پیپر)(?![\p{L}])/iu],
    ['Project', /(?<![\p{L}])(projects?|proposal|reports?|thesis|fyp|term paper|capstone|prototype|پروجیکٹ|رپورٹ)(?![\p{L}])/iu],
    ['Presentation', /(?<![\p{L}])(presentations?|viva|demo|pitch|seminar|ppt|slides|پریزنٹیشن|وائیوا)(?![\p{L}])/iu],
    ['Lab', /(?<![\p{L}])(labs?|practicals?|لیب|پریکٹیکل)(?![\p{L}])/iu],
  ];
  function detectType(text) {
    let best = null;
    for (const [type, re] of TYPE_RES) {
      const m = re.exec(text);
      if (m && (!best || m.index < best.i)) best = { type, i: m.index };
    }
    return best ? best.type : 'Other';
  }

  const FILLERS = alt([
    'inshallah', 'insha', 'allah', 'check', 'sir', 'kab', 'kuch', 'bataya', 'ab', 'postpone', 'postpones', 'he', 'hy', 'hn', 'jama', 'karwana', 'karwao', 'karwani', 'shift', 'gayi', 'gaya', 'morning', 'evening', 'afternoon', 'kaha', 'to', 'extended', 'moved', 'postponed', 'preponed', 'rescheduled', 'shifted', 'karo', 'karna', 'krna', 'kro', 'kardo', 'karen', 'karein', 'kijiye', 'karni', 'karnay', 'hai', 'hain', 'hay', 'hoga',
    'hogi', 'hongay', 'hoon', 'ho', 'ga', 'gi', 'tak', 'by', 'on', 'at', 'due', 'submit', 'submitted', 'submission',
    'submissions', 'deadline', 'before', 'until', 'till', 'the', 'is', 'are', 'will', 'be', 'ka', 'ki', 'ke', 'ko', 'ne',
    'se', 'mein', 'me', 'pe', 'par', 'aur', 'sab', 'sabko', 'please', 'plz', 'pls', 'reminder', 'note', 'dear', 'students',
    'everyone', 'guys', 'all', 'wala', 'wali', 'lazmi', 'zaroor', 'jama', 'jamma', 'bhejna', 'bhejo', 'send', 'upload',
    'tha', 'thi', 'agla', 'agle', 'agli', 'next', 'iss', 'this', 'coming', 'yaad', 'rakhen', 'rakhna', 'ہے', 'ہیں', 'تک',
    'کو', 'کا', 'کی', 'کے', 'جمع', 'کریں', 'کرو', 'ہو', 'گا', 'گی', 'میں', 'پر', 'سے', 'ہوگا', 'ہوگی',
  ]);
  const FILLER_RE = new RegExp(B1 + FILLERS + B2, 'giu');

  function buildTitle(blanked, type, original) {
    let t = blanked
      .replace(FILLER_RE, ' ')
      .replace(/\s[-–—:]+\s/g, ' ')
      .replace(/[,;:|•"“”()[\]!?*_~]+/g, ' ')
      .replace(/(^|\s)[-–—.]+(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-–—.\s]+|[-–—.\s]+$/g, '');
    if (t.length < 2) {
      t = type !== 'Other' ? type : /deadline|due|submit|submission/i.test(original) ? 'Submission' : 'Deadline';
    }
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return t.length > 80 ? t.slice(0, 77).trim() + '…' : t;
  }

  const CANCEL_RE = /\b(?:cancel(?:l?ed)?|cancle|cancal)\b/i;
  const CANCEL_CLAUSE_RE = /[^,.;\n]*\b(?:cancel(?:l?ed)?|cancle|cancal)\b[^,.;\n]*[,.;]?/i;

  /** True only when saving this single parsed item without a confirm card is very unlikely to be wrong. */
  function isFastSaveSafe(it, text) {
    const s = String(text || (it && it.original) || '');
    if (!it || it.confidence !== 'high' || !isValidISO(it.date)) return false;
    if (it.alternatives && it.alternatives.length) return false;
    if (/[?؟]/.test(s) || s.split('\n').filter((l) => l.trim()).length > 1) return false;
    if (/\b(?:cancel(?:l?ed)?|postpone[d]?|preponed|re-?schedule[d]?|thanks?|thank you|shukriya|i will|i'll|i have|main ne|maine)\b/i.test(s)) return false;
    if ((s.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi) || []).length > 1) return false;
    const dueWord = /\b(?:due|deadline|submit|submission|last date|jama)\b/i.test(s);
    if (it.type === 'Other' && !dueWord) return false;
    return true;
  }

  /* ------------------------------------------------------------------ parse one snippet */
  /**
   * parseDeadline(text, {today, ref, semesterStart}) -> {
   *   title, date:'YYYY-MM-DD'|null, time:'HH:MM'|null, confidence:'high'|'medium'|'low',
   *   type, notes, original, kind, relative, timeAssumed }
   */
  function parseDeadline(text, opts) {
    opts = opts || {};
    const today = startOfDay(opts.today || new Date());
    const start = opts.semesterStart ? (opts.semesterStart instanceof Date ? startOfDay(opts.semesterStart) : fromISO(opts.semesterStart)) : null;
    const ref = opts.ref ? startOfDay(opts.ref) : start || today;
    const original = String(text == null ? '' : text).trim();
    let s = normalize(original);

    // "Class kal cancel hai, make up class Saturday": the cancelled clause is not a date for anything.
    let hadCancel = false;
    if (CANCEL_RE.test(s)) {
      hadCancel = true;
      s = s.replace(CANCEL_CLAUSE_RE, ' ');
    }

    let t = findTime(s);
    if (t) s = blank(s, t.start, t.end);
    else {
      const night = /\b(?:tonight|(?:aj|aaj|abhi)\s+raat(?:\s+tak)?|raat\s+tak)\b/i.exec(s);
      if (night) { t = { time: '23:59', start: night.index, end: night.index + night[0].length, assumed: false }; s = blank(s, t.start, t.end); }
    }

    const d = findDate(s, { today, ref, start, pastDays: opts.pastDays });
    if (d) {
      s = blank(s, d.i, d.e);
      if (d.wdBlank) s = blank(s, d.wdBlank.index, d.wdBlank.index + d.wdBlank[0].length);
      if (['iso', 'numeric', 'day-month', 'month-day'].indexOf(d.kind) !== -1) {
        // "Friday 18 Oct": weekday words are redundant once an exact date exists.
        allMatches(RE.wd, s, wdAccept(s)).reverse().forEach((m) => { s = blank(s, m.index, m.index + m[0].length); });
      }
    }

    const type = detectType(s);
    const title = buildTitle(s, type, original);
    let date = d && d.date ? toISO(d.date) : null;
    // "tonight" / "aj raat tak" with no other date means today.
    if (!date && t && t.time === '23:59' && /\b(?:tonight|raat)\b/i.test(original) && !hadCancel) date = toISO(today);
    return {
      cancelled: hadCancel && !date && !t,
      title,
      date,
      time: t ? t.time : null,
      confidence: date ? (d ? d.conf : 'high') : 'low',
      type,
      notes: d && d.relative && !date ? 'RELATIVE: ' + d.relative : '',
      original,
      kind: d ? d.kind : t ? 'time-only' : 'none',
      relative: d && d.relative ? d.relative : null,
      timeAssumed: !!(t && t.assumed),
      alternatives: d && d.alt ? d.alt.map(toISO) : [],
    };
  }

  /**
   * Pre-pass used before the AI call: resolves Roman-Urdu / relative dates locally
   * and returns a hint string so the model has the concrete calendar date as context.
   */
  function preParseUrdu(text, today) {
    const t = startOfDay(today || new Date());
    // A pinned message is almost never about the past: a yearless date more than 2 weeks gone means next year.
    const r = parseDeadline(text, { today: t, pastDays: 14 });
    let hint = 'Reference date (the day the text was written): ' + describeDate(toISO(t)) + ' (' + toISO(t) + ').';
    if (r.date) {
      hint += ' Local pre-parser resolved the date as ' + r.date + ' (' + DAY_NAMES[fromISO(r.date).getDay()] + ')' +
        (r.time ? ' at ' + r.time : '') + ' using rule "' + r.kind + '" (confidence ' + r.confidence + ').';
    } else {
      hint += ' Local pre-parser found no concrete date.';
    }
    return { annotated: hint + '\n\nText: ' + text, hint, parsed: r };
  }

  /* ------------------------------------------------------------------ multi-line text (paste mode) */
  function countAbsDates(s) {
    return allMatches(RE.iso, s).length + allMatches(RE.dm, s).length + allMatches(RE.md, s).length +
      allMatches(RE.num, s, (x) => !!x[4] || x[2] === '/').length;
  }
  function splitMulti(line) {
    const n = normalize(line);
    if (countAbsDates(n) < 2) return [line];
    const parts = line.split(/\s*(?:,|;|&|\band\b|\baur\b)\s*/i).filter((p) => p.trim());
    if (parts.length >= 2 && parts.every((p) => countAbsDates(normalize(p)) >= 1)) return parts;
    return [line];
  }

  /** Short course tag from a message: "CS-201", "[OS]", "DSA:" ... or '' when none is obvious. */
  const COURSE_STOP = new Set(['QUIZ', 'EXAM', 'MID', 'MIDS', 'FINAL', 'DUE', 'NOTE', 'URGENT', 'LAB', 'OK', 'AM', 'PM', 'ASAP', 'FYI', 'TEST', 'HW', 'PDF', 'GMT', 'PKT', 'NB', 'PS', 'RE', 'IMP']);
  function extractCourse(text) {
    const s = String(text || '');
    let m = s.match(/\b([A-Z]{2,4})[- ]?(\d{3})\b/);
    if (m && !COURSE_STOP.has(m[1])) return m[1] + m[2];
    m = s.match(/^\s*(?:\[|\()?([A-Z]{2,6})(?:\]|\))?\s*[:\-–]/);
    if (m && !COURSE_STOP.has(m[1])) return m[1];
    m = s.match(/\[([A-Z]{2,6})\]/);
    if (m && !COURSE_STOP.has(m[1])) return m[1];
    return '';
  }

  /** Extract every dated / event-looking line from pasted text (e.g. a WhatsApp chat or typed syllabus). */
  function extractFromText(text, opts) {
    opts = opts || {};
    const out = [];
    String(text || '')
      .split(/\n|•/)
      .map((l) => stripWhatsAppPrefix(l).trim())
      .filter((l) => l.length >= 3)
      .forEach((line) => {
        splitMulti(line).forEach((chunk) => {
          const r = parseDeadline(chunk, opts);
          if (r.cancelled) return;
          if (r.date || r.relative || r.type !== 'Other') {
            out.push({
              title: r.title, date: r.date || (r.relative ? 'RELATIVE: ' + r.relative : 'UNKNOWN'),
              time: r.time, type: r.type, confidence: r.confidence,
              original: r.original, alternatives: r.alternatives,
              course: extractCourse(chunk),
            });
          }
        });
      });
    return out;
  }

  /* ------------------------------------------------------------------ whole-chat export (WhatsApp "Export chat") */
  // Android: "22/11/2026, 9:15 pm - Name: text"   iPhone: "[22/11/26, 9:15:03 pm] Name: text"
  const CHAT_HEAD = /^‎?\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\]?\s*(?:-\s*)?(.*)$/i;
  const CHAT_SKIP = /^(?:<media omitted>|<attached:.*>|image omitted|video omitted|sticker omitted|audio omitted|document omitted|gif omitted|this message was deleted|you deleted this message|null|‎?messages and calls are end-to-end encrypted.*)$/i;
  function parseChatMessages(text) {
    const lines = String(text || '').replace(/\r/g, '').replace(/^﻿/, '').split('\n');
    const raw = [];
    let dayFirst = 0, monthFirst = 0;
    let cur = null;
    lines.forEach((line) => {
      const m = CHAT_HEAD.exec(line);
      const ok = m && +m[4] <= 23 && +m[5] <= 59 && +m[1] <= 31 && +m[2] <= 31 && (!m[6] || +m[4] <= 12);
      if (ok) {
        if (+m[1] > 12) dayFirst++; else if (+m[2] > 12) monthFirst++;
        const rest = (m[7] || '').replace(/^‎/, '');
        const sm = /^([^:\n]{1,60}?):\s?([\s\S]*)$/.exec(rest);
        cur = { m, sender: sm ? sm[1].trim() : '', text: sm ? sm[2] : '', system: !sm };
        raw.push(cur);
      } else if (cur && !cur.system) {
        cur.text += '\n' + line;
      }
    });
    const dfirst = monthFirst > dayFirst ? false : true; // Pakistan default: day first
    const out = [];
    raw.forEach((r) => {
      if (r.system) return;
      let [, a, b, y, hh, mi, ap] = r.m;
      let day = dfirst ? +a : +b, mon = dfirst ? +b : +a, yr = +y < 100 ? 2000 + +y : +y, h = +hh;
      if (ap) { const pm = /^p/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      const when = new Date(yr, mon - 1, day, h, +mi);
      if (isNaN(+when) || when.getMonth() !== mon - 1) return;
      const t = r.text.trim();
      if (!t || CHAT_SKIP.test(t)) return;
      out.push({ sentAt: when, sender: r.sender, text: t });
    });
    return out;
  }

  /**
   * parseChatExport(text, {today, days=30, includePast=false}) -> {items, stats}
   * Every message is read as of the day it was SENT, so "kal" in a 3-day-old message points at the right day.
   */
  function parseChatExport(text, opts) {
    opts = opts || {};
    const today = startOfDay(opts.today || new Date());
    const days = opts.days == null ? 30 : opts.days;
    const msgs = parseChatMessages(text);
    const since = addDays(today, -days);
    const seen = new Map();
    let scanned = 0;
    msgs.forEach((m) => {
      if (startOfDay(m.sentAt) < since) return;
      scanned++;
      extractFromText(m.text, { today: startOfDay(m.sentAt) }).forEach((it) => {
        if (!isValidISO(it.date)) return;
        if (!opts.includePast && fromISO(it.date) < today) return;
        const k = [it.course || '', it.type, it.date, it.time || '', (it.title || '').toLowerCase().replace(/\s+/g, ' ')].join('|');
        const loose = [it.course || '', it.type, it.date].join('|');
        if (seen.has(k)) return;
        // "Quiz kal" then "Reminder: quiz tomorrow" -> same course+type+date: keep the first, richer one
        if (it.type !== 'Other' && seen.has('L' + loose)) return;
        seen.set(k, 1); seen.set('L' + loose, 1);
        seen.set(k + '#', Object.assign({}, it, { sender: m.sender, sentAt: toISO(startOfDay(m.sentAt)), fromChat: true }));
      });
    });
    const items = [];
    seen.forEach((v, k) => { if (k.endsWith('#')) items.push(v); });
    items.sort((a, b) => (a.date === b.date ? (a.time || '99').localeCompare(b.time || '99') : a.date < b.date ? -1 : 1));
    return { items, stats: { messages: msgs.length, scanned, found: items.length, first: msgs[0] ? toISO(startOfDay(msgs[0].sentAt)) : null, last: msgs.length ? toISO(startOfDay(msgs[msgs.length - 1].sentAt)) : null } };
  }

  /** Read the first .txt (prefer _chat.txt) out of a WhatsApp export .zip (ArrayBuffer/Uint8Array). Browser + Node 18+. */
  async function zipReadChatText(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let eocd = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Not a zip file');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const ents = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl));
      ents.push({ name, method, csize, usize, off });
      p += 46 + nl + el + cl;
    }
    const txt = ents.filter((e) => /\.txt$/i.test(e.name) && e.usize < 50 * 1024 * 1024);
    txt.sort((a, b) => (/_chat\.txt$/i.test(b.name) - /_chat\.txt$/i.test(a.name)) || b.usize - a.usize);
    const e = txt[0];
    if (!e) throw new Error('No chat text file inside the zip');
    const ln = dv.getUint16(e.off + 26, true), le = dv.getUint16(e.off + 28, true);
    const data = u.subarray(e.off + 30 + ln + le, e.off + 30 + ln + le + e.csize);
    if (e.method === 0) return new TextDecoder().decode(data);
    if (e.method !== 8) throw new Error('Unsupported zip compression');
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(ds).arrayBuffer());
  }

  /* ------------------------------------------------------------------ AI output handling */
  function extractJSON(text) {
    let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const tryParse = (x) => { try { return JSON.parse(x); } catch (e) { return undefined; } };
    let v = tryParse(t);
    if (v === undefined) {
      const a = t.indexOf('['), b = t.lastIndexOf(']');
      if (a !== -1 && b > a) v = tryParse(t.slice(a, b + 1));
    }
    if (v === undefined) {
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a !== -1 && b > a) v = tryParse(t.slice(a, b + 1));
    }
    if (v === undefined) return null;
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) if (Array.isArray(v[k])) return v[k];
      return [v];
    }
    return null;
  }

  function normalizeType(t) {
    const x = String(t || '').trim().toLowerCase();
    const hit = TYPES.find((n) => n.toLowerCase() === x);
    if (hit) return hit;
    return x ? detectType(x) : 'Other';
  }
  const normalizeConfidence = (c) => {
    const x = String(c || '').trim().toLowerCase();
    return x === 'high' || x === 'medium' || x === 'low' ? x : 'low';
  };

  /** Clean one model-produced object into a row. Resolves "RELATIVE: Week N" when a start date is known. */
  function normalizeEvent(raw, opts) {
    opts = opts || {};
    raw = raw || {};
    let date = String(raw.date == null ? '' : raw.date).trim();
    let conf = normalizeConfidence(raw.confidence);
    const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(date); // "2026-10-15T00:00:00" -> "2026-10-15"
    if (iso && isValidISO(iso[1])) date = iso[1];
    if (!isValidISO(date)) {
      const resolved = /relative|week/i.test(date) ? resolveRelative(date, opts.semesterStart) : null;
      if (resolved) {
        date = resolved;
        if (conf === 'high') conf = 'medium';
      } else if (!date || /^(?:unknown|null|none|n\/a|tbd)$/i.test(date)) {
        date = 'UNKNOWN';
        conf = 'low';
      }
    }
    const time = isValidTime(raw.time) ? raw.time : null;
    return {
      title: String(raw.title || raw.name || 'Untitled').trim(),
      date,
      time,
      type: normalizeType(raw.type),
      confidence: conf,
      notes: String(raw.notes || '').trim(),
    };
  }

  const dedupeKey = (e) => String(e.title || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + String(e.date || '').trim();
  function dedupe(events) {
    const seen = new Set();
    return events.filter((e) => {
      const k = dedupeKey(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* ------------------------------------------------------------------ export helpers */
  function copyAsText(events, course) {
    return events
      .map((e) => {
        const d = isValidISO(e.date) ? describeDate(e.date) : e.date || 'UNKNOWN';
        return '• ' + d + (e.time ? ' ' + e.time : '') + ' — ' + (course ? course + ' — ' : '') + e.title + (e.type && e.type !== 'Other' ? ' (' + e.type + ')' : '') + (e.notes ? ' — ' + e.notes : '');
      })
      .join('\n');
  }

  /* ------------------------------------------------------------------ .ics */
  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function foldLine(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '', bytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const compact = (iso) => iso.replace(/-/g, '');

  /**
   * buildICS(events, {course, calName, alarm, alarmTimed, alarmSet:'student', appUrl, now})
   * events: [{title, date:'YYYY-MM-DD', time?:'HH:MM', notes?, description?, uidSeed?}]
   * Rows with an invalid date are skipped (callers validate first). Returns CRLF text.
   */
  function buildICS(events, opts) {
    const o = Object.assign({ course: '', calName: 'Deadlines', alarm: '-P2D', alarmTimed: '-PT1H', now: new Date() }, opts);
    const stamp = o.now.getUTCFullYear() + pad(o.now.getUTCMonth() + 1) + pad(o.now.getUTCDate()) + 'T' +
      pad(o.now.getUTCHours()) + pad(o.now.getUTCMinutes()) + pad(o.now.getUTCSeconds()) + 'Z';
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DeadlineSync PK//Deadlines//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEscape(o.calName)];
    events.forEach((e) => {
      const d = fromISO(e.date);
      if (!d) return;
      const timed = isValidTime(e.time);
      const summary = (o.course ? o.course + ' — ' : '') + e.title;
      L.push('BEGIN:VEVENT');
      L.push('UID:' + hash([e.uidSeed || '', e.title, e.date, e.time || ''].join('|')) + '@deadlinesync.pk');
      L.push('DTSTAMP:' + stamp);
      if (timed) {
        const [hh, mm] = e.time.split(':').map(Number);
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
        const en = new Date(s.getTime() + 60 * 60 * 1000);
        const f = (x) => x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate()) + 'T' + pad(x.getHours()) + pad(x.getMinutes()) + '00';
        L.push('DTSTART:' + f(s), 'DTEND:' + f(en));
      } else {
        L.push('DTSTART;VALUE=DATE:' + compact(e.date), 'DTEND;VALUE=DATE:' + compact(toISO(addDays(d, 1))));
      }
      L.push('SUMMARY:' + icsEscape(summary));
      const desc = e.description != null ? e.description : [e.type && e.type !== 'Other' ? e.type : '', e.notes].filter(Boolean).join(' — ');
      const fullDesc = [desc, o.appUrl ? 'Open your deadlines: ' + o.appUrl : ''].filter(Boolean).join('\n');
      if (fullDesc) L.push('DESCRIPTION:' + icsEscape(fullDesc));
      L.push('TRANSP:TRANSPARENT');
      // 'student' alarm set: timed = a day before + an hour before; all-day = 6 pm the evening before + 8 am that morning.
      const triggers = o.alarmSet === 'student' ? (timed ? ['-P1D', '-PT1H'] : ['-PT6H', 'PT8H']) : [timed ? o.alarmTimed : o.alarm];
      triggers.forEach((tr) => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape('Reminder: ' + summary), 'TRIGGER:' + tr, 'END:VALARM'));
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(foldLine).join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ share / calendar links (no login needed) */
  function shareText(d) {
    return '📌 Deadline: ' + d.title + '\n' + describeDate(d.date) + (d.time ? ' at ' + d.time : '') +
      (d.sourceUrl ? '\nSource: ' + d.sourceUrl : '');
  }
  /** One-click "add to Google Calendar" link (opens the pre-filled event form; works with any signed-in account). */
  function gcalUrl(d) {
    const day = fromISO(d.date);
    if (!day) return null;
    const c = (x) => x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate());
    let dates;
    if (isValidTime(d.time)) {
      const [h, m] = d.time.split(':').map(Number);
      const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      const e = new Date(s.getTime() + 3600000);
      const f = (x) => c(x) + 'T' + pad(x.getHours()) + pad(x.getMinutes()) + '00';
      dates = f(s) + '/' + f(e);
    } else {
      dates = c(day) + '/' + c(addDays(day, 1));
    }
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(d.title) +
      '&dates=' + dates + '&details=' + encodeURIComponent((d.original || '') + (d.sourceUrl ? '\n' + d.sourceUrl : ''));
  }
  /** wa.me link: with a number it opens a chat with that number (e.g. yourself); without, WhatsApp asks who to send to. */
  function waUrl(text, number) {
    const n = String(number || '').replace(/\D/g, '');
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text);
  }
  /** Deep link a classmate can tap: ?add=<title|date|time|type,...>. No server; the link itself carries the deadline. */
  function encodeShare(items) {
    return (items || []).slice(0, 20).map((d) => [d.title, d.date, d.time || '', d.type || ''].map((x) => encodeURIComponent(String(x))).join('|')).join(',');
  }
  /** Inverse of encodeShare, strictly validated (links come from strangers): returns only well-formed deadlines. */
  function decodeShare(str) {
    const out = [];
    String(str || '').split(',').slice(0, 20).forEach((part) => {
      const f = part.split('|');
      if (f.length < 2) return;
      let title, date, time, type;
      try { [title, date, time, type] = f.map((x) => decodeURIComponent(x || '')); } catch (e) { return; }
      title = String(title).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
      if (!title || !isValidISO(date)) return;
      out.push({ title, date, time: isValidTime(time) ? time : null, type: TYPES.indexOf(type) >= 0 ? type : 'Other' });
    });
    return out;
  }
  function shareLink(base, items) { return base + '?add=' + encodeURIComponent(encodeShare(items)); }
  const mailUrl = (d) => 'mailto:?subject=' + encodeURIComponent('Deadline: ' + d.title) + '&body=' + encodeURIComponent(shareText(d));

  /* ---------------------------------------------------------------- real Google Calendar sync (API v3) */
  /** Google Calendar event resource for one deadline. All-day when there is no time; otherwise a 1-hour event. */
  function buildGoogleEvent(d, tz) {
    const day = fromISO(d && d.date);
    if (!day || !d.title) return null;
    const ev = {
      summary: String(d.title),
      description: 'Pinned with DeadlineSync PK' + (d.type && d.type !== 'Other' ? ' · ' + d.type : ''),
      extendedProperties: { private: { dpkId: String(d.id || '') } },
    };
    if (isValidTime(d.time)) {
      const [h, m] = d.time.split(':').map(Number);
      const endMin = h * 60 + m + 60;
      const endDay = endMin >= 1440 ? toISO(addDays(day, 1)) : d.date;
      const em = endMin % 1440;
      ev.start = { dateTime: d.date + 'T' + d.time + ':00', timeZone: tz || 'Asia/Karachi' };
      ev.end = { dateTime: endDay + 'T' + pad(Math.floor(em / 60)) + ':' + pad(em % 60) + ':00', timeZone: tz || 'Asia/Karachi' };
      ev.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 60 }] };
    } else {
      ev.start = { date: d.date };
      ev.end = { date: toISO(addDays(day, 1)) };
      ev.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 360 }] }; // 6 pm the day before
    }
    return ev;
  }

  /**
   * Pushes deadlines into a dedicated "DeadlinePK" calendar. `request(method, path, body)` does the HTTP call
   * (path is relative to /calendar/v3) and must throw an Error with `.status` on failure. Idempotent: events that
   * already have a google id (d.gid) are updated, never duplicated; done items are removed from Google.
   */
  async function syncToGoogle(o) {
    const request = o.request, enc = encodeURIComponent;
    let calId = o.calendarId;
    if (!calId) {
      const c = await request('POST', '/calendars', { summary: o.calendarName || 'DeadlinePK', description: 'Deadlines pinned with DeadlineSync PK', timeZone: o.tz || 'Asia/Karachi' });
      calId = c.id;
    }
    const base = '/calendars/' + enc(calId) + '/events';
    const stats = { created: 0, updated: 0, deleted: 0, failed: 0 };
    const gids = {};
    const gone = (e) => e && (e.status === 404 || e.status === 410);
    for (const d of o.deadlines || []) {
      try {
        if (d.done) {
          if (d.gid) { try { await request('DELETE', base + '/' + enc(d.gid)); stats.deleted++; } catch (e) { if (!gone(e)) throw e; } }
          gids[d.id] = null;
          continue;
        }
        const body = buildGoogleEvent(d, o.tz);
        if (!body) continue;
        if (d.gid) {
          try { await request('PUT', base + '/' + enc(d.gid), body); stats.updated++; gids[d.id] = d.gid; continue; }
          catch (e) { if (!gone(e)) throw e; }
        }
        const ev = await request('POST', base, body);
        gids[d.id] = ev.id; stats.created++;
      } catch (e) {
        if (e && e.status === 401) throw e; // token expired: caller re-authorises
        stats.failed++;
      }
    }
    const left = [];
    for (const g of o.removed || []) {
      try { await request('DELETE', base + '/' + enc(g)); stats.deleted++; } catch (e) { if (e && e.status === 401) throw e; if (!gone(e)) { stats.failed++; left.push(g); } }
    }
    return { calendarId: calId, gids, stats, removedLeft: left };
  }

  return {
    buildGoogleEvent, syncToGoogle,
    shareText, gcalUrl, waUrl, mailUrl, encodeShare, decodeShare, shareLink,
    TYPES, DAY_NAMES,
    toISO, fromISO, isValidISO, isValidTime, addDays, startOfDay, describeDate, resolveRelative,
    normalize, stripWhatsAppPrefix, detectType,
    parseDeadline, preParseUrdu, extractFromText, extractCourse, isFastSaveSafe, parseChatExport, parseChatMessages, zipReadChatText,
    extractJSON, normalizeEvent, dedupe, copyAsText,
    buildICS, icsEscape, foldLine,
  };
});
