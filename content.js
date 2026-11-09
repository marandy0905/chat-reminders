// Adds a hover "Remind me" button to chat messages (Google Chat, Slack, Teams). Everything that depends on the
// app's markup (which elements are messages, their text and link, the hover toolbar) comes from the site adapter
// loaded before this file: sites/<site>.js defines GCRSite.
const SNIPPET_LEN = 400;

// Quick options for the menu (user-editable on the options page), kept in sync with storage.
let presetData = RTime.sanitizePresets();
let presets = RTime.buildPresets(presetData);
let menu, activeRow, launcherEl, panelEl, placeTimer, labelObserver, labelTick;

// After the extension is reloaded/updated, the old content script keeps running in open tabs and every
// chrome.* call throws "Extension context invalidated". Detect that and tear the old instance down quietly.
const alive = () => {
  try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
};
function shutdown() {
  clearInterval(placeTimer);
  [menu, launcherEl, panelEl].forEach((el) => el && el.remove());
  document.querySelectorAll(".gcr-inline, .gcr-label").forEach((el) => el.remove());
  document.querySelectorAll("[data-gcr-reminder]").forEach((el) => el.removeAttribute("data-gcr-reminder"));
  labelObserver && labelObserver.disconnect();
  clearInterval(labelTick);
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

// Make a floating surface follow the user's Chat theme (not just light/dark): take the surface and text colours
// from the page (sidebar area; body inside iframes) and New chat's fill for hover, via the --gcr-* variables.
function chatTheme(el) {
  const solid = (n) => {
    for (; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (!/^rgba\(.*,\s*0\)$|^transparent$/.test(c)) return c;
    }
    return "";
  };
  themed(el);
  const under = (window.top === window && document.elementFromPoint(24, Math.min(300, innerHeight - 2))) || document.body;
  const bg = solid(under) || solid(document.body);
  const fg = getComputedStyle(under).color;
  const fill = launcherEl && launcherEl.style.getPropertyValue("--gcr-pill-bg");
  if (bg) el.style.setProperty("--gcr-bg", bg);
  if (fg) {
    el.style.setProperty("--gcr-fg", fg);
    el.style.setProperty("--gcr-muted", `color-mix(in srgb, ${fg} 62%, transparent)`);
    el.style.setProperty("--gcr-border", `color-mix(in srgb, ${fg} 16%, transparent)`);
    el.style.setProperty("--gcr-hover", fill || `color-mix(in srgb, ${fg} 10%, transparent)`);
  }
  return el;
}

// Chat's own hover toolbar / menus / tooltips and visually-hidden metadata live inside the message row.
// Their labels must not end up in the reminder text. Selectors are best effort (Chat's markup is obfuscated).
// Shift+click on the clock button copies what the extension sees (hover chain + extracted result + the site's own
// details) to the clipboard, for debugging selectors against the app's real markup.
async function copyDebug(row) {
  // Ancestry of the point the mouse was on (up to 30 levels) with per-level stats, to find where one message ends.
  const hoverChain = [];
  for (let el = lastTarget, i = 0; el && el !== document.body && i < 30; el = el.parentElement, i++) {
    hoverChain.push({
      tag: el.tagName.toLowerCase(),
      attrs: Object.fromEntries([...el.attributes].filter((a) => /^(role|data-|aria-label|jsname|id|class)/.test(a.name)).map((a) => [a.name, a.value.slice(0, 80)])),
      toolbars: el.querySelectorAll(GCRSite.toolbarSel).length,
      senders: el.querySelectorAll(GCRSite.senderSel).length,
      textLen: (el.innerText || "").length,
      text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 60),
    });
  }
  const info = {
    site: GCRSite.id,
    extracted: GCRSite.extract(row),
    key: GCRSite.rowKey(row),
    permalink: GCRSite.permalink(row),
    anchorFound: !!GCRSite.toolbarAnchor(row, lastTarget),
    hoverChain,
    ...(GCRSite.debugInfo ? GCRSite.debugInfo(row) : {}),
    url: location.href,
  };
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
    const { text, sender } = GCRSite.extract(row);
    const key = GCRSite.messageKey ? GCRSite.messageKey(row) : undefined;
    await send({ type: "add", text: text.slice(0, SNIPPET_LEN), sender, when, url: GCRSite.permalink(row), source: "message", site: GCRSite.id, key });
    toast(when == null ? RTime.t("toast_todo") : RTime.t("toast_set", { when: RTime.formatWhen(when) }));
  } catch (e) {
    toast(RTime.t("toast_fail"));
  }
}

