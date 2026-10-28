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
console.log("ok");
