importScripts("time.js");

const KEY = "reminders";
const SNOOZE_MS = 20 * 60 * 1000;
const FALLBACK_URL = "https://chat.google.com/";

async function load() {
  const o = await chrome.storage.local.get(KEY);
  return o[KEY] || {};
}
const save = (r) => chrome.storage.local.set({ [KEY]: r });

function schedule(r) {
  // Past-due times fire almost immediately.
  chrome.alarms.create(r.id, { when: Math.max(r.when, Date.now() + 1000) });
}

async function add({ text, sender, when, url, source }) {
  const r = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text: String(text || "Reminder").slice(0, 500),
    sender: String(sender || "").slice(0, 100),
    when,
    url: url || FALLBACK_URL,
    source: source || "manual",
  };
  const all = await load();
  all[r.id] = r;
  await save(all);
  schedule(r);
  return r;
}

async function remove(id) {
  const all = await load();
  delete all[id];
  await save(all);
  await chrome.alarms.clear(id);
  await chrome.notifications.clear(id);
}

// Move a reminder to a new time (also reactivates a completed one). Pass `when` (epoch ms) or `ms` (from now).
async function snooze(id, { when, ms } = {}) {
  const all = await load();
  if (!all[id]) return;
  all[id].when = Number.isFinite(when) ? when : Date.now() + (ms || SNOOZE_MS);
  delete all[id].done;
  await save(all);
  schedule(all[id]);
  await chrome.notifications.clear(id);
}

// Mark done: kept in the overview under "Completed" until deleted.
async function complete(id) {
  const all = await load();
  if (!all[id]) return;
  all[id].done = Date.now();
  await save(all);
  await chrome.alarms.clear(id);
  await chrome.notifications.clear(id);
}

async function list() {
  return Object.values(await load()).sort((a, b) => a.when - b.when);
}

async function resync() {
  const all = await load();
  const alarms = new Set((await chrome.alarms.getAll()).map((a) => a.name));
  Object.values(all).forEach((r) => r.done || alarms.has(r.id) || schedule(r));
}

chrome.runtime.onInstalled.addListener(resync);
chrome.runtime.onStartup.addListener(resync);

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  const r = (await load())[name];
  if (!r || r.done) return;
  chrome.notifications.create(r.id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Reminder",
    message: r.text,
    contextMessage: "Google Chat",
    requireInteraction: true,
    buttons: [{ title: "Snooze 20 min" }, { title: "Mark as done" }],
  });
});

async function open(r) {
  // Only match Chat itself (never the Gmail app, which lives at mail.google.com/mail/ and can also be a PWA).
  const tabs = await chrome.tabs.query({ url: ["https://chat.google.com/*", "https://mail.google.com/chat/*"] });
  const wins = await Promise.all(tabs.map((t) => chrome.windows.get(t.windowId)));
  // Prefer an installed-PWA ("app") window on chat.google.com, then any chat.google.com tab.
  const rank = (i) => (new URL(tabs[i].url).hostname === "chat.google.com" ? 0 : 2) + (wins[i].type === "app" ? 0 : 1);
  const order = tabs.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  const i = order[0];
  if (i === undefined) return chrome.tabs.create({ url: r.url });

  const tab = tabs[i];
  const sameOrigin = new URL(r.url).origin === new URL(tab.url).origin;
  await chrome.windows.update(tab.windowId, { focused: true, state: wins[i].state === "minimized" ? "normal" : undefined });
  await chrome.tabs.update(tab.id, { active: true, ...(sameOrigin && r.url !== FALLBACK_URL ? { url: r.url } : {}) });
}

// Nothing here marks a reminder done except the explicit "Mark as done" button:
// clicking the notification only opens the chat, and dismissing it leaves the reminder Overdue.
chrome.notifications.onButtonClicked.addListener(async (id, idx) => {
  if (idx === 0) return snooze(id);
  return complete(id);
});

chrome.notifications.onClicked.addListener(async (id) => {
  const r = (await load())[id];
  if (r) await open(r);
  await chrome.notifications.clear(id);
});

async function openOverview() {
  const url = chrome.runtime.getURL("reminders.html");
  const [tab] = await chrome.tabs.query({ url });
  if (!tab) return chrome.tabs.create({ url });
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
}

// Open the toolbar popup (Chrome 127+); fall back to the overview page if that isn't possible.
const openPopup = () => chrome.action.openPopup().catch(() => openOverview());

chrome.commands.onCommand.addListener((c) => c === "open-overview" && openPopup());

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = {
    add: () => add(msg),
    list: () => list(),
    delete: () => remove(msg.id),
    snooze: () => snooze(msg.id, msg),
    complete: () => complete(msg.id),
    popup: () => openPopup(),
    overview: () => openOverview(),
    open: async () => { const r = (await load())[msg.id]; if (r) await open(r); },
  }[msg.type];
  if (!run) return false;
  run().then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: String(e) }));
  return true; // async reply
});