function closeMenu() {
  menu && menu.remove();
  menu = null;
}

function savePresets(list) {
  presetData = RTime.sanitizePresets(list);
  presets = RTime.buildPresets(presetData);
  if (alive()) chrome.storage.local.set({ presets: presetData }).catch(() => {});
}

// Fit the whole menu on screen: open below the button if it fits, else above, else take the larger side and
// scroll inside the menu. Call the result again whenever the content changes (mode switch, added/removed option).
function menuFitter(anchor) {
  const r = anchor.getBoundingClientRect();
  const M = 8; // margin kept to the viewport edges
  return (first) => {
    menu.style.maxHeight = "";
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
    if (first) {
      menu.style.left = `${Math.max(M, Math.min(r.right - 264, window.innerWidth - 264 - 2 * M))}px`;
      menu.style.transformOrigin = `${Math.max(0, Math.round(r.left + r.width / 2 - parseFloat(menu.style.left)))}px ${top >= r.bottom ? "top" : "bottom"}`;
    }
  };
}

function newMenu() {
  closeMenu();
  menu = document.createElement("div");
  menu.className = "gcr-menu";
  chatTheme(menu);
  // Typing in the menu's fields must not trigger the app's keyboard shortcuts.
  menu.addEventListener("keydown", (e) => e.stopPropagation());
  menu.addEventListener("keyup", (e) => e.stopPropagation());
  return menu;
}

function showMenu(fit) {
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  fit(true);
  menu.style.visibility = "";
  requestAnimationFrame(() => menu && menu.classList.add("gcr-open"));
}

const mk = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (tag === "button") n.type = "button";
  return n;
};

// Snooze dropdown for a reminder in the panel: the fixed snooze times, then a custom date/time. For a todo it sets
// a time instead; for a timed reminder it also offers "Add to todo", which calls onPick(null).
function openSnoozeMenu(anchor, onPick, todo) {
  newMenu();
  const head = mk("div", "gcr-menu-head");
  head.appendChild(mk("span", null, RTime.t(todo ? "set_reminder" : "snooze")));
  menu.appendChild(head);
  const pick = (when) => { closeMenu(); onPick(when); };
  if (!todo) {
    const b = mk("button", "gcr-menu-item", RTime.t("add_todo"));
    b.addEventListener("click", (e) => { e.stopPropagation(); pick(null); });
    menu.append(b, mk("div", "gcr-menu-sep"));
  }
  for (const p of RTime.snoozePresets()) {
    const b = mk("button", "gcr-menu-item", p.label);
    b.appendChild(mk("span", "gcr-menu-hint", RTime.formatTime(p.at(Date.now()))));
    b.addEventListener("click", (e) => { e.stopPropagation(); pick(p.at(Date.now())); });
    menu.appendChild(b);
  }
  menu.append(mk("div", "gcr-menu-sep"), mk("div", "gcr-menu-sub", RTime.t("custom_time")));
  const picker = RTime.createPicker(Date.now() + 3600e3);
  const go = mk("button", "gcr-menu-primary", RTime.t("set_custom"));
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    const when = picker.get();
    if (Number.isFinite(when)) pick(when);
  });
  menu.append(picker.el, go);
  showMenu(menuFitter(anchor));
}

