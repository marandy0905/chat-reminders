// Adds a hover "Remind me" button to Google Chat messages.
// Chat's DOM is obfuscated and changes; every selector lives here so fixes are one-line.
const SELECTORS = {
  // One single message (verified against Chat's markup: role=group, data-id = message id, data-user-id = author).
  messageRow: "[data-message-multiplat-item-id]",
  // Used only when the above isn't present: older / other views. Note data-topic-id is a whole thread.
  fallbackRow: "[data-message-id], [data-topic-id]",
  // Never offer the button inside the side panel / navigation (space list, etc.).
  excluded: "nav, [role='navigation'], [role='tree'], [role='banner']",
};
const SNIPPET_LEN = 400;

let btn, menu, activeRow, hideTimer, launcherEl, placeTimer;

// After the extension is reloaded/updated, the old content script keeps running in open tabs and every
// chrome.* call throws "Extension context invalidated". Detect that and tear the old instance down quietly.
const alive = () => {
  try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
};
function shutdown() {
  clearInterval(placeTimer);
  clearTimeout(hideTimer);
  [btn, menu, launcherEl].forEach((el) => el && el.remove());
  document.querySelectorAll(".gcr-inline").forEach((el) => el.remove());
  document.removeEventListener("mouseover", onMouseOver);
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("scroll", onScroll, true);
}

// Chat's theme can differ from the OS theme, so judge by the page's actual background.
function isDarkPage() {
  for (const el of [document.body, document.documentElement]) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor);
    if (m && (m[4] === undefined || +m[4] > 0.5)) return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) < 128;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function themed(el) {
  el.classList.toggle("gcr-dark", isDarkPage());
  return el;
}

// Chat's own hover toolbar / menus / tooltips and visually-hidden metadata live inside the message row.
// Their labels must not end up in the reminder text. Selectors are best effort (Chat's markup is obfuscated).
const UI_NODES = "button, [role='button'], [role='toolbar'], [role='menu'], [role='menuitem'], [role='tooltip'], [aria-hidden='true'], [data-tooltip], [data-emoji-picker-button-id], [data-menu-action], style, script";
const SENDER_SEL = "[data-name], [data-member-id]";

// Metadata phrases Chat injects as hidden text (English + Traditional Chinese).
const NOISE = [
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

function extract(row) {
  const sender = senderOf(row);
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
  return { text: text || "Message in Google Chat", sender };
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

function permalink(row) {
  // Message id: the single-message element's data-id ("MSG_LIST/yt/<id>"); topic id: the enclosing thread.
  const msgEl = row.closest("[data-message-multiplat-item-id]");
  const topicEl = row.closest("[data-topic-id]") || row.querySelector("[data-topic-id]");
  const topic = lastToken(topicEl && topicEl.getAttribute("data-topic-id"));
  const msg =
    lastToken(msgEl && (msgEl.getAttribute("data-id") || msgEl.getAttribute("data-message-multiplat-item-id"))) ||
    lastToken((row.closest("[data-message-id]") || row).getAttribute("data-message-id")) ||
    topic;
  const space = spaceId();
  if (space && ID_RE.test(topic || msg) && ID_RE.test(msg)) {
    return `https://chat.google.com/room/${space}/${topic || msg}/${msg}?cls=10`;
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

// Shift+click on the clock button copies what the extension sees (row HTML + extracted result) to the clipboard,
// for debugging selectors against Chat's real markup.
async function copyDebug(row) {
  // Ancestry of the point the mouse was on (up to 30 levels) with per-level stats, to find where one message ends.
  const hoverChain = [];
  for (let el = lastTarget, i = 0; el && el !== document.body && i < 30; el = el.parentElement, i++) {
    hoverChain.push({
      tag: el.tagName.toLowerCase(),
      attrs: Object.fromEntries([...el.attributes].filter((a) => /^(role|data-|aria-label|jsname|id)/.test(a.name)).map((a) => [a.name, a.value.slice(0, 80)])),
      toolbars: el.querySelectorAll(TOOLBAR).length,
      senders: el.querySelectorAll(SENDER_SEL).length,
      textLen: (el.innerText || "").length,
      text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 60),
    });
  }
  const info = { extracted: extract(row), copiedLinks, hoverChain, rowIsToolbar: row.matches(TOOLBAR), permalink: permalink(row), url: location.href };
  try {
    await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
    toast("Debug info copied to clipboard");
  } catch (_) {
    toast("Couldn't copy debug info");
  }
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "gcr-toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function send(msg) {
  if (!alive()) { shutdown(); return Promise.reject(new Error("extension reloaded")); }
  return chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || !r.ok) throw new Error((r && r.error) || "no response");
    return r.data;
  });
}

async function remindAt(row, when) {
  try {
    const { text, sender } = extract(row);
    await send({ type: "add", text, sender, when, url: permalink(row), source: "message" });
    toast(`Reminder set for ${RTime.formatWhen(when)}`);
  } catch (e) {
    toast("Couldn't set reminder (reload the page if the extension was updated)");
  }
}

