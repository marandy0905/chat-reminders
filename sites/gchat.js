// Google Chat adapter for content.js: which elements are messages, their text, link, hover toolbar and where the
// launcher goes. Chat's DOM is obfuscated and changes; every selector lives here so fixes are one-line.
const SELECTORS = {
  // One single message (verified against Chat's markup: role=group, data-id = message id, data-user-id = author).
  messageRow: "[data-message-multiplat-item-id]",
  // Used only when the above isn't present: older / other views. Note data-topic-id is a whole thread.
  fallbackRow: "[data-message-id], [data-topic-id]",
  // Never offer the button inside the side panel / navigation (space list, etc.).
  excluded: "nav, [role='navigation'], [role='tree'], [role='banner']",
  // Just the message text (no sender, timestamp or toolbar), inside a messageRow: id="<message id>/qJTHM".
  // Tried in order (a quoted message inside the row has its own body element, so the exact id comes first).
  messageBody: (id) => [`[id="${CSS.escape(id)}/qJTHM"]`, "[jsname='bgckF']"],
  // Image / file attachments of a messageRow: id="<message id>/qDpUz".
  messageAttachments: (id) => [`[id="${CSS.escape(id)}/qDpUz"]`, "[jsname='KUOBaf']"],
};

const UI_NODES = "button, [role='button'], [role='toolbar'], [role='menu'], [role='menuitem'], [role='tooltip'], [aria-hidden='true'], [data-tooltip], [data-emoji-picker-button-id], [data-menu-action], .gcr-label, style, script";
const SENDER_SEL = "[data-name], [data-member-id]";