function openMenu(row, anchor) {
  newMenu();
  const head = mk("div", "gcr-menu-head");
  const title = mk("span", null, RTime.t("remind_me"));
  const toggle = mk("button", "gcr-menu-edit", RTime.t("edit"));
  head.append(title, toggle);
  const body = mk("div", "gcr-menu-body");
  menu.append(head, body);
  let editing = false;

  const unitFor = (min) => (min % 1440 === 0 ? 1440 : min % 60 === 0 ? 60 : 1);

  // Normal mode: "add to todo" (no time), the quick options, then a custom date/time.
  const renderList = () => {
    const todo = mk("button", "gcr-menu-item", RTime.t("add_todo"));
    todo.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); remindAt(row, null); });
    body.append(todo, mk("div", "gcr-menu-sep"));
    presets.forEach((p) => {
      const at = p.at(Date.now());
      const b = mk("button", "gcr-menu-item", p.label);
      if (!/\d:\d/.test(p.label)) b.appendChild(mk("span", "gcr-menu-hint", RTime.formatTime(at)));
      b.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); remindAt(row, at); });
      body.appendChild(b);
    });
    body.append(mk("div", "gcr-menu-sep"), mk("div", "gcr-menu-sub", RTime.t("custom_time")));
    const picker = RTime.createPicker(Date.now() + 3600e3);
    const go = mk("button", "gcr-menu-primary", RTime.t("set_reminder"));
    go.addEventListener("click", (e) => {
      e.stopPropagation();
      const when = picker.get();
      if (!Number.isFinite(when)) return;
      closeMenu();
      remindAt(row, when);
    });
    body.append(picker.el, go);
  };

  // Edit mode: the same list, editable in place. Every change is saved straight away.
  const renderEdit = () => {
    presetData.forEach((o, i) => {
      const li = mk("div", "gcr-menu-row");
      if (o.kind === "tomorrow") {
        const time = mk("input");
        time.type = "time";
        time.value = o.time;
        time.addEventListener("change", () => { if (time.value) { const l = presetData.slice(); l[i] = { kind: "tomorrow", time: time.value }; savePresets(l); render(); } });
        li.append(mk("span", "gcr-menu-rowlabel", RTime.t("opt_tomorrow")), time);
      } else {
        const unit = unitFor(o.minutes);
        const num = mk("input");
        num.type = "number";
        num.min = "1";
        num.step = "1";
        num.value = String(o.minutes / unit);
        const sel = mk("select");
        for (const [key, mult] of [["unit_min", 1], ["unit_hr", 60], ["unit_day", 1440]]) {
          const opt = mk("option", null, RTime.t(key));
          opt.value = String(mult);
          opt.selected = mult === unit;
          sel.appendChild(opt);
        }
        const commit = () => {
          const n = parseFloat(num.value);
          if (n > 0) { const l = presetData.slice(); l[i] = { kind: "in", minutes: Math.round(n * +sel.value) }; savePresets(l); }
          render();
        };
        num.addEventListener("change", commit);
        sel.addEventListener("change", commit);
        li.append(num, sel);
      }
      const x = mk("button", "gcr-menu-x");
      x.title = RTime.t("remove");
      x.setAttribute("aria-label", RTime.t("remove"));
      x.appendChild(RTime.icon("close", 14));
      x.addEventListener("click", (e) => { e.stopPropagation(); savePresets(presetData.filter((_, j) => j !== i)); render(); });
      li.appendChild(x);
      body.appendChild(li);
    });
    const full = presetData.length >= RTime.MAX_PRESETS;
    const addIn = mk("button", "gcr-menu-link", "+ " + RTime.t("opt_add_in"));
    const addTmr = mk("button", "gcr-menu-link", "+ " + RTime.t("opt_add_tmr"));
    addIn.disabled = addTmr.disabled = full;
    addIn.addEventListener("click", (e) => { e.stopPropagation(); savePresets([...presetData, { kind: "in", minutes: 30 }]); render(); });
    addTmr.addEventListener("click", (e) => { e.stopPropagation(); savePresets([...presetData, { kind: "tomorrow", time: "09:00" }]); render(); });
    const reset = mk("button", "gcr-menu-link", RTime.t("opt_reset"));
    reset.addEventListener("click", (e) => { e.stopPropagation(); savePresets(RTime.DEFAULT_PRESETS); render(); });
    body.append(mk("div", "gcr-menu-sep"), addIn, addTmr, mk("div", "gcr-menu-sep"), reset);
    if (full) body.appendChild(mk("div", "gcr-menu-sub", RTime.t("opt_max", { n: RTime.MAX_PRESETS })));
  };

  const fit = menuFitter(anchor);

  const render = () => {
    body.replaceChildren();
    toggle.textContent = RTime.t(editing ? "done" : "edit");
    (editing ? renderEdit : renderList)();
    if (menu.isConnected) fit(false);
  };
  toggle.addEventListener("click", (e) => { e.stopPropagation(); editing = !editing; render(); });

  render();
  showMenu(fit);
}


// The toolbar sits inside the message bubble, so `color: inherit` picks up the bubble's text color (white on
// your own messages in light + compact mode). Copy the color Chat paints its own toolbar icons with instead.
function toolbarIconColor(anchor) {
  const svg = anchor.querySelector("svg");
  return svg ? getComputedStyle(svg).fill : getComputedStyle(anchor).color;
}

