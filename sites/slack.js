// Slack adapter for content.js (app.slack.com): which elements are messages, their text, link and hover toolbar.
// Slack marks its UI with data-qa attributes, which change less often than class names. Every selector lives here
// so fixes are one-line; Shift+click the clock button to copy what the extension sees.
const SLACK = {
  // One message. In channels and the thread panel each virtual-list item holds one message, but in Unreads and
  // Threads one item holds a whole group (a channel's unreads, a thread with replies), so the message element
  // itself is the unit. Tried in order.
  message: ["[data-qa='message_container']", ".c-message_kit__message"],
  // Virtual-list item around a message; its key may carry the message timestamp.
  item: ".c-virtual_list__item[data-item-key]",
  sender: "[data-qa='message_sender_name']",
  // Tried in order: the rich-text body, then the whole blocks area (attachments, bot messages).
  text: ["[data-qa='message-text']", ".c-message_kit__blocks", ".c-message__body"],
  // The time link next to the sender is the message's permalink (…/archives/<channel>/p<ts>).
  timestamp: "a.c-timestamp[href]",
  // Hover toolbar and its "More actions" button.
  toolbar: "[data-qa='message-actions'], .c-message_actions__container",
  more: "[data-qa='more_message_actions']",
  // A channel / DM in the sidebar, by channel id (completed with the id and "]").
  sidebarChannel: "[data-qa-channel-sidebar-channel-id",
  // "N replies" link under a message that has a thread.
  replies: "[data-qa='reply_bar_count'], .c-message__reply_count",
  // Right-hand column of a message (sender line + text); the reminder label goes at its top.
  content: ".c-message_kit__gutter__right",
};
// Message timestamp ("1700000000.123456"): from the message's own time link (…/p1700000000123456), which is
// unique per message in every view; else from the list item's key, if that item holds only this message (the key
// may carry a prefix, e.g. in threads).
const SLACK_TS = /\d{9,11}\.\d{6}/;
const SLACK_LINK_TS = /\/p(\d{9,11})(\d{6})(?:[?#]|$)/;
const slackMessages = (root = document) => root.querySelectorAll(SLACK.message[0]).length
  ? root.querySelectorAll(SLACK.message[0])
  : root.querySelectorAll(SLACK.message[1]);
function slackKey(row) {
  const a = row.querySelector(SLACK.timestamp);
  const l = a && SLACK_LINK_TS.exec(a.getAttribute("href") || "");
  if (l) return `${l[1]}.${l[2]}`;
  const item = row.closest(SLACK.item);
  const m = item && slackMessages(item).length === 1 && SLACK_TS.exec(item.getAttribute("data-item-key") || "");
  return m ? m[0] : "";
}
// offsetParent is null for position:fixed elements, so check for a rendered box instead.
const shown = (el) => !!el && el.getClientRects().length > 0;
const NEARBY_PX = 48;
const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

function slackRowOf(target) {
  const row = SLACK.message.map((sel) => target.closest(sel)).find(Boolean);
  return row && slackKey(row) ? row : null;
}

// Follow-up messages from the same person don't repeat the name: look at the messages before this one.
function slackSender(row) {
  const all = [...slackMessages()];
  for (let i = all.indexOf(row), n = 0; i >= 0 && n < 15; i--, n++) {
    const s = all[i].querySelector(SLACK.sender);
    if (s) return oneLine(s.textContent);
  }
  return "";
}

function slackExtract(row) {
  let text = "";
  for (const sel of SLACK.text) {
    const el = row.querySelector(sel);
    if (el && (text = oneLine(el.innerText || el.textContent))) break;
  }
  text = text.replace(/\s*\((?:edited|已編輯)\)\s*$/i, "");
  return { text: text || RTime.t("msg_fallback"), sender: slackSender(row) };
}

function slackPermalink(row) {
  const a = row.querySelector(SLACK.timestamp);
  return (a && a.href) || location.href; // no time link: open the channel instead
}

// Visible element matching `sel` inside the message, else the nearest one on (or just above/below) it.
function nearestShown(row, sel) {
  const inside = [...row.querySelectorAll(sel)].find(shown);
  if (inside) return inside;
  const r = row.getBoundingClientRect();
  let best = null;
  let bestDist = Infinity;
  for (const el of document.querySelectorAll(sel)) {
    if (!shown(el)) continue;
    const box = el.getBoundingClientRect();
    const dist = box.bottom < r.top ? r.top - box.bottom : box.top > r.bottom ? box.top - r.bottom : 0;
    if (dist < bestDist) { best = el; bestDist = dist; }
  }
  return bestDist <= NEARBY_PX ? best : null;
}

// Message, channel and (for a thread reply) parent from a Slack permalink: …/archives/<channel>/p<ts>?thread_ts=….
function slackLocate(url) {
  const m = /\/archives\/([A-Z0-9]+)\/p(\d{9,11})(\d{6})/.exec(url || "");
  if (!m) return null;
  const parent = new URL(url).searchParams.get("thread_ts") || "";
  const key = `${m[2]}.${m[3]}`;
  return { key, channel: m[1], parentKey: parent !== key ? parent : "" };
}

// The channel / DM in Slack's sidebar (clicking it opens the conversation in place). The click goes to this element
// itself: Slack handles it there, not on the tree item around it, and the buttons inside it do other things.
function slackConversationEntry(target) {
  return document.querySelector(`${SLACK.sidebarChannel}="${CSS.escape(target.channel)}"]`);
}

// Open a message's thread in the side panel by clicking its "N replies" link.
function slackOpenThread(post) {
  const button = post.querySelector(SLACK.replies);
  if (!button) return false;
  button.click();
  return true;
}

// Our clock goes right before the message's own "More actions" button. Looked up directly rather than via its
// toolbar, because files and images in a message have hover bars of their own (without that button).
function slackToolbarAnchor(row) {
  const more = nearestShown(row, SLACK.more);
  if (more) return more;
  const bar = nearestShown(row, SLACK.toolbar);
  const buttons = bar ? bar.querySelectorAll("button, [role='button']") : [];
  return buttons[buttons.length - 1] || null;
}

// Look like Slack's own toolbar buttons: their size, corner radius and icon colour (Slack colours the icon paths,
// so the <svg> itself reports black). Slack's toolbar styles would otherwise give the button a grey fill.
function slackStyleInline(b, anchor) {
  const cs = getComputedStyle(anchor);
  b.classList.add("gcr-inline-slack");
  b.style.color = cs.color;
  b.style.width = cs.width;
  b.style.height = cs.height;
  b.style.borderRadius = cs.borderRadius;
}

const GCRSite = {
  id: "slack",
  toolbarSel: SLACK.toolbar,
  senderSel: SLACK.sender,
  rowOf: slackRowOf,
  // Only the message's own toolbar: a file or image has a hover bar too, and hovering it must still count as
  // hovering the message.
  isToolbar: (el) => { const bar = el.closest(SLACK.toolbar); return !!(bar && bar.querySelector(SLACK.more)); },
  extract: slackExtract,
  permalink: slackPermalink,
  messageKey: slackKey,
  rows: () => slackMessages(),
  rowKey: slackKey,
  labelHost: (row) => row.querySelector(SLACK.content) || row,
  locate: slackLocate,
  conversationEntry: slackConversationEntry,
  openThread: slackOpenThread,
  // Message text: Slack follows its own links clicked in there without reloading.
  linkHosts: () => [
    ...[...document.querySelectorAll(`${SLACK.text[0]} a[href]`)].map((a) => a.parentElement),
    ...document.querySelectorAll(SLACK.text.slice(0, 2).join(", ")),
  ],
  toolbarAnchor: slackToolbarAnchor,
  styleInline: slackStyleInline,
  debugInfo: (row) => ({
    itemKey: (row.closest(SLACK.item) || row).getAttribute("data-item-key"),
    messagesInItem: row.closest(SLACK.item) ? slackMessages(row.closest(SLACK.item)).length : null,
    hasToolbar: !!row.querySelector(SLACK.toolbar),
    toolbarsOnPage: [...document.querySelectorAll(SLACK.toolbar)].map((b) => ({ shown: shown(b), inRow: row.contains(b) })),
    toolbarButtons: [...row.querySelectorAll(`${SLACK.toolbar} button`)].slice(0, 12).map((b) => b.getAttribute("data-qa") || b.getAttribute("aria-label")),
    timestamp: (row.querySelector(SLACK.timestamp) || {}).href || null,
  }),
};