// Metadata phrases Chat injects as hidden text (English + Traditional Chinese).
const NOISE = [
  /Reminder (?:set for|due) [^·]*· View reminders/g,
  /Open in chat/gi, /Open in space/gi, /Copy link/gi, /Reply in thread/gi, /Add reaction/gi, /More actions/gi,
  /\bis the owner\b/gi, /\bis a manager\b/gi, /\bExternal\b(?=\s|,|$)/g,
  /Edited on [A-Za-z]{3,9}\.? \d{1,2}, \d{4}/gi, /\bEdited\b/gi,
  /\d+ repl(?:y|ies)\s*,?\s*(?:Last Reply:?\s*[\d:]+\s*(?:[AP]M)?)?/gi,
  /Last Reply:?\s*[\d:]+\s*(?:[AP]M)?/gi,
  /複製連結/g, /在即時通訊中開啟/g, /在聊天室中開啟/g, /在聊天室開啟/g, /在對話中開啟/g,
  /已於[^,，\s]*編輯/g, /已編輯/g, /\d+\s*則回覆\s*[,，]?\s*(?:最近回覆[:：]?\s*[^,，\s]*)?/g,
  /(?:^|\s):[a-z0-9_+-]{2,30}:(?=\s|$)/gi, /[,，]\s*(?:(?:Yesterday|Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(?:(?:上午|下午)\s*)?\d{1,2}:\d{2}\s*(?:[AP]M)?\s*(?=[,，]|$)/gi,
];

// Screen-reader prefixes/suffixes such as "1 unread," at the start or ", min" at the end.
const EDGE_NOISE = [
  /[,，]\s*(?:Yesterday|Today)\s*$/i,
  /^[\s,，]*(?:Yesterday|Today)\s*[,，]\s*/i,
  /^[\s,，]*\d+\s*(?:min|mins|minutes?|hrs?|hours?|secs?|seconds?)\s*[,，]\s*/i,
  /^\s*(?:\d+\s+unread|unread)\s*[,，]?\s*/i,
  /^\s*\d+\s*則未讀\s*[,，]?\s*/,
  /[,，]\s*(?:\d+\s*)?(?:min|mins|minutes?|hrs?|hours?|secs?|seconds?)\.?(?:\s+ago)?\s*$/i,
  /\s\d+\s*(?:min|mins|minutes?|hrs?|hours?|secs?|seconds?)\s+ago\s*$/i,
  /[,，]?\s*\d+\s*(?:分鐘|小時|秒)前\s*$/,
];

// Normalise separators/whitespace and trim stray punctuation from both ends.
function tidy(t) {
  return t
    .replace(/\s+([,，.。])/g, "$1")
    .replace(/(?:\s*[,，]){2,}/g, ",")
    .replace(/^[\s,，.。:：-]+|[\s,，:：-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(raw, sender) {
  let t = raw;
  if (sender) {
    // Your own messages show "You" in place of your name.
    t = t.includes(sender) ? t.split(sender).join(" ") : t.replace(/^\s*You\b/, " ");
  }
  for (const re of NOISE) t = t.replace(re, " ");
  // Tidy first: edge patterns like ", 11 min" only match once trailing separators (", 11 min ,") are gone.
  t = tidy(t);
  for (let i = 0; i < 3; i++) for (const re of EDGE_NOISE) t = tidy(t.replace(re, ""));
  return t;
}

function senderOf(row) {
  const uid = row.getAttribute && row.getAttribute("data-user-id");
  const author = uid && row.querySelector(`[data-member-id="${CSS.escape(uid)}"]`);
  if (author) return (author.getAttribute("data-name") || author.textContent || "").replace(/\s+/g, " ").trim();
  // Grouped messages omit the name, so also look at the preceding siblings.
  let el = row;
  for (let i = 0; el && i < 12; i++, el = el.previousElementSibling) {
    const s = el.querySelector(SENDER_SEL) || (el.matches(SENDER_SEL) ? el : null);
    if (s) return (s.getAttribute("data-name") || s.textContent || "").replace(/\s+/g, " ").trim();
  }
  return "";
}

// Text of Chat's own message-body element, when it can be found. It holds only what was written (mentions
// included), so none of the header/timestamp clean-up below is needed.
// Messages with no words (only a custom emoji, an image or other attachment) are saved as "Image".
function bodyText(row) {
  const id = row.getAttribute("data-id");
  if (!id) return "";
  const find = (sels) => sels.map((s) => row.querySelector(s)).find(Boolean);
  const body = find(SELECTORS.messageBody(id));
  const attachments = find(SELECTORS.messageAttachments(id));
  const text = body ? textOf(body) : "";
  if (text) return text;
  return (body && body.querySelector("img")) || (attachments && attachments.querySelector("img")) ? RTime.t("msg_image") : "";
}

function textOf(body) {
  const parts = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && n.matches("[aria-hidden='true'], .gcr-label, style, script")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) parts.push(n.nodeValue);
    else if (/^(DIV|P|BR|LI)$/.test(n.tagName)) parts.push(" ");
  }
  return tidy(parts.join(""));
}

function extract(row) {
  const sender = senderOf(row);
  const body = bodyText(row);
  if (body) return { text: body.slice(0, SNIPPET_LEN), sender };
  const parts = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && n.matches(UI_NODES) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) parts.push(n.nodeValue);
    else if (/^(DIV|P|BR|LI)$/.test(n.tagName)) parts.push(" ");
  }
  let text = cleanText(parts.join(""), sender);
  // The filters above can swallow everything (e.g. when a thread reply sits inside a button-like wrapper).
  // Fall back to the row's plain visible text rather than saving an empty placeholder.
  if (!text) text = cleanText((row.innerText || row.textContent || "").replace(/\s+/g, " "), sender);
  text = text.slice(0, SNIPPET_LEN);
  return { text: text || RTime.t("msg_fallback"), sender };
}

// Chat's message links look like  https://chat.google.com/room/<space>/<topic>/<message>?cls=10
// (a top-level message has topic == message; a thread reply keeps the topic and has its own message id).
const ID_RE = /^[A-Za-z0-9_-]{8,16}$/;
const lastToken = (v) => String(v || "").split(/[\/:]/).filter(Boolean).pop() || "";

function spaceId() {
  const s = location.pathname + location.hash;
  for (const m of s.matchAll(/(?:chat|room|dm|space)\/([A-Za-z0-9_-]{8,})/g)) return m[1];
  return "";
}

// Message id: the single-message element's data-id ("MSG_LIST/yt/<id>"), else the older views' attributes.
function messageId(row) {
  const msgEl = row.closest("[data-message-multiplat-item-id]");
  const topicEl = row.closest("[data-topic-id]");
  return (
    lastToken(msgEl && (msgEl.getAttribute("data-id") || msgEl.getAttribute("data-message-multiplat-item-id"))) ||
    lastToken((row.closest("[data-message-id]") || row).getAttribute("data-message-id")) ||
    lastToken(topicEl && topicEl.getAttribute("data-topic-id"))
  );
}

function permalink(row) {
  // The hover toolbar inside a message is also tagged with data-topic-id, so it is skipped; a topic id that doesn't
  // look like one (e.g. a row Chat has since re-rendered and detached) falls back to the message's own id.
  const msg = messageId(row);
  const topicEl = row.closest("[data-topic-id]") || [...row.querySelectorAll("[data-topic-id]")].find((el) => !el.matches(TOOLBAR));
  const topic = lastToken(topicEl && topicEl.getAttribute("data-topic-id"));
  const space = spaceId();
  if (space && ID_RE.test(msg)) {
    return `https://chat.google.com/room/${space}/${ID_RE.test(topic) ? topic : msg}/${msg}?cls=10`;
  }
  return location.href; // couldn't identify the message: open the space/DM instead
}

// Links Chat itself copied via its "Copy link" action (reported by hook.js running in the page world).
const copiedLinks = [];
window.addEventListener("message", (e) => {
  if (e.source === window && e.data && e.data.gcr === "copied-link") {
    copiedLinks.push({ at: new Date().toISOString(), link: String(e.data.text).slice(0, 500) });
    if (copiedLinks.length > 5) copiedLinks.shift();
  }
});

// Chat's own hover toolbar (reactions, reply, more...). We put our clock button inside it, next to its
// "More" button, so it looks native. Found by the buttons' aria-labels since the markup is obfuscated.
// Only the hover toolbar has a "More actions" button; "Reply" / "Add reaction" also exist elsewhere on a message
// (under it, next to reaction chips), which put the clock in the wrong place.
const TOOLBAR_LABELS = /^(more actions|more|更多)/i;
const labelOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || "").trim();
const buttonCount = (el) => el.querySelectorAll("button, [role='button']").length;

