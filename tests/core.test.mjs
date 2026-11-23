import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const C = require('../shared/deadline-core.js');

const today = new Date(2026, 10, 23); // Monday 23 Nov 2026
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 4).join('\n    ')); }
}
const P = (s, o = {}) => C.parseDeadline(s, { today, ...o });

// ---- Roman Urdu relative days
t('kal + baje', () => { const r = P('Quiz kal hai 9 baje'); assert.equal(r.date, '2026-11-24'); assert.equal(r.time, '09:00'); assert.equal(r.type, 'Quiz'); assert.equal(r.title, 'Quiz'); assert.equal(r.confidence, 'high'); });
t('kal past tense', () => { const r = P('Quiz kal tha'); assert.equal(r.date, '2026-11-22'); assert.equal(r.confidence, 'low'); });
t('parson', () => assert.equal(P('Lab report parson submit karo').date, '2026-11-25'));
t('narsoon', () => assert.equal(P('Viva narsoon').date, '2026-11-26'));
t('aaj', () => assert.equal(P('Assignment aaj raat 11 baje tak').date, '2026-11-23'));
t('aaj raat 11 baje', () => assert.equal(P('Assignment aaj raat 11 baje tak').time, '23:00'));
t('subah 9 baje', () => assert.equal(P('kal subah 9 baje paper').time, '09:00'));
t('shaam 5 baje', () => assert.equal(P('Presentation kal shaam 5 baje').time, '17:00'));
t('dopahar 2 baje', () => assert.equal(P('kal dopahar 2 baje quiz').time, '14:00'));
t('9 baje subah (after)', () => assert.equal(P('quiz kal 9 baje subah').time, '09:00'));
t('assumed pm for 3 baje', () => { const r = P('quiz kal 3 baje'); assert.equal(r.time, '15:00'); assert.ok(r.timeAssumed); });
t('urdu script kal', () => { const r = P('کل کوئز ہے ۹ بجے'); assert.equal(r.date, '2026-11-24'); assert.equal(r.time, '09:00'); assert.equal(r.type, 'Quiz'); });

// ---- weekdays
t('Friday tak', () => { const r = P('Assignment submit karo Friday tak'); assert.equal(r.date, '2026-11-27'); assert.equal(r.title, 'Assignment'); });
t('Jumma', () => assert.equal(P('Assignment jumma tak').date, '2026-11-27'));
t('Somwar today=Mon -> today', () => assert.equal(P('quiz somwar').date, '2026-11-23'));
t('agla somwar -> next week', () => assert.equal(P('quiz agla somwar').date, '2026-11-30'));
t('agla jumerat', () => assert.equal(P('Mid agla jumerat').date, '2026-11-26'));
t('next Friday', () => assert.equal(P('next Friday quiz').date, '2026-11-27'));
t('mangal', () => assert.equal(P('Lab mangal ko').date, '2026-11-24'));
t('budh', () => assert.equal(P('Test budh ko 10 baje').date, '2026-11-25'));
t('hafta = Saturday (spec)', () => assert.equal(P('Project hafta ko').date, '2026-11-28'));
t('peer review not Monday', () => assert.equal(P('peer review report Friday').date, '2026-11-27'));
t('agle hafte', () => assert.equal(P('Quiz agle hafte').date, '2026-11-30'));
t('agla hafta Friday', () => assert.equal(P('quiz agla hafta jumma').date, '2026-12-04'));
t('is hafta = Friday', () => assert.equal(P('Assignment is hafta').date, '2026-11-27'));
t('is hafte somwar... today', () => assert.equal(P('quiz is hafte somwar').date, '2026-11-23'));
t('next week', () => assert.equal(P('Quiz next week').date, '2026-11-30'));
t('tomorrow', () => assert.equal(P('Submit report tomorrow by 5pm').date, '2026-11-24'));
t('tomorrow 5pm', () => assert.equal(P('Submit report tomorrow by 5pm').time, '17:00'));
t('day after tomorrow', () => assert.equal(P('Exam day after tomorrow').date, '2026-11-25'));
t('in 3 days', () => assert.equal(P('Quiz in 3 days').date, '2026-11-26'));
t('3 din baad', () => assert.equal(P('Quiz 3 din baad').date, '2026-11-26'));

