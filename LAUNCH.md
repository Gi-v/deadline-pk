# Launch kit — DeadlineSync PK

Live app: https://gi-v.github.io/deadline-pk/ · Privacy: https://gi-v.github.io/deadline-pk/privacy.html

## 0. What is and isn't proven (be honest with yourself)
- Proven: parser on ~125 messages **written by us** (about 94% exact), 127+ automated tests, phone-size browser checks.
- NOT proven: real students, real class-group messages, installing on Android, Share-from-WhatsApp, the calendar alarm firing, Google sync end to end.
- So: run the pilot below before telling anyone "it works".

## 1. Pilot: 10 students, 2 weeks
Pick 2–3 class groups. Ask each student to do the same 3 things.

**Message to send (copy-paste):**
> Assalam o alaikum! I made a free tool that pulls deadlines out of class-group messages ("kal quiz hai 9 baje") and puts them in your phone calendar. No login. Could you try it for 2 weeks and tell me where it gets a date wrong? https://gi-v.github.io/deadline-pk/
> Android: open the link in Chrome → ⋮ → "Add to Home screen"/"Install app". Then in WhatsApp long-press a message → Share → DeadlineSync.

**Day 1 task:** save 1 real deadline and tap "Add to calendar".
**Day 7:** ask the 3 questions below.
**Feedback questions (send as a WhatsApp message):**
1. Did it get the date right? (If not: what did the message say and what did it show?)
2. Did your phone remind you at the right time?
3. Would you send it to your class group? What would stop you?

**Success = ** 8 of 10 saved something on day 1 · 6 of 10 still using it in week 2 · 85%+ of saved dates correct. If not met, fix the top 3 complaints before promoting.

Keep a list of every wrong parse (the "Wrong date? Tell us" button files these as GitHub issues). Add each as a test in `tests/core.test.mjs`.

## 2. WhatsApp pitch for the wider launch (after the pilot)
> 📌 Deadline missed under 400 messages? Paste or share the message → get the date + calendar reminder. Roman Urdu, اردو, English. Free, no login: <link>

## 3. Chrome Web Store (extension for laptops)
One-time $5 developer fee (you pay). Package: zip the `extension/` folder (already built as `DeadlinePinPK.zip` on the site).
- **Name:** DeadlinePin PK — pin deadlines from WhatsApp Web
- **Short description (≤132 chars):** Pin deadlines from WhatsApp Web and any page. Understands kal, parson and 9 baje. Works offline. No account.
- **Detailed description:** Select a message and click Pin (or use the 📌 beside a message on WhatsApp Web). It reads the date and time (Roman Urdu, Urdu or English), keeps your list, sends reminders and a daily digest, and exports a calendar file or a pre-filled Google Calendar event. Everything stays in your browser.
- **Single purpose:** Detect deadlines in text the user chooses and keep a reminder list.
- **Permission justifications** (see `extension/manifest.json`): `storage` (your list), `alarms` + `notifications` (reminders and digest), `contextMenus` (right-click pin), host access to `https://web.whatsapp.com/*` (the 📌 button on messages) and `https://api.anthropic.com/*` (only if the user adds their own AI key); `activeTab` + `scripting` (right-click → Pin on any page, and an opt-in setting that registers the pin button on all sites after the user grants the optional host permission). No broad host access at install. No remote code. (v1.1.0 of the extension; the earlier `<all_urls>` version is gone.)
- **Privacy policy URL:** https://gi-v.github.io/deadline-pk/privacy.html
- **Screenshots to take (1280×800):** popup with 3 deadlines; WhatsApp Web with the pin button; options page; confirm card.

## 4. Google OAuth (optional Calendar sync)
- Cloud console → Google Auth Platform → **Audience → Publish app** (scope `calendar.app.created` is non-sensitive, so no review is normally required). Until then only listed test users can sign in.
- Add the privacy policy URL and app home page (https://gi-v.github.io/deadline-pk/) under Branding.
- Reset the client secret that was exposed earlier and delete the downloaded `client_secret_*.json`. The web app only needs the public client ID in `web/config.json`.

## 5. Decisions only you can make
- **Name + address.** "DeadlineSync PK" at gi-v.github.io is hard to remember. Consider a short name and a `.pk` domain pointed at GitHub Pages (Settings → Pages → Custom domain).
- **Feedback channel.** Students rarely have GitHub accounts. Make a WhatsApp number or Google Form and swap it into the "Wrong date? Tell us" link (`web/src/index.template.html`, search `issues/new`).
- **Analytics.** Optional cookieless counter (e.g. GoatCounter) to see whether anyone comes back; add to the privacy page if you do.
- **Play Store (later).** Trusted Web Activity via Bubblewrap, $25 fee, improves discoverability.

## 6. Pre-launch checklist
- [ ] Android: install, share from WhatsApp, calendar alarm fires on time
- [ ] iPhone: paste flow works (share target isn't supported on iOS)
- [ ] 30+ real messages tested and fixed
- [ ] Link preview looks right when pasted into WhatsApp (WhatsApp caches previews; test with a fresh `?v=` link)
- [ ] Pilot numbers met
- [ ] Privacy page linked everywhere; feedback channel set

## Group-sharing pilot checklist (does the cold start actually work?)
1. Pick one real class group. Pin one real deadline in the app, tap **Share** and send the WhatsApp message (links now carry `?src=share`, no tracking).
2. After 24 h ask in the group, by show of hands: who opened the link? who tapped **Add to my calendar**? who kept it in the app?
3. Success = at least 3 of 10 classmates add a deadline. If fewer, ask the ones who did not what stopped them and fix that first.
4. Also try: a full chat export (WhatsApp → Export chat → Without media) dropped into **More tools**, and a text syllabus PDF scanned offline (no key needed). Note any wrong dates.
