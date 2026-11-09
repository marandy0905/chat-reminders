const assert = require("assert");
const T = require("../time.js");
T.setLang("en");

const now = new Date(2026, 9, 27, 15, 30).getTime();
assert.strictEqual(T.tomorrowAt(now, 10), new Date(2026, 9, 28, 10, 0).getTime());
assert.strictEqual(T.tomorrowAt(new Date(2026, 9, 31, 23, 0).getTime(), 10), new Date(2026, 10, 1, 10, 0).getTime());
const defaults = T.buildPresets();
assert.strictEqual(defaults[0].at(now), now + 20 * 60e3);
assert.deepStrictEqual(defaults.map((p) => p.label), ["In 20 minutes", "In 1 hour", "In 2 hours", "In 3 hours", "Tomorrow 10:00"]);
assert.strictEqual(defaults[2].at(now), now + 120 * 60e3);
assert.strictEqual(defaults[4].at(now), T.tomorrowAt(now, 10));
// Custom options: labels, tomorrow with minutes, sorting, clamping, junk dropped, cap.
const custom = T.buildPresets([{ kind: "tomorrow", time: "08:30" }, { kind: "in", minutes: 1440 }, { kind: "in", minutes: 5 }, { kind: "in", minutes: 90 }, { kind: "in", minutes: "x" }, { kind: "tomorrow", time: "25:00" }, null]);
assert.deepStrictEqual(custom.map((p) => p.label), ["In 5 minutes", "In 90 minutes", "In 1 day", "Tomorrow 08:30"]);
assert.strictEqual(custom[3].at(now), T.tomorrowAt(now, 8, 30));
assert.strictEqual(T.tomorrowAt(now, 8, 30), new Date(2026, 9, 28, 8, 30).getTime());
assert.deepStrictEqual(T.sanitizePresets([{ kind: "in", minutes: 0 }, { kind: "in", minutes: 9e9 }]), [{ kind: "in", minutes: 1 }, { kind: "in", minutes: 43200 }]);
assert.deepStrictEqual(T.sanitizePresets([]), []);
assert.deepStrictEqual(T.sanitizePresets(undefined), T.DEFAULT_PRESETS);
assert.strictEqual(T.sanitizePresets(Array.from({ length: 20 }, (_, i) => ({ kind: "in", minutes: i + 1 }))).length, T.MAX_PRESETS);
assert.strictEqual(T.parseLocalInput("2026-10-27T15:30"), now);
assert.ok(Number.isNaN(T.parseLocalInput("")));
assert.strictEqual(T.parseLocalInput(T.toLocalInput(now)), now);

// Fixed, locale-independent date format: "YYYY/MM/DD HH:mm" (24-hour).
assert.strictEqual(T.formatWhen(new Date(2026, 9, 28, 18, 15).getTime()), "2026/10/28 18:15");
assert.strictEqual(T.formatWhen(new Date(2026, 0, 5, 9, 5).getTime()), "2026/01/05 09:05");
assert.strictEqual(T.formatTime(new Date(2000, 0, 1, 0, 18 * 60 + 15).getTime()), "18:15");

// Message id from a reminder's saved link (content.js permalink(): /room/<space>/<topic>/<message>?cls=10).
assert.strictEqual(T.messageIdOf("https://chat.google.com/room/sJEKDqAAAAE/ZWfffvkSQ38/ZWfffvkSQ38?cls=10"), "ZWfffvkSQ38");
assert.strictEqual(T.messageIdOf("https://chat.google.com/room/AAAAxyz123/topicId1234/msgId56789"), "msgId56789");
assert.strictEqual(T.messageIdOf("https://chat.google.com/app/chat/sJEKDqAAAAE"), "");
assert.strictEqual(T.messageIdOf(undefined), "");