function findToolbarAnchor(row, hovered) {
  const roots = row.matches(SELECTORS.messageRow) ? [row] : [row, row.parentElement];
  for (const root of roots) {
    if (!root) continue;
    let cands = [...root.querySelectorAll("button[aria-label], [role='button'][aria-label]")].filter((b) =>
      TOOLBAR_LABELS.test(labelOf(b))
    );
    if (!cands.length) continue;
    // A thread holds several messages (and toolbars): use the toolbar belonging to the message under the pointer.
    for (let el = hovered; el && el !== root.parentElement; el = el.parentElement) {
      const inside = cands.filter((b) => el.contains(b));
      if (inside.length) { cands = inside; break; }
    }
    let child = cands.find((b) => /^(more|更多)/i.test(labelOf(b))) || cands[cands.length - 1];
    // Climb to the direct child of the container that holds the toolbar's buttons.
    while (child.parentElement && child.parentElement !== root && buttonCount(child.parentElement) < 3) {
      child = child.parentElement;
    }
    return child;
  }
  return findNearbyToolbarAnchor(row);
}

// In compact mode the hover toolbar isn't inside the message's subtree. Fall back to the visible toolbar that
// sits on (or just above/below) the hovered message. `data-more-actions-menu-button-id` marks the slot right
// before the toolbar's "More actions" button and isn't obfuscated.
const NEARBY_TOOLBAR_PX = 48;
function findNearbyToolbarAnchor(row) {
  const r = row.getBoundingClientRect();
  let best = null;
  let bestDist = Infinity;
  for (const marker of document.querySelectorAll("[data-more-actions-menu-button-id]")) {
    const more = marker.nextElementSibling;
    if (!more || !more.offsetParent) continue;
    const b = more.getBoundingClientRect();
    const dist = b.bottom < r.top ? r.top - b.bottom : b.top > r.bottom ? b.top - r.bottom : 0;
    if (dist < bestDist) { best = more; bestDist = dist; }
  }
  return bestDist <= NEARBY_TOOLBAR_PX ? best : null;
}

