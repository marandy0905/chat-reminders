# Chat Reminders

**English** | [繁體中文](README.zh-TW.md)

Reminders for **Slack, Google Chat and Microsoft Teams** in the browser (app.slack.com, chat.google.com and Gmail's Chat, teams.microsoft.com / teams.cloud.microsoft). Reminders from all three apps land in one list.

## Install (no coding needed)
1. Go to the [latest release](https://github.com/marandy0905/chat-reminders/releases/latest) and download **chat-reminders.zip**.
2. Unzip it and put the folder somewhere permanent (for example Documents). Chrome reads the extension from there, so don't delete or move it later.
3. In Chrome, open `chrome://extensions` (paste it into the address bar).
4. Turn on **Developer mode** (switch at the top right).
5. Click **Load unpacked** and choose the unzipped folder.
6. Refresh your Slack, Google Chat and Teams tabs. Allow Chrome notifications in your computer's settings if asked.

Tip: click the puzzle-piece icon in Chrome's toolbar and pin **Chat Reminders** so the icon is always visible.

## Use
- **On a message:** hover it, click the clock button (in the app's own hover toolbar, next to "More"), pick a time. The notification shows the message text and which app it came from; clicking it brings that app's tab to the front and opens the message.
- **One list for every app:** the popup, the overview and the in-page panel all show the reminders from Slack, Google Chat and Teams together, each tagged with its app. The overview can be filtered by app.
- **Popup:** click the toolbar icon (or the clock button in Chat) to see upcoming reminders with full text, snooze, open or delete. **Snooze** opens a dropdown: 10 minutes, 30 minutes, 1 hour, 3 hours, or a custom time.
- Notifications have **Snooze 20 min** and **Mark as done**; clicking the notification opens the chat. Nothing is marked done unless you press **Mark as done** (or Complete in the popup/overview); otherwise it stays Overdue.

- **Overview:** the popup's **View all & completed** opens a page with Overdue / Today / Tomorrow / Later / Completed, each with the same Snooze dropdown, Complete, Open and Delete.

- **Shortcut in the app:** the clock button (in Google Chat next to "New chat"; in Slack and Teams a small tab on the right edge of the window) opens the reminders panel. It turns red with a count when something is due, in any of the three apps. Keyboard: **Alt+Shift+R** (change at `chrome://extensions/shortcuts`).

- **Quick options:** the times offered when you set a reminder (default: 20 minutes, 1 hour, 2 hours, 3 hours, tomorrow 10:00) are editable right in the reminder menu: click **Edit** at its top, change, add or remove "from now" times and "tomorrow at" times (up to 8), then **Done**. Changes save immediately. "Custom time" is always available.

## Updating
Chrome can't update this extension by itself, so it does it with one click. About once a day it checks for a newer version and, if there is one, shows a notification, a **NEW** badge on the toolbar icon and a banner in the popup and panel.
1. Click the notification or banner to open the update page.
2. First time only: click **Choose folder** and pick the folder you loaded at `chrome://extensions` (the unzipped Chat Reminders folder).
3. Click **Update now**. The extension downloads the latest release into that folder and reloads itself. Then refresh Chat.

Notes: pick the Chat Reminders folder itself, not a parent such as Documents (Chrome blocks those). Chrome may ask you to confirm folder access again in a later session. If the one-click update fails, download **chat-reminders.zip** from the [latest release](https://github.com/marandy0905/chat-reminders/releases/latest) and unzip it over the folder, then reload the extension at `chrome://extensions`.

Maintainers: when a merge to `main` changes extension code, a GitHub Action bumps the patch version in `manifest.json` and publishes a release with the zip attached (docs-only changes don't count).

## Language
The whole extension (menus, panel, popup, overview, notifications, update page) is shown in Traditional Chinese when the browser's language is Traditional Chinese (zh-TW / zh-HK / zh-MO / zh-Hant), and in English for every other language.

## Notes
- All data stays in `chrome.storage.local`. The only network requests are the daily update check (this repo's public `manifest.json`) and, when you click **Update now**, the release zip from GitHub; no reminder data is sent.
- Each app's markup lives in its own adapter: `sites/gchat.js`, `sites/slack.js`, `sites/teams.js` (shared UI in `content.js`). If the clock button stops appearing in one app, update the selectors at the top of its adapter. **Shift+click** the clock button copies what the extension sees on that message (as JSON) to the clipboard, to help with that.
- Links: Google Chat links are built from the message ids (or the space/DM when they can't be found). Slack uses the message's own permalink. Teams links need the conversation id; when it can't be found, clicking the reminder only brings Teams to the front.
- Reminders made before Slack/Teams support are treated as Google Chat reminders.

## Third-party
`fflate.js` is [fflate](https://github.com/101arrowz/fflate) (MIT), used to unpack the update zip.

## Test
`node test/time.test.js`
