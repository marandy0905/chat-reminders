# Google Chat Reminders

Slack-style reminders for Google Chat (chat.google.com and Gmail's Chat).

## Install (unpacked)
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Allow notifications for Chrome in your OS settings.

## Use
- **On a message:** hover it, click the clock button, pick a time. The notification shows the message text; "Open chat" takes you back.
- **Popup:** click the toolbar icon (or the clock button in Chat) to see upcoming reminders with full text, snooze, open or delete.
- Notifications have **Snooze 20 min** and **Mark as done**; clicking the notification opens the chat. Nothing is marked done unless you press **Mark as done** (or Complete in the popup/overview); otherwise it stays Overdue.

- **Overview:** the popup's **View all & completed** opens a page with Overdue / Today / Tomorrow / Later / Completed, each with Snooze (presets or custom time), Complete, Open and Delete.

- **Shortcut in Chat:** the clock button next to the Chat logo (red with a count when something is due, faded otherwise) opens the popup. Keyboard: **Alt+Shift+R** (change at `chrome://extensions/shortcuts`).

## Notes
- All data stays in `chrome.storage.local`; nothing is sent anywhere.
- Google Chat's DOM is obfuscated. If the clock button stops appearing, update `SELECTORS` at the top of `content.js`.
- Message deep links aren't exposed in the DOM, so "Open chat" opens the space/DM URL that was current when you set the reminder.

## Test
`node test/time.test.js`