// Make the clock look like its neighbours: the site adapter can match the app's own buttons; by default only the
// icon colour is copied.
function styleInline(b, anchor) {
  if (GCRSite.styleInline) GCRSite.styleInline(b, anchor);
  else b.style.color = toolbarIconColor(anchor);
}

function injectInline(row) {
  const anchor = GCRSite.toolbarAnchor(row, lastTarget);
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
    styleInline(existing[0], anchor);
    return true;
  }
  const b = document.createElement("button");
  b.type = "button";
  b.className = "gcr-inline";
  styleInline(b, anchor);
  b.title = RTime.t("remind_title");
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

// The clock only ever lives in the app's own hover toolbar: if the toolbar can't be found, no clock is shown.
function showFor(row) {
  activeRow = row;
  // The toolbar may render a moment after the hover starts, so retry briefly.
  const tryInline = () => alive() && activeRow === row && injectInline(row);
  if (tryInline()) return;
  const now = Date.now();
  if (now - (row._gcrRetry || 0) > 1500) {
    row._gcrRetry = now;
    [80, 250, 600, 1200].forEach((ms) => setTimeout(tryInline, ms));
  }
}

let lastTarget = null;

function onMouseOver(e) {
  if (!alive()) return shutdown();
  if (!(e.target instanceof Element) || e.target.closest(".gcr-menu")) return;
  // Moving from the message onto its toolbar: keep the message we were on.
  if (e.target.closest(".gcr-inline") || GCRSite.isToolbar(e.target)) return;
  lastTarget = e.target;
  const row = GCRSite.rowOf(e.target);
  if (row) showFor(row);
}
function onDocClick(e) {
  if (menu && !(e.target instanceof Element && e.target.closest(".gcr-menu"))) closeMenu();
}
function onScroll(e) {
  if (menu && e && e.target instanceof Node && menu.contains(e.target)) return; // scrolling the menu itself
  closeMenu();
}
document.addEventListener("mouseover", onMouseOver, { passive: true });
document.addEventListener("click", onDocClick);
document.addEventListener("scroll", onScroll, { capture: true, passive: true });

// "Reminder set for ..." label above each message that has an active reminder.
// The apps re-render messages as you scroll, so labels are re-applied on DOM changes, on storage changes, and
// every minute (to turn "set for" into "due" when the time passes).
let labels = {};
let labelPending = false;

function makeLabel() {
  const el = document.createElement("div");
  el.className = "gcr-label";
  const text = document.createElement("span");
  const view = document.createElement("button");
  view.type = "button";
  view.textContent = RTime.t("view_reminders");
  view.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!alive()) return shutdown();
    launcherEl ? launcherEl.click() : chrome.runtime.sendMessage({ type: "popup" });
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "gcr-label-remove";
  remove.textContent = RTime.t("remove");
  remove.title = RTime.t("remove_title");
  remove.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!alive()) return shutdown();
    const ids = el._gcrIds || [];
    el.remove();
    try { await Promise.all(ids.map((id) => send({ type: "delete", id }))); toast(RTime.t("toast_removed")); } catch (_) { toast(RTime.t("toast_remove_fail")); }
  });
  el.append(RTime.icon("clock", 14), text, document.createTextNode("·"), view, document.createTextNode("·"), remove);
  return el;
}