// Chat's per-message hover toolbar is itself tagged with data-topic-id, so it must never be mistaken for the message.
const TOOLBAR = "[data-emoji-picker-button-id], [data-menu-action]";
function rowOf(target) {
  let el = target.closest(SELECTORS.messageRow);
  if (el) return el;
  el = target.closest(SELECTORS.fallbackRow);
  while (el && el.matches(TOOLBAR)) el = el.parentElement && el.parentElement.closest(SELECTORS.fallbackRow);
  return el;
}

// In the standard (bubble) layout your own messages sit on the right. Chat's markup doesn't say so, so compare
// where the message's text actually is with the row's edges. Chat's hover toolbar and its tooltips are text in
// the row too, so they're skipped, and the answer is kept per row (until its width changes) so the label never
// jumps while hovering.
function isRightAligned(row) {
  const r = row.getBoundingClientRect();
  if (row._gcrEnd && row._gcrEnd.width === r.width) return row._gcrEnd.end;
  let left = Infinity;
  let right = -Infinity;
  const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue.trim() && !n.parentElement.closest(`.gcr-label, ${UI_NODES}`) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const range = document.createRange();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    range.selectNodeContents(n);
    const b = range.getBoundingClientRect();
    if (!b.width) continue;
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
  }
  if (!(right > left)) return false;
  const end = r.right - right < left - r.left;
  row._gcrEnd = { width: r.width, end };
  return end;
}

// Sit right of the "Chat" wordmark in the top-left header. Found by its text, since Chat's markup is obfuscated.
// Any implausible result falls back to the fixed spot in the CSS, so the button can never end up off-screen.
const WORDMARK = /^(Chat|聊天|即時通訊)$/;
const findWordmark = () => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!WORDMARK.test(n.nodeValue.trim())) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && r.top >= 0 && r.top < 70 && r.right > 40 && r.right < 360) return r;
  }
  return null;
};
// Second method, independent of Chat's markup: walk along the header's vertical centre from the left edge and
// follow the run of small elements (menu icon, logo, wordmark) until the first real gap; the run's right edge
// is where the launcher goes.
const scanHeaderRight = (launcher) => {
  const y = 28;
  let right = 0, lastHit = -1e9;
  for (let x = 8; x < 320; x += 4) {
    if (x - lastHit > 28) break;
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === launcher || el === document.body || el === document.documentElement) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 220 || r.height > 64 || r.width < 4) continue;
      right = Math.max(right, r.right);
      lastHit = x;
    }
  }
  return right;
};
// Preferred spot: a pill right of the "New chat" button, matching its height. Found by its text; the nearest
// ancestor with a plausible button size is taken as the button.
const NEW_CHAT = /^(New chat|發起新聊天|新聊天|新对话|新對話)$/;
const findNewChat = () => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!NEW_CHAT.test(n.nodeValue.trim())) continue;
    for (let el = n.parentElement, i = 0; el && i < 6; el = el.parentElement, i++) {
      const r = el.getBoundingClientRect();
      if (r.height >= 36 && r.height <= 72 && r.width >= 90 && r.width <= 280 && r.left < 400 && r.top < 200) return el;
    }
  }
  return null;
};