// Labels shown on messages: one per message, nearest active reminder, done ones ignored.
const link = (msg) => `https://chat.google.com/room/sJEKDqAAAAE/topic123456/${msg}?cls=10`;
const fmt = (ms) => `@${ms}`;
const labels = T.reminderLabels(
  {
    a: { when: now + 60e3, url: link("msgAAAAAAAA") },
    b: { when: now + 30e3, url: link("msgAAAAAAAA") },
    c: { when: now - 60e3, url: link("msgBBBBBBBB") },
    d: { when: now + 60e3, url: link("msgCCCCCCCC"), done: now },
    e: { when: now + 60e3, url: "https://chat.google.com/app/chat/sJEKDqAAAAE" },
  },
  now,
  fmt
);
assert.deepStrictEqual(labels, {
  msgAAAAAAAA: { text: `Reminder set for @${now + 30e3}`, overdue: false, ids: ["a", "b"] },
  msgBBBBBBBB: { text: `Reminder due @${now - 60e3}`, overdue: true, ids: ["c"] },
});
assert.deepStrictEqual(T.reminderLabels({}, now, fmt), {});

// Sites: old reminders (no site) are Chat; labels only cover the asked site and prefer the stored key.
assert.strictEqual(T.siteOf({}), "gchat");
assert.strictEqual(T.siteOf({ site: "slack" }), "slack");
assert.strictEqual(T.siteOf({ site: "toString" }), "gchat");
const mixed = {
  a: { when: now + 60e3, url: link("msgAAAAAAAA") },
  s: { when: now + 60e3, site: "slack", key: "1700000000.123456", url: "https://x.slack.com/archives/C1/p1700000000123456" },
  t: { when: now - 60e3, site: "teams", key: "1700000000000", url: "https://teams.microsoft.com/v2/" },
};
assert.deepStrictEqual(Object.keys(T.reminderLabels(mixed, now, fmt)), ["msgAAAAAAAA"]);
assert.deepStrictEqual(T.reminderLabels(mixed, now, fmt, "slack"), {
  "1700000000.123456": { text: `Reminder set for @${now + 60e3}`, overdue: false, ids: ["s"] },
});
assert.strictEqual(T.reminderLabels(mixed, now, fmt, "teams")["1700000000000"].overdue, true);
assert.ok(T.SITES.slack.hosts.test("acme.slack.com") && !T.SITES.slack.hosts.test("slack.com.evil.io"));
assert.ok(T.SITES.teams.hosts.test("teams.cloud.microsoft"));
// Reloading Teams with a /l/ link goes through the web app's /_#/l/ route, not the desktop-app launcher.
assert.strictEqual(
  T.webUrl({ site: "teams", url: "https://teams.cloud.microsoft/l/message/19:a@thread.tacv2/17?tenantId=t&createdTime=17" }),
  "https://teams.cloud.microsoft/_#/l/message/19:a@thread.tacv2/17?tenantId=t&createdTime=17"
);
assert.strictEqual(T.webUrl({ site: "teams", url: "https://teams.cloud.microsoft/v2/" }), "https://teams.cloud.microsoft/v2/");
assert.strictEqual(T.webUrl({ site: "slack", url: "https://x.slack.com/archives/C1/p1?thread_ts=1.2" }), "https://x.slack.com/messages/C1/p1?thread_ts=1.2");
assert.strictEqual(T.webUrl({ site: "slack", url: "https://app.slack.com/client/T1/C1" }), "https://app.slack.com/client/T1/C1");
assert.strictEqual(T.webUrl({ url: "https://chat.google.com/room/a/b/c" }), "https://chat.google.com/room/a/b/c");
// Todos: reminders without a time. Never due, listed after timed ones (oldest first), labelled "On your todo list".
{
  const todo = { id: "t", when: null, created: 2 };
  assert.strictEqual(T.isTodo(todo), true);
  assert.strictEqual(T.isTodo({ when: now }), false);
  assert.strictEqual(T.isDue(todo, now), false);
  assert.strictEqual(T.isDue({ when: now - 1 }, now), true);
  assert.strictEqual(T.isDue({ when: now - 1, done: now }, now), false);
  assert.strictEqual(T.isDue({ when: now + 1 }, now), false);
  const sorted = [todo, { id: "late", when: now + 2 }, { id: "old", when: null, created: 1 }, { id: "soon", when: now + 1 }].sort(T.byWhen);
  assert.deepStrictEqual(sorted.map((r) => r.id), ["soon", "late", "old", "t"]);
  assert.deepStrictEqual(T.reminderLabels({ t: { ...todo, url: link("msgTTTTTTTT") } }, now, fmt), {
    msgTTTTTTTT: { text: "On your todo list", overdue: false, ids: ["t"] },
  });
  // List filters: all, only reminders with a time, only todos. Unknown keys show everything.
  assert.deepStrictEqual(T.LIST_FILTERS, ["all", "timed", "todo"]);
  assert.deepStrictEqual(sorted.filter((r) => T.matchesFilter(r, "timed")).map((r) => r.id), ["soon", "late"]);
  assert.deepStrictEqual(sorted.filter((r) => T.matchesFilter(r, "todo")).map((r) => r.id), ["old", "t"]);
  assert.strictEqual(sorted.filter((r) => T.matchesFilter(r, "all")).length, 4);
  assert.strictEqual(sorted.filter((r) => T.matchesFilter(r, "junk")).length, 4);
  // A timed reminder on the same message wins over the todo.
  assert.strictEqual(T.reminderLabels({ t: { ...todo, url: link("msgTTTTTTTT") }, u: { id: "u", when: now + 60e3, url: link("msgTTTTTTTT") } }, now, fmt).msgTTTTTTTT.text, `Reminder set for @${now + 60e3}`);
}
assert.ok(T.compareVersions("1.10.0", "1.9.2") > 0);
assert.ok(T.compareVersions("1.0.0", "1.0.1") < 0);
assert.strictEqual(T.compareVersions("1.0", "1.0.0"), 0);
// One active reminder per message: ids of the active reminders already set on the same message.
{
  const reminders = {
    a: { id: "a", when: 2, url: link("msgAAAAAAAA") },
    b: { id: "b", when: 1, url: link("msgAAAAAAAA") },
    c: { id: "c", when: 1, url: link("msgAAAAAAAA"), done: 5 },
    d: { id: "d", when: 1, url: link("msgBBBBBBBB") },
  };
  assert.deepStrictEqual(T.activeForMessage(reminders, { url: link("msgAAAAAAAA") }), ["b", "a"]);
  assert.deepStrictEqual(T.activeForMessage(reminders, { url: link("msgCCCCCCCC") }), []);
  // Todos count too: a reminder and a todo on the same message replace each other. Timed ones come first.
  const withTodo = { ...reminders, t: { id: "t", when: null, url: link("msgCCCCCCCC") }, u: { id: "u", when: 3, url: link("msgCCCCCCCC") } };
  assert.deepStrictEqual(T.activeForMessage(withTodo, { url: link("msgCCCCCCCC") }), ["u", "t"]);
  // Reactivating a completed one: the other active ones on its message are what it replaces.
  const back = { ...withTodo, c: { ...withTodo.c } };
  assert.deepStrictEqual(T.othersForMessage(back, "c"), ["b", "a"]);
  assert.deepStrictEqual(T.othersForMessage(back, "u"), ["t"]);
  assert.deepStrictEqual(T.othersForMessage(back, "missing"), []);
  // Reminders without a message id (space/DM links, manual ones) are never merged.
  assert.deepStrictEqual(T.activeForMessage(reminders, { url: "https://chat.google.com/app/chat/sJEKDqAAAAE" }), []);
  assert.deepStrictEqual(T.activeForMessage(reminders, undefined), []);
  // Slack/Teams match on the stored key within their own site, never across sites.
  const slack = { s: { id: "s", when: 1, site: "slack", key: "C1/1700.1", url: "https://x.slack.com/archives/C1/p1" } };
  assert.deepStrictEqual(T.activeForMessage(slack, { site: "slack", key: "C1/1700.1" }), ["s"]);
  assert.deepStrictEqual(T.activeForMessage(slack, { site: "teams", key: "C1/1700.1" }), []);
}
console.log("ok");