// ---- absolute
t('submit by Oct 18 11:59pm', () => { const r = P('submit by Oct 18 11:59pm'); assert.equal(r.date, '2026-10-18'); assert.equal(r.time, '23:59'); assert.equal(r.title, 'Submission'); });
t('Oct 18 w/ semesterStart Aug', () => assert.equal(P('Quiz 1 Oct 18', { semesterStart: '2026-08-24' }).date, '2026-10-18'));
t('15th October', () => assert.equal(P('Midterm on 15th October', { semesterStart: '2026-08-24' }).date, '2026-10-15'));
t('15 Oct 2026', () => assert.equal(P('Final 15 Oct 2026').date, '2026-10-15'));
t('October 15, 2026', () => assert.equal(P('Final exam October 15, 2026').date, '2026-10-15'));
t('15/10', () => assert.equal(P('Assignment 2 due 15/10', { semesterStart: '2026-08-24' }).date, '2026-10-15'));
t('15/10 medium', () => assert.equal(P('Assignment 2 due 15/10', { semesterStart: '2026-08-24' }).confidence, 'medium'));
t('15/10/2026', () => { const r = P('15/10/2026 quiz'); assert.equal(r.date, '2026-10-15'); assert.equal(r.confidence, 'high'); });
t('15.10.26', () => assert.equal(P('quiz 15.10.26').date, '2026-10-15'));
t('iso', () => assert.equal(P('Project due 2026-12-05').date, '2026-12-05'));
t('Jan next year', () => assert.equal(P('Final Jan 12').date, '2027-01-12'));
t('invalid 31 Feb ignored', () => assert.equal(P('quiz 31 Feb').date, null));
t('chapters 1-3 not a date', () => assert.equal(P('Quiz covers chapters 1-3').date, null));
t('weekday + date prefers date', () => { const r = P('Friday 18 Dec quiz'); assert.equal(r.date, '2026-12-18'); assert.equal(r.title, 'Quiz'); });
t('Quiz 2 - After Midterm: no date', () => { const r = P('Quiz 2 - After Midterm'); assert.equal(r.date, null); assert.equal(r.confidence, 'low'); assert.equal(r.type, 'Quiz'); });

// ---- week N
t('Week 5 no start', () => { const r = P('Week 5: Quiz 1'); assert.equal(r.date, null); assert.equal(r.relative, 'Week 5'); });
t('Week 5 with start', () => assert.equal(P('Week 5: Quiz 1', { semesterStart: '2026-08-24' }).date, '2026-09-21'));
t('Week 3 Friday with start', () => assert.equal(P('Week 3 Friday assignment', { semesterStart: '2026-08-24' }).date, '2026-09-11'));

// ---- types & titles
t('type exam paper', () => assert.equal(P('Mid paper 12 Dec').type, 'Exam'));
t('final project -> Project', () => assert.equal(P('Final project submission 10 Dec').type, 'Project'));
t('lab', () => assert.equal(P('Lab 4 kal').type, 'Lab'));
t('presentation', () => assert.equal(P('Group presentation Friday').type, 'Presentation'));
t('urdu-script types', () => {
  assert.equal(P('مڈ ٹرم کل ۹ بجے').type, 'Exam');
  assert.equal(P('اسائنمنٹ جمعہ تک').type, 'Assignment');
  assert.equal(P('لیب پرسوں').type, 'Lab');
  assert.equal(P('اسائنمنٹ جمعہ تک').date, '2026-11-27');
});
t('title keeps context', () => assert.equal(P('CS-101 Assignment 2 Friday tak jama karo').title, 'CS-101 Assignment 2'));