function renderLabels() {
  labelPending = false;
  if (!alive()) return shutdown();
  // Drop labels whose reminder is gone, and ones on rows the app has since reused for another message.
  document.querySelectorAll(".gcr-label").forEach((el) => {
    const row = el._gcrRow;
    if (!row || !row.isConnected || !labels[el._gcrKey] || GCRSite.rowKey(row) !== el._gcrKey) el.remove();
  });
  document.querySelectorAll("[data-gcr-reminder]").forEach((row) => {
    if (!labels[row._gcrKey] || GCRSite.rowKey(row) !== row._gcrKey) row.removeAttribute("data-gcr-reminder");
  });
  if (!Object.keys(labels).length) return;
  const dark = isDarkPage();
  for (const row of GCRSite.rows()) {
    const id = GCRSite.rowKey(row);
    const l = id && labels[id];
    if (!l) continue;
    const host = GCRSite.labelHost(row);
    let el = host.firstElementChild;
    if (!el || !el.classList.contains("gcr-label")) {
      host.prepend((el = makeLabel()));
      if (GCRSite.labelClass) el.classList.add(GCRSite.labelClass);
    }
    el._gcrRow = row;
    el._gcrKey = row._gcrKey = id;
    // Only touch the DOM when something changed: our own writes would otherwise re-trigger the observer forever.
    const span = el.querySelector("span");
    el._gcrIds = l.ids;
    if (span.textContent !== l.text) span.textContent = l.text;
    if (el.classList.contains("gcr-label-due") !== l.overdue) el.classList.toggle("gcr-label-due", l.overdue);
    const end = !!(GCRSite.alignEnd && GCRSite.alignEnd(row));
    if (el.classList.contains("gcr-label-end") !== end) el.classList.toggle("gcr-label-end", end);
    // The row is the app's own element, so it's marked with an attribute: apps built with React (Slack) rewrite an
    // element's whole class list when it re-renders (e.g. on hover), which made added classes flicker. The theme is
    // part of the value rather than .gcr-dark (which also sets color-scheme).
    const mark = `${l.overdue ? "due" : "set"}${dark ? " dark" : ""}`;
    if (row.getAttribute("data-gcr-reminder") !== mark) row.setAttribute("data-gcr-reminder", mark);
    if (el.classList.contains("gcr-dark") !== dark) themed(el);
  }
}

function scheduleLabels() {
  if (labelPending) return;
  labelPending = true;
  setTimeout(renderLabels, 250);
}

function loadLabels() {
  if (!alive()) return shutdown();
  chrome.storage.local.get("reminders").then((o) => {
    labels = RTime.reminderLabels(o.reminders, Date.now(), undefined, GCRSite.id);
    scheduleLabels();
  }).catch(() => {});
}

const loadPresetList = () => alive() && chrome.storage.local.get("presets").then((o) => { presetData = RTime.sanitizePresets(o.presets); presets = RTime.buildPresets(presetData); }).catch(() => {});
loadPresetList();
chrome.storage.onChanged.addListener((_c, area) => area === "local" && loadPresetList());

loadLabels();
chrome.storage.onChanged.addListener((_c, area) => area === "local" && loadLabels());
labelTick = setInterval(loadLabels, 60 * 1000);
labelObserver = new MutationObserver(() => Object.keys(labels).length && scheduleLabels());
labelObserver.observe(document.body, { childList: true, subtree: true });

// The background asks us to open a message link the way the app's own links work: clicking a real <a> lets the app's
// router handle it in-app (no page reload). In Chat, if it doesn't intercept it, the browser follows it normally.
// Slack and Teams only intercept links inside message content, so there the link is clicked from inside a message
// (GCRSite.linkHosts). Whether the app took it shows in defaultPrevented once the click has bubbled up to window; if
// none did, the click is cancelled here and the background reloads the tab with the link instead.
function clickLink(url, host, detect) {
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  host.appendChild(a);
  let handled = true;
  const check = (e) => {
    if (e.target !== a) return;
    handled = e.defaultPrevented;
    e.preventDefault();
  };
  if (detect) window.addEventListener("click", check);
  try {
    a.click();
  } finally {
    window.removeEventListener("click", check);
    a.remove();
  }
  return handled;
}

function followInApp(url) {
  // Chat follows links clicked anywhere. A site that only offers locate (Teams) can't follow ours at all: report it,
  // so the background reloads with its web address instead of letting the browser load the link.
  if (!GCRSite.linkHosts) return GCRSite.locate ? false : clickLink(url, document.body, false);
  return [...GCRSite.linkHosts()].slice(0, 5).some((host) => clickLink(url, host, true));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findRow = (key) => (key ? [...GCRSite.rows()].find((r) => GCRSite.rowKey(r) === key) : null);
// Poll briefly for something the app renders after a click (up to 3 s).
async function waitFor(fn) {
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const v = fn();
    if (v) return v;
  }
  return null;
}

function flash(row) {
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.setAttribute("data-gcr-flash", "");
  setTimeout(() => row.removeAttribute("data-gcr-flash"), 2000);
  return true;
}

