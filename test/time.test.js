const assert = require("assert");
const T = require("../time.js");

const now = new Date(2026, 9, 27, 15, 30).getTime();
assert.strictEqual(T.tomorrowAt(now, 10), new Date(2026, 9, 28, 10, 0).getTime());
assert.strictEqual(T.tomorrowAt(new Date(2026, 9, 31, 23, 0).getTime(), 10), new Date(2026, 10, 1, 10, 0).getTime());
assert.strictEqual(T.PRESETS[0].at(now), now + 20 * 60e3);
assert.deepStrictEqual(T.PRESETS.map((p) => p.label), ["In 20 minutes", "In 1 hour", "In 2 hours", "In 3 hours", "Tomorrow 10:00"]);
assert.strictEqual(T.PRESETS[2].at(now), now + 120 * 60e3);
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
assert.ok(T.compareVersions("1.10.0", "1.9.2") > 0);
assert.ok(T.compareVersions("1.0.0", "1.0.1") < 0);
assert.strictEqual(T.compareVersions("1.0", "1.0.0"), 0);
console.log("ok");
