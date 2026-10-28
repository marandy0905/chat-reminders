# Google Chat Reminders

**English** | [繁體中文](README.zh-TW.md)

Reminders for Google Chat (chat.google.com and Gmail's Chat).

## Install (no coding needed)
1. Go to the [latest release](https://github.com/marandy0905/chat-reminders/releases/latest) and download **chat-reminders.zip**.
2. Unzip it and put the folder somewhere permanent (for example Documents). Chrome reads the extension from there, so don't delete or move it later.
3. In Chrome, open `chrome://extensions` (paste it into the address bar).
4. Turn on **Developer mode** (switch at the top right).
5. Click **Load unpacked** and choose the unzipped folder.
6. Refresh Google Chat. Allow Chrome notifications in your computer's settings if asked.

Tip: click the puzzle-piece icon in Chrome's toolbar and pin **Chat Reminders** so the icon is always visible.

## Use
- **On a message:** hover it, click the clock button, pick a time. The notification shows the message text; "Open chat" takes you back.
- **Popup:** click the toolbar icon (or the clock button in Chat) to see upcoming reminders with full text, snooze, open or delete.
- Notifications have **Snooze 20 min** and **Mark as done**; clicking the notification opens the chat. Nothing is marked done unless you press **Mark as done** (or Complete in the popup/overview); otherwise it stays Overdue.

- **Overview:** the popup's **View all & completed** opens a page with Overdue / Today / Tomorrow / Later / Completed, each with Snooze (presets or custom time), Complete, Open and Delete.

- **Shortcut in Chat:** the clock button next to the Chat logo (red with a count when something is due, faded otherwise) opens the popup. Keyboard: **Alt+Shift+R** (change at `chrome://extensions/shortcuts`).

## Updating
Chrome can't update this extension by itself, so it does it with one click. About once a day it checks for a newer version and, if there is one, shows a notification, a **NEW** badge on the toolbar icon and a banner in the popup and panel.
1. Click the notification or banner to open the update page.
2. First time only: click **Choose folder** and pick the folder you loaded at `chrome://extensions` (the unzipped Chat Reminders folder).
3. Click **Update now**. The extension downloads the latest release into that folder and reloads itself. Then refresh Chat.

Notes: pick the Chat Reminders folder itself, not a parent such as Documents (Chrome blocks those). Chrome may ask you to confirm folder access again in a later session. If the one-click update fails, download **chat-reminders.zip** from the [latest release](https://github.com/marandy0905/chat-reminders/releases/latest) and unzip it over the folder, then reload the extension at `chrome://extensions`.

Maintainers: when a merge to `main` changes extension code, a GitHub Action bumps the patch version in `manifest.json` and publishes a release with the zip attached (docs-only changes don't count).

## Notes
- All data stays in `chrome.storage.local`. The only network requests are the daily update check (this repo's public `manifest.json`) and, when you click **Update now**, the release zip from GitHub; no reminder data is sent.
- Google Chat's DOM is obfuscated. If the clock button stops appearing, update `SELECTORS` at the top of `content.js`.
- Message deep links aren't exposed in the DOM, so "Open chat" opens the space/DM URL that was current when you set the reminder.

## Third-party
`fflate.js` is [fflate](https://github.com/101arrowz/fflate) (MIT), used to unpack the update zip.

## Test
`node test/time.test.js`