// ---- whatsapp prefix + paste mode
t('whatsapp prefix', () => assert.equal(C.stripWhatsAppPrefix('[10:42 am, 22/11/2026] Sir Ali: Quiz kal'), 'Quiz kal'));
t('whatsapp prefix 2', () => assert.equal(C.stripWhatsAppPrefix('22/11/26, 10:42 pm - Ahmed: Quiz kal'), 'Quiz kal'));
t('extractFromText multi', () => {
  const rows = C.extractFromText('[10:42 am, 22/11/2026] Sir: Quiz kal 9 baje\nHello everyone\nAssignment 3 Friday tak\nQuiz 1 on Dec 5, Quiz 2 on Dec 19', { today });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.date), ['2026-11-24', '2026-11-27', '2026-12-05', '2026-12-19']);
});

// ---- preParseUrdu
t('preParseUrdu hint', () => { const r = C.preParseUrdu('Quiz kal hai', today); assert.match(r.hint, /2026-11-24/); assert.match(r.annotated, /Text: Quiz kal hai/); });

// ---- AI normalisation
t('extractJSON fenced', () => assert.equal(C.extractJSON('```json\n[{"title":"A"}]\n```').length, 1));
t('extractJSON with preamble', () => assert.equal(C.extractJSON('Here you go: [{"title":"A"},{"title":"B"}] done').length, 2));
t('extractJSON wrapped object', () => assert.equal(C.extractJSON('{"deadlines":[{"title":"A"}]}').length, 1));
t('extractJSON garbage', () => assert.equal(C.extractJSON('no json at all'), null));
t('normalizeEvent relative', () => { const e = C.normalizeEvent({ title: 'Q1', date: 'RELATIVE: Week 3', type: 'quiz', confidence: 'High' }, { semesterStart: '2026-08-24' }); assert.equal(e.date, '2026-09-07'); assert.equal(e.type, 'Quiz'); assert.equal(e.confidence, 'medium'); });
t('normalizeEvent unknown', () => { const e = C.normalizeEvent({ title: 'Q1', date: 'UNKNOWN', confidence: 'high' }); assert.equal(e.date, 'UNKNOWN'); assert.equal(e.confidence, 'low'); });
t('dedupe', () => assert.equal(C.dedupe([{ title: 'Quiz 1', date: '2026-10-01' }, { title: ' quiz  1 ', date: '2026-10-01' }, { title: 'Quiz 1', date: '2026-10-02' }]).length, 2));

// ---- ICS
t('ics all-day', () => {
  const s = C.buildICS([{ title: 'Quiz 1, "mid"; ok', date: '2026-10-15', notes: 'covers ch 1-3' }], { course: 'CS101', now: new Date(Date.UTC(2026, 0, 1)) });
  assert.match(s, /^BEGIN:VCALENDAR\r\n/);
  assert.match(s, /DTSTART;VALUE=DATE:20261015\r\n/);
  assert.match(s, /DTEND;VALUE=DATE:20261016\r\n/);
  assert.match(s, /SUMMARY:CS101 — Quiz 1\\, "mid"\\; ok\r\n/);
  assert.match(s, /TRIGGER:-P2D\r\n/);
  assert.match(s, /END:VCALENDAR\r\n$/);
});
t('ics timed + skips invalid', () => {
  const s = C.buildICS([{ title: 'A', date: '2026-10-15', time: '23:30' }, { title: 'B', date: 'UNKNOWN' }]);
  assert.match(s, /DTSTART:20261015T233000/); assert.match(s, /DTEND:20261016T003000/); assert.equal((s.match(/BEGIN:VEVENT/g) || []).length, 1);
});
t('ics folding <=75 octets', () => {
  const s = C.buildICS([{ title: 'ک'.repeat(80) + ' long title', date: '2026-10-15' }]);
  const enc = new TextEncoder();
  s.split('\r\n').forEach((l) => assert.ok(enc.encode(l).length <= 75, 'line too long: ' + enc.encode(l).length));
});
t('ics uid stable', () => {
  const a = C.buildICS([{ title: 'A', date: '2026-10-15' }]).match(/UID:(.*)\r/)[1];
  const b = C.buildICS([{ title: 'A', date: '2026-10-15' }]).match(/UID:(.*)\r/)[1];
  assert.equal(a, b);
});