function closeMenu() {
  menu && menu.remove();
  menu = null;
}

function openMenu(row, anchor) {
  closeMenu();
  menu = document.createElement("div");
  menu.className = "gcr-menu";
  themed(menu);
  const head = document.createElement("div");
  head.className = "gcr-menu-head";
  head.textContent = "Remind me about this";
  menu.appendChild(head);

  const item = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      fn();
    });
    menu.appendChild(b);
  };
  RTime.PRESETS.forEach((p) => item(p.label, () => remindAt(row, p.at(Date.now()))));

  const picker = RTime.createPicker(Date.now() + 3600e3);
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Set custom time";
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    const when = picker.get();
    if (!Number.isFinite(when)) return;
    closeMenu();
    remindAt(row, when);
  });
  menu.append(picker.el, go);

  const r = (anchor || btn).getBoundingClientRect();
  const M = 8; // margin kept to the viewport edges
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);

  // Fit the whole menu on screen: open below the button if it fits, else above, else take the larger side and
  // scroll inside the menu. Re-measured after the content is in the DOM.
  const full = menu.scrollHeight + 2;
  const below = window.innerHeight - r.bottom - M - 4;
  const above = r.top - M - 4;
  let top, maxH;
  if (full <= below) { top = r.bottom + 4; maxH = below; }
  else if (full <= above) { top = r.top - 4 - full; maxH = above; }
  else if (below >= above) { top = r.bottom + 4; maxH = below; }
  else { maxH = above; top = Math.max(M, r.top - 4 - Math.min(full, maxH)); }
  menu.style.maxHeight = `${Math.max(120, maxH)}px`;
  menu.style.overflowY = "auto";
  menu.style.top = `${Math.max(M, top)}px`;
  menu.style.left = `${Math.max(M, Math.min(r.right - 200, window.innerWidth - 200 - 2 * M))}px`;
  menu.style.visibility = "";
}

function ensureButton() {
  if (btn) return;
  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gcr-btn";
  themed(btn);
  btn.title = "Remind me about this message";
  btn.appendChild(RTime.icon("clock", 18));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey && activeRow) copyDebug(activeRow);
    else if (menu) closeMenu();
    else if (activeRow) openMenu(activeRow, btn);
  });
  btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  btn.addEventListener("mouseleave", scheduleHide);
  document.body.appendChild(btn);
}

function scheduleHide() {
  if (!alive()) return shutdown();
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!alive()) return shutdown();
    if (menu) return;
    btn && btn.classList.remove("gcr-show");
  }, 400);
}

// Chat's own hover toolbar (reactions, reply, more...). We put our clock button inside it, next to its
// "More" button, so it looks native. Found by the buttons' aria-labels since the markup is obfuscated.
// Only the hover toolbar has a "More actions" button; "Reply" / "Add reaction" also exist elsewhere on a message
// (under it, next to reaction chips), which put the clock in the wrong place.
const TOOLBAR_LABELS = /^(more actions|more|更多)/i;
const labelOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || "").trim();
const buttonCount = (el) => el.querySelectorAll("button, [role='button']").length;

function findToolbarAnchor(row) {
  const roots = row.matches(SELECTORS.messageRow) ? [row] : [row, row.parentElement];
  for (const root of roots) {
    if (!root) continue;
    let cands = [...root.querySelectorAll("button[aria-label], [role='button'][aria-label]")].filter((b) =>
      TOOLBAR_LABELS.test(labelOf(b))
    );
    if (!cands.length) continue;
    // A thread holds several messages (and toolbars): use the toolbar belonging to the message under the pointer.
    for (let el = lastTarget; el && el !== root.parentElement; el = el.parentElement) {
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
  return null;
}

// The toolbar sits inside the message bubble, so `color: inherit` picks up the bubble's text color (white on
// your own messages in light + compact mode). Copy the color Chat paints its own toolbar icons with instead.
function toolbarIconColor(anchor) {
  const svg = anchor.querySelector("svg");
  return svg ? getComputedStyle(svg).fill : getComputedStyle(anchor).color;
}

function injectInline(row) {
  const anchor = findToolbarAnchor(row);
  if (!anchor || !anchor.parentElement) return false;
  const parent = anchor.parentElement;
  // Only one toolbar is visible at a time: drop stray copies left in other containers (e.g. from nested
  // thread rows or earlier hovers) so the toolbar never shows two clocks.
  document.querySelectorAll(".gcr-inline").forEach((el) => el.parentElement !== parent && el.remove());
  const existing = [...parent.children].filter((el) => el.classList.contains("gcr-inline"));
  existing.slice(1).forEach((el) => el.remove());
  if (existing.length) {
    // Keep the click handler bound to the row currently being hovered.
    existing[0]._gcrRow = row;
    existing[0].style.color = toolbarIconColor(anchor);
    return true;
  }
  const b = document.createElement("button");
  b.type = "button";
  b.className = "gcr-inline";
  b.style.color = toolbarIconColor(anchor);
  b.title = "Remind me about this message";
  b.appendChild(RTime.icon("clock", 20));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const target = b._gcrRow || row;
    activeRow = target;
    if (e.shiftKey) copyDebug(target);
    else if (menu) closeMenu();
    else openMenu(target, b);
  });
  b._gcrRow = row;
  parent.insertBefore(b, anchor);
  return true;
}

