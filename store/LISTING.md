# Chrome Web Store submission kit — DeadlinePin PK

Everything you need to paste into the Developer Dashboard (https://chrome.google.com/webstore/devconsole). You do the account, the $5 fee and the final submit; the text below is ready.

## 1. Before you start
1. Sign in with the Google account that should own the listing → **Register** (one-time **$5**).
2. Download the extension zip from https://gi-v.github.io/deadline-pk/DeadlinePinPK.zip (rebuilt on every deploy), or run `npm run build` and zip the `extension/` folder (the zip root must contain `manifest.json`).
3. Reload-test it once in your own Chrome (`chrome://extensions` → Developer mode → Load unpacked → `extension/`): open web.whatsapp.com, hover a message → 📌, and right-click selected text → "📌 Pin as deadline".

## 2. Store listing tab
- **Name:** DeadlinePin PK — pin deadlines from WhatsApp Web
- **Summary (≤132 chars):** Pin deadlines from WhatsApp Web and any page. Understands kal, parson and 9 baje. Works offline. No account.
- **Category:** Productivity · **Language:** English
- **Description:**
  > Class-group messages bury your deadlines. DeadlinePin finds the date.
  >
  > • Hover a message on WhatsApp Web → click 📌 → the deadline is saved.
  > • Select text on any page → right-click → "Pin as deadline".
  > • Reads Roman Urdu ("kal quiz hai 9 baje"), Urdu script and English.
  > • Reminders a day and an hour before, plus an optional daily digest.
  > • Export to your calendar (.ics) or open a pre-filled Google Calendar event.
  > • Everything stays in your browser. No account, no servers.
  >
  > Also available as a phone app: https://gi-v.github.io/deadline-pk/
- **Privacy policy URL:** https://gi-v.github.io/deadline-pk/privacy.html
- **Website / support URL:** https://github.com/Gi-v/deadline-pk
- **Assets to upload** ★ still to produce (needs real Chrome): icon 128×128 (`extension/icons/icon128.png` exists), **at least 1 screenshot 1280×800** (suggest 3: the popup with 3 deadlines on a WhatsApp Web page, the 📌 beside a message, the options page), small promo tile 440×280 (optional).

## 3. Privacy practices tab
- **Single purpose:** Detect deadlines in text the user chooses (WhatsApp Web messages or selected text) and keep a reminder list.
- **Permission justifications**
  | Permission | Justification |
  |---|---|
  | `storage` | Saves the user's deadline list and settings locally. |
  | `alarms` | Schedules reminders and the optional daily digest. |
  | `notifications` | Shows the reminders and the digest. |
  | `contextMenus` | Adds the right-click "Pin as deadline" item. |
  | `activeTab` + `scripting` | Lets right-click pin read the selected text on the current page, and registers the 📌 button on all sites only if the user switches that option on. |
  | Host `https://web.whatsapp.com/*` | Shows the 📌 button beside messages on WhatsApp Web. |
  | Host `https://api.anthropic.com/*` | Only used if the user adds their own API key in Settings so Claude can double-check hard messages. |
  | Optional host (all sites) | Requested at runtime only when the user turns on "Show the 📌 button on any website". |
- **Remote code:** No. **Data collection questionnaire:** tick **none** of the collected-data categories (nothing is sent to the developer; selected text goes to Anthropic only if the user saves their own key and enables the switch — disclose that in the policy, which it already does). Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

## 4. After approval
Review usually takes a few days (longer for a new publisher). Then tell me the listing URL and I will add it to the web app footer and the README.