// ---- bare-number times ("Quiz he 9") and their false-positive traps
t('Quiz he 9 -> Quiz 09:00', () => { const r = P('Quiz he 9'); assert.equal(r.title, 'Quiz'); assert.equal(r.time, '09:00'); assert.equal(r.date, null); });
t('Quiz hai 9', () => assert.equal(P('Quiz hai 9').time, '09:00'));
t('Quiz kal 9 -> tomorrow 09:00', () => { const r = P('Quiz kal 9'); assert.equal(r.date, '2026-11-24'); assert.equal(r.time, '09:00'); assert.equal(r.title, 'Quiz'); });
t('at 5 -> 17:00', () => assert.equal(P('Meeting at 5').time, '17:00'));
t('Class test hai 10 -> 10:00', () => assert.equal(P('Class test hai 10').time, '10:00'));
t('trap: Lab 4 kal (4 is the lab number)', () => { const r = P('Lab 4 kal'); assert.equal(r.time, null); assert.equal(r.title, 'Lab 4'); });
t('trap: Quiz 9 kal', () => { const r = P('Quiz 9 kal'); assert.equal(r.time, null); assert.equal(r.title, 'Quiz 9'); });
t('trap: kal 2 quizzes hain', () => assert.equal(P('kal 2 quizzes hain').time, null));
t('trap: by 5 Dec is a date, not 5 o\'clock', () => { const r = P('submit by 5 Dec'); assert.equal(r.date, '2026-12-05'); assert.equal(r.time, null); });
t('trap: hai 15 marks', () => assert.equal(P('Quiz hai 15 marks').time, null));
t('trap: Assignment 3 Friday tak', () => assert.equal(P('Assignment 3 Friday tak').time, null));
t('explicit baje still wins over bare', () => assert.equal(P('Quiz kal hai 9 baje').time, '09:00'));
t('"moved to" filler removed from title', () => assert.equal(P('Lecture moved to Wed 10:30').title, 'Lecture'));
t('pins: yearless date >14d past means next year (extension policy)', () => {
  assert.equal(C.preParseUrdu('Quiz Oct 18', today).parsed.date, '2027-10-18');
  assert.equal(C.preParseUrdu('Quiz Nov 20', today).parsed.date, '2026-11-20'); // 3 days ago: still this year
});
t('AI date with time suffix is accepted', () => assert.equal(C.normalizeEvent({ title: 'x', date: '2026-10-15T00:00:00', confidence: 'high' }).date, '2026-10-15'));
t('AI date word "null"/"none" -> UNKNOWN but "nullify" is not swallowed', () => {
  assert.equal(C.normalizeEvent({ title: 'x', date: 'None' }).date, 'UNKNOWN');
  assert.equal(C.normalizeEvent({ title: 'x', date: 'nullify' }).date, 'nullify');
});

t('gcal url all-day + timed', () => {
  const a = C.gcalUrl({ title: 'Quiz & Lab', date: '2026-11-24' });
  assert.match(a, /text=Quiz%20%26%20Lab/); assert.match(a, /dates=20261124\/20261125/);
  assert.match(C.gcalUrl({ title: 'Q', date: '2026-11-24', time: '23:30' }), /dates=20261124T233000\/20261125T003000/);
  assert.equal(C.gcalUrl({ title: 'Q', date: null }), null);
});
t('wa + mail + share text', () => {
  assert.equal(C.waUrl('hi there', '+92 300-1234567'), 'https://wa.me/923001234567?text=hi%20there');
  assert.equal(C.waUrl('x', ''), 'https://wa.me/?text=x');
  assert.match(C.shareText({ title: 'Quiz', date: '2026-11-24', time: '09:00' }), /Quiz\nTue, 24 Nov 2026 at 09:00/);
  assert.match(C.mailUrl({ title: 'Quiz', date: '2026-11-24' }), /^mailto:\?subject=Deadline%3A%20Quiz/);
});

console.log(`core tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