// Scroll to the reminded message if it's on the page, and flash it. A thread reply that isn't shown: open its
// thread from the parent post (GCRSite.openThread) and go to the reply, or else to the parent post.
async function revealMessage(target, trace = []) {
  const row = findRow(target.key);
  if (row) { trace.push("message on page: scrolled to it"); return flash(row); }
  const parent = findRow(target.parentKey);
  if (!parent) { trace.push(`message not on page${target.parentKey ? ", parent post not on page either" : " (no parent post)"}`); return false; }
  const opened = !!(GCRSite.openThread && GCRSite.openThread(parent));
  trace.push(`parent post on page; replies button ${opened ? "clicked" : "not found"}`);
  if (opened) {
    const reply = await waitFor(() => findRow(target.key));
    trace.push(reply ? "reply appeared: scrolled to it" : "reply didn't appear within 3 s: stopped at the parent post");
    if (reply) return flash(reply);
  }
  return flash(parent);
}

// Go to a message without reloading, using only what a person would click: if it's already on screen, scroll to it;
// else click its conversation in the app's own list (the app switches in place) and wait for the message to render.
// Then, where the app follows links clicked inside messages, that. False when all of that fails: the background
// then reloads the tab with the link.
async function goToMessage(url, trace = []) {
  const target = GCRSite.locate && GCRSite.locate(url);
  trace.push(target ? `target ${JSON.stringify(target)}` : "link not recognised");
  if (target) {
    if (await revealMessage(target, trace)) return true;
    const entry = GCRSite.conversationEntry && GCRSite.conversationEntry(target);
    trace.push(`conversation in the list: ${entry ? "found, clicked" : "not found"}`);
    if (entry) {
      entry.click();
      // Wait for the message (or the thread's parent post) to render, then reveal it.
      if (await waitFor(() => findRow(target.key) || findRow(target.parentKey))) return revealMessage(target, trace);
      trace.push("after switching: neither the message nor its parent post appeared within 3 s");
    }
  }
  const ok = followInApp(url);
  trace.push(ok ? "followed the link in the app" : "app didn't take the link: background reloads the tab");
  return ok;
}

if (window.top === window) {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || msg.type !== "gcr-navigate" || !alive()) return false;
    // Each step is kept (Shift+click a reminder in the panel copies it) to debug reminders that don't land.
    const trace = [];
    const done = async (ok) => {
      trace.push(`message rows on page now: ${GCRSite.rows().length}`);
      await chrome.storage.local.set({ lastNav: { at: new Date().toISOString(), id: msg.id, url: msg.url, ok, trace } }).catch(() => {});
      reply({ ok });
    };
    goToMessage(msg.url, trace).then(done, (e) => { trace.push(`error: ${e}`); done(false); });
    return true; // async reply
  });
}