function showFor(row) {
  clearTimeout(hideTimer);
  activeRow = row;
  // The toolbar may render a moment after the hover starts, so retry briefly.
  const tryInline = () => activeRow === row && injectInline(row);
  if (tryInline()) {
    btn && btn.classList.remove("gcr-show");
    return;
  }
  const now = Date.now();
  if (now - (row._gcrRetry || 0) > 1500) {
    row._gcrRetry = now;
    [80, 250, 600].forEach((ms) =>
    setTimeout(() => {
      if (alive() && tryInline()) btn && btn.classList.remove("gcr-show");
    }, ms)
    );
  }

  // Fallback while (or if) the toolbar can't be found: a floating button at the row's right edge.
  ensureButton();
  themed(btn);
  const r = row.getBoundingClientRect();
  btn.style.top = `${Math.max(0, r.top + 4)}px`;
  btn.style.left = `${Math.max(0, Math.min(r.right - 140, window.innerWidth - 36))}px`;
  btn.classList.add("gcr-show");
}

let lastTarget = null;

// Chat's per-message hover toolbar is itself tagged with data-topic-id, so it must never be mistaken for the message.
const TOOLBAR = "[data-emoji-picker-button-id], [data-menu-action]";
function rowOf(target) {
  let el = target.closest(SELECTORS.messageRow);
  if (el) return el;
  el = target.closest(SELECTORS.fallbackRow);
  while (el && el.matches(TOOLBAR)) el = el.parentElement && el.parentElement.closest(SELECTORS.fallbackRow);
  return el;
}

function onMouseOver(e) {
  if (!alive()) return shutdown();
  if (!(e.target instanceof Element) || e.target.closest(".gcr-btn, .gcr-menu")) return;
  // Moving from the message onto its toolbar: keep the message we were on.
  if (e.target.closest(TOOLBAR + ", .gcr-inline")) {
    clearTimeout(hideTimer);
    return;
  }
  lastTarget = e.target;
  const row = rowOf(e.target);
  if (row && !row.closest(SELECTORS.excluded)) showFor(row);
  else scheduleHide();
}
function onDocClick(e) {
  if (menu && !(e.target instanceof Element && e.target.closest(".gcr-menu"))) closeMenu();
}
function onScroll(e) {
  if (menu && e && e.target instanceof Node && menu.contains(e.target)) return; // scrolling the menu itself
  closeMenu();
  btn && btn.classList.remove("gcr-show");
}
document.addEventListener("mouseover", onMouseOver, { passive: true });
document.addEventListener("click", onDocClick);
document.addEventListener("scroll", onScroll, { capture: true, passive: true });

// Launcher: small button (top frame only) that opens the reminders overview, with a count of active reminders.
if (window.top === window) {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "gcr-launcher";
  launcher.title = "Show my reminders";
  const icon = document.createElement("span");
  icon.className = "gcr-icon";
  icon.appendChild(RTime.icon("clock", 22));
  const badge = document.createElement("span");
  launcher.append(icon, badge);
  themed(launcher);
  launcherEl = launcher;
  launcher.addEventListener("click", () => (alive() ? chrome.runtime.sendMessage({ type: "popup" }) : shutdown()));
  launcher.addEventListener("mouseenter", () => themed(launcher));
  document.body.appendChild(launcher);

  // Red + count when something is due; faded otherwise (future reminders don't count).
  const refresh = () => {
    if (!alive()) return shutdown();
    return chrome.storage.local.get("reminders").then((o) => {
      const now = Date.now();
      const due = Object.values(o.reminders || {}).filter((r) => !r.done && r.when <= now).length;
      badge.textContent = due ? String(due) : "";
      launcher.classList.toggle("gcr-due", due > 0);
      launcher.title = due ? `${due} reminder${due > 1 ? "s" : ""} due` : "Show my reminders";
    }).catch(() => {});
  };
  chrome.storage.onChanged.addListener((_c, area) => area === "local" && refresh());

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
  const scanHeaderRight = () => {
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
  const place = () => {
    if (!alive()) return shutdown();
    themed(launcher);
    refresh();
    const word = findWordmark();
    const right = Math.max(word ? word.right : 0, scanHeaderRight());
    if (right < 60 || right > 340) return; // implausible: keep the fixed fallback position from the CSS
    launcher.style.left = `${Math.round(right + 14)}px`;
    launcher.style.top = "10px";
  };
  place();
  addEventListener("resize", place);
  placeTimer = setInterval(place, 3000); // header renders late; also keeps the due state current as time passes
}