// Put the launcher right of "New chat" (as a pill in Chat's own button style) or else right of the header wordmark.
// Anything implausible leaves it at the fixed fallback spot from the CSS.
function placeLauncher(launcher) {
  const ncEl = findNewChat();
  if (ncEl) {
    const nc = ncEl.getBoundingClientRect();
    // Copy the look of Chat's own button (user theme colour, corner radius, shadow) from the nearest styled element.
    let look = null;
    for (let el = ncEl, i = 0; el && i < 4 && !look; el = el.parentElement, i++) {
      const cs = getComputedStyle(el);
      if (!/^rgba\(.*,\s*0\)$|^transparent$/.test(cs.backgroundColor)) look = cs;
    }
    launcher.classList.add("gcr-pill");
    launcher.style.setProperty("--gcr-pill-bg", look ? look.backgroundColor : "");
    launcher.style.setProperty("--gcr-pill-fg", look ? look.color : "");
    launcher.style.setProperty("--gcr-pill-shadow", look ? look.boxShadow : "none");
    launcher.style.setProperty("--gcr-pill-radius", look ? look.borderRadius : `${Math.round(nc.height / 3)}px`);
    launcher.style.left = `${Math.round(nc.right + 10)}px`;
    launcher.style.top = `${Math.round(nc.top)}px`;
    launcher.style.height = `${Math.round(nc.height)}px`;
    launcher.style.minWidth = `${Math.round(nc.height)}px`;
    return;
  }
  // New chat not visible (e.g. collapsed sidebar): sit right of the header wordmark instead.
  launcher.classList.remove("gcr-pill");
  launcher.style.height = launcher.style.minWidth = "";
  const word = findWordmark();
  const right = Math.max(word ? word.right : 0, scanHeaderRight(launcher));
  if (right < 60 || right > 340) return; // implausible: keep the fixed fallback position from the CSS
  launcher.style.left = `${Math.round(right + 14)}px`;
  launcher.style.top = "10px";
}

const GCRSite = {
  id: "gchat",
  toolbarSel: TOOLBAR,
  senderSel: SENDER_SEL,
  rowOf: (target) => {
    const row = rowOf(target);
    return row && !row.closest(SELECTORS.excluded) ? row : null;
  },
  isToolbar: (el) => !!el.closest(TOOLBAR),
  extract,
  permalink,
  // permalink() falls back to the space's address when it can't identify the message.
  isMessageLink: (url) => !!RTime.messageIdOf(url),
  // The message id, stored with the reminder so the same message is recognised even when its link couldn't be
  // built (labels use it too; older reminders without one fall back to the id in the link, RTime.messageIdOf).
  messageKey: (row) => (ID_RE.test(messageId(row)) ? messageId(row) : undefined),
  rows: () => document.querySelectorAll(SELECTORS.messageRow),
  rowKey: (row) => row.getAttribute("data-id"),
  labelHost: (row) => row,
  alignEnd: isRightAligned,
  toolbarAnchor: findToolbarAnchor,
  placeLauncher,
  debugInfo(row) {
    // Every labelled button in the row (hidden ones too: Chat hides the toolbar once the pointer leaves the
    // message), to see why findToolbarAnchor() missed it.
    const toolbarButtons = [...row.querySelectorAll("button, [role='button']")]
      .slice(0, 30)
      .map((b) => ({
        label: labelOf(b).slice(0, 60),
        matchesLabels: TOOLBAR_LABELS.test(labelOf(b)),
        visible: !!b.offsetParent,
        inToolbar: !!b.closest(TOOLBAR),
      }));
    // Every "More actions" slot on the page and how far it is from the row (findNearbyToolbarAnchor() needs it
    // visible and within NEARBY_TOOLBAR_PX).
    const rr = row.getBoundingClientRect();
    const moreSlots = [...document.querySelectorAll("[data-more-actions-menu-button-id]")].slice(0, 20).map((m) => {
      const more = m.nextElementSibling;
      const b = more && more.getBoundingClientRect();
      return {
        hasNext: !!more,
        visible: !!(more && more.offsetParent),
        inRow: row.contains(m),
        dist: b ? Math.round(b.bottom < rr.top ? rr.top - b.bottom : b.top > rr.bottom ? b.top - rr.bottom : 0) : null,
      };
    });
    return { copiedLinks, toolbarButtons, moreSlots, rowIsToolbar: row.matches(TOOLBAR) };
  },
};