// Launcher: small button (top frame only) that opens the reminders overview, with a count of active reminders.
if (window.top === window) {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "gcr-launcher";
  launcher.title = RTime.t("launcher_title");
  const icon = document.createElement("span");
  icon.className = "gcr-icon";
  icon.appendChild(RTime.icon("clock", 22));
  const badge = document.createElement("span");
  launcher.append(icon, badge);
  themed(launcher);
  launcherEl = launcher;
  launcher.addEventListener("click", () => (alive() ? togglePanel() : shutdown()));
  launcher.addEventListener("mouseenter", () => themed(launcher));
  document.body.appendChild(launcher);

  // In-page reminders panel (rounded, themed, anchored under the launcher). Rendered by the page, so unlike the
  // toolbar popup its corners can be styled.
  const call = (msg) => chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || !r.ok) throw new Error((r && r.error) || "no response");
    return r.data;
  });
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  let panel = null;
  const closePanel = () => {
    if (!panel) return;
    closeMenu();
    const p = panel;
    panel = panelEl = null;
    p.classList.remove("gcr-open");
    setTimeout(() => p.remove(), 180);
    document.removeEventListener("pointerdown", onPanelOutside, true);
    document.removeEventListener("keydown", onPanelKey, true);
  };
  // The snooze dropdown lives outside the panel (so the list can't clip it); clicks in it keep the panel open.
  const onPanelOutside = (e) => { if (panel && !panel.contains(e.target) && !launcher.contains(e.target) && !(menu && menu.contains(e.target))) closePanel(); };
  const onPanelKey = (e) => { if (e.key !== "Escape") return; if (menu) closeMenu(); else closePanel(); };

  const renderPanel = async () => {
    if (!panel || !alive()) return;
    let items;
    let filter;
    try { items = (await call({ type: "list" })).filter((r) => !r.done).sort(RTime.byWhen); filter = await RTime.loadFilter(); } catch (_) { return; }
    if (!panel) return;
    const now = Date.now();
    const bar = panel.querySelector(".gcr-p-filter");
    bar.replaceChildren(RTime.createFilterBar(filter, (key) => RTime.saveFilter(key).catch(() => {}), items));
    bar.hidden = !items.length;
    const list = panel.querySelector(".gcr-p-list");
    list.replaceChildren();
    panel.querySelector(".gcr-p-empty").style.display = items.length ? "none" : "block";
    items = items.filter((r) => RTime.matchesFilter(r, filter));
    for (const r of items) {
      const row = el("li", "gcr-p-row");
      row.title = RTime.t("open_msg");
      row.addEventListener("click", async (e) => {
        if (e.shiftKey) {
          // Debug: copy the reminder as saved plus the steps of the last attempt to open a reminder.
          const { lastNav } = await chrome.storage.local.get("lastNav").catch(() => ({}));
          const info = { reminder: r, lastNav: lastNav && lastNav.id === r.id ? lastNav : null, lastNavOther: lastNav && lastNav.id !== r.id ? lastNav : null };
          navigator.clipboard.writeText(JSON.stringify(info, null, 2)).then(() => toast("Debug info copied to clipboard"), () => toast("Couldn't copy debug info"));
          return;
        }
        call({ type: "open", id: r.id }).catch(() => {});
        closePanel();
      });
      const check = el("input", "gcr-p-check");
      check.type = "checkbox";
      check.title = RTime.t("mark_done");
      check.setAttribute("aria-label", RTime.t("mark_done"));
      check.addEventListener("click", async (e) => { e.stopPropagation(); await call({ type: "complete", id: r.id }).catch(() => {}); renderPanel(); });
      const body = el("div", "gcr-p-body");
      if (r.sender) body.append(el("div", "gcr-p-from", r.sender));
      body.append(el("div", "gcr-p-text", r.text));
      const meta = el("div", "gcr-p-meta");
      const site = RTime.SITES[RTime.siteOf(r)];
      const chip = el("span", "gcr-p-site", site.short);
      chip.style.setProperty("--gcr-site", site.color);
      meta.append(chip);
      if (RTime.isTodo(r)) meta.append(el("span", "gcr-p-todopill", RTime.t("todo")));
      else {
        if (RTime.isDue(r, now)) meta.append(el("span", "gcr-p-duepill", RTime.t("due")));
        meta.append(el("span", null, RTime.formatWhen(r.when)));
      }
      body.append(meta);
      const actions = el("div", "gcr-p-actions");
      const todo = RTime.isTodo(r);
      const snooze = el("button", "gcr-p-snooze", RTime.t(todo ? "set_reminder" : "snooze"));
      snooze.type = "button";
      snooze.setAttribute("aria-haspopup", "menu");
      snooze.appendChild(RTime.icon("caret", 14));
      snooze.addEventListener("click", (e) => {
        e.stopPropagation();
        if (menu && menu.anchor === snooze) return closeMenu();
        openSnoozeMenu(snooze, async (when) => {
          await call(when == null ? { type: "todo", id: r.id } : { type: "snooze", id: r.id, when }).catch(() => {});
          renderPanel();
        }, todo);
        menu.anchor = snooze;
      });
      const del = el("button", "gcr-p-del");
      del.type = "button";
      del.title = RTime.t("del");
      del.setAttribute("aria-label", RTime.t("del"));
      del.appendChild(RTime.icon("close", 16));
      del.addEventListener("click", async (e) => { e.stopPropagation(); await call({ type: "delete", id: r.id }).catch(() => {}); renderPanel(); });
      actions.append(snooze, del);
      row.append(check, body, actions);
      list.appendChild(row);
    }
  };

  const openPanel = () => {
    panel = panelEl = themed(el("div", "gcr-panel"));
    chatTheme(panel);
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", RTime.t("reminders"));
    const head = el("div", "gcr-p-head");
    const titles = el("div");
    titles.append(el("div", "gcr-p-title", RTime.t("reminders")));
    const all = el("button", "gcr-p-all", RTime.t("view_all"));
    all.type = "button";
    all.addEventListener("click", () => { call({ type: "overview" }).catch(() => {}); closePanel(); });
    head.append(titles, all);
    const empty = el("div", "gcr-p-empty");
    empty.append(el("b", null, RTime.t("caught_up")), el("span", null, RTime.t("empty_hint")));
    const note = el("div", "gcr-p-update");
    note.hidden = true;
    call({ type: "updateInfo" }).then((u) => {
      if (!u || !panel) return;
      note.textContent = RTime.t("banner", { version: u.version });
      note.hidden = false;
      note.style.cursor = "pointer";
      note.addEventListener("click", () => { call({ type: "openUpdate" }).catch(() => {}); closePanel(); });
    }).catch(() => {});
    panel.append(head, note, el("div", "gcr-p-filter"), el("ul", "gcr-p-list"), empty);
    const r = launcher.getBoundingClientRect();
    const w = Math.min(420, innerWidth - 24);
    panel.style.width = `${w}px`;
    if (launcher.classList.contains("gcr-edge")) {
      // Launcher on the right edge: open to its left, roughly centred on it.
      const maxH = Math.min(560, innerHeight - 24);
      panel.style.left = `${Math.max(12, Math.round(r.left - w - 8))}px`;
      panel.style.top = `${Math.round(Math.max(12, Math.min(r.top + r.height / 2 - maxH / 2, innerHeight - maxH - 12)))}px`;
      panel.style.maxHeight = `${maxH}px`;
      panel.style.transformOrigin = "right center";
    } else {
      panel.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
      panel.style.top = `${Math.round(r.bottom + 8)}px`;
      panel.style.maxHeight = `${Math.max(200, innerHeight - r.bottom - 24)}px`;
      panel.style.transformOrigin = `${Math.round(r.left + r.width / 2 - parseFloat(panel.style.left))}px top`;
    }
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel && panel.classList.add("gcr-open"));
    document.addEventListener("pointerdown", onPanelOutside, true);
    document.addEventListener("keydown", onPanelKey, true);
    renderPanel();
  };
  const togglePanel = () => (panel ? closePanel() : openPanel());
  chrome.storage.onChanged.addListener((_c, area) => area === "local" && renderPanel());

  // Red + count of due ones when something is due; otherwise the count of open reminders and todos, unhighlighted.
  const refresh = () => {
    if (!alive()) return shutdown();
    return chrome.storage.local.get("reminders").then((o) => {
      const now = Date.now();
      const open = Object.values(o.reminders || {}).filter((r) => !r.done);
      const due = open.filter((r) => RTime.isDue(r, now)).length;
      badge.textContent = due ? String(due) : open.length ? String(open.length) : "";
      launcher.classList.toggle("gcr-due", due > 0);
      launcher.title = due ? RTime.t(due > 1 ? "launcher_due_other" : "launcher_due_one", { n: due }) : RTime.t("launcher_title");
    }).catch(() => {});
  };
  chrome.storage.onChanged.addListener((_c, area) => area === "local" && refresh());

  // The app's popups (e.g. Chat's New chat panel) must cover the button. Stacking order alone wasn't enough, so hide the
  // button while something popup-like is the topmost element at its centre. pointer-events:none makes the
  // launcher invisible to elementsFromPoint, so we see what is really underneath.
  const POPUP = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [aria-modal='true']";
  const coveredByPopup = () => {
    const r = launcher.getBoundingClientRect();
    if (!r.width) return false;
    launcher.style.pointerEvents = "none";
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    launcher.style.pointerEvents = "";
    for (let el = top, i = 0; el && el !== document.body && i < 14; el = el.parentElement, i++) {
      if (el.matches(POPUP)) return true;
      const cs = getComputedStyle(el);
      if ((cs.position === "fixed" || cs.position === "absolute") && parseInt(cs.zIndex, 10) >= 1000) return true;
    }
    return false;
  };
  const syncCover = () => {
    if (!alive()) return shutdown();
    launcher.style.visibility = coveredByPopup() ? "hidden" : "";
  };
  // The site adapter knows a good spot (Chat: next to "New chat"); otherwise the launcher is a small tab on the
  // right edge of the window, where it doesn't cover the app's header or message box.
  if (!GCRSite.placeLauncher) launcher.classList.add("gcr-edge");
  const place = () => {
    if (!alive()) return shutdown();
    themed(launcher);
    refresh();
    if (GCRSite.placeLauncher) GCRSite.placeLauncher(launcher);
  };
  place();
  syncCover();
  addEventListener("resize", place);
  document.addEventListener("click", () => setTimeout(syncCover, 120), true);
  document.addEventListener("keyup", () => setTimeout(syncCover, 120), true);
  setInterval(syncCover, 500);
  placeTimer = setInterval(place, 3000); // header renders late; also keeps the due state current as time passes
}
