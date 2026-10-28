// Shared time helpers (content script, popup, service worker, node tests).
(function (root) {
  const MIN = 60 * 1000;

  // Presets used by the hover menu and popup chips. Each returns an epoch ms.
  const PRESETS = [
    { label: "In 20 minutes", at: (now) => now + 20 * MIN },
    { label: "In 1 hour", at: (now) => now + 60 * MIN },
    { label: "In 2 hours", at: (now) => now + 120 * MIN },
    { label: "In 3 hours", at: (now) => now + 180 * MIN },
    { label: "Tomorrow 10:00", at: (now) => tomorrowAt(now, 10) },
  ];

  function tomorrowAt(now, hour) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }

  // <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm", local) -> epoch ms, or NaN.
  function parseLocalInput(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }

  function toLocalInput(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Fixed format regardless of browser locale: "2026/10/28 18:15".
  const pad = (n) => String(n).padStart(2, "0");
  function formatTime(ms) {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function formatWhen(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${formatTime(ms)}`;
  }

  // Chat message id from a reminder's saved link (/room/<space>/<topic>/<message>), or "" for a space/DM link.
  function messageIdOf(url) {
    const m = /\/room\/[^/]+\/[^/]+\/([A-Za-z0-9_-]{8,16})(?:[?#]|$)/.exec(url || "");
    return m ? m[1] : "";
  }

  // Labels for messages with an active reminder: { messageId: { text, overdue } }, nearest reminder per message.
  function reminderLabels(reminders, now, fmt = formatWhen) {
    const nearest = {};
    const ids = {};
    for (const [key, r] of Object.entries(reminders || {})) {
      const id = !r.done && messageIdOf(r.url);
      if (!id) continue;
      (ids[id] = ids[id] || []).push(r.id || key);
      if (!nearest[id] || r.when < nearest[id].when) nearest[id] = r;
    }
    const out = {};
    for (const [id, r] of Object.entries(nearest)) {
      const overdue = r.when <= now;
      out[id] = { text: `${overdue ? "Reminder due" : "Reminder set for"} ${fmt(r.when)}`, overdue, ids: ids[id] };
    }
    return out;
  }

  const QUARTER = 15 * MIN;
  const ceilQuarter = (ms) => Math.ceil(ms / QUARTER) * QUARTER;

  // Slack-style picker: a date field plus a dropdown of 15-minute slots.
  // Returns { el, get() -> epoch ms | NaN, set(ms) }.
  function createPicker(initialMs) {
    const el = document.createElement("div");
    el.className = "rt-picker";
    const date = document.createElement("input");
    date.type = "date";
    const time = document.createElement("select");
    for (let m = 0; m < 24 * 60; m += 15) {
      const o = document.createElement("option");
      o.value = String(m);
      o.textContent = formatTime(new Date(2000, 0, 1, 0, m).getTime());
      time.appendChild(o);
    }
    el.append(date, time);
    const set = (ms) => {
      const d = new Date(ceilQuarter(ms));
      date.value = toLocalInput(d.getTime()).slice(0, 10);
      time.value = String(d.getHours() * 60 + d.getMinutes());
    };
    const get = () => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.value);
      if (!m) return NaN;
      return new Date(+m[1], +m[2] - 1, +m[3], 0, +time.value).getTime();
    };
    set(initialMs);
    return { el, get, set };
  }

  // Inline SVG icons (Material-style paths, filled with currentColor) so no emoji is needed anywhere.
  const ICONS = {
    clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
    check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
    close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    caret: "M7 10l5 5 5-5z",
  };
  function icon(name, size) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 18));
    svg.setAttribute("height", String(size || 18));
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "display:block;flex:none;pointer-events:none";
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", ICONS[name]);
    svg.appendChild(p);
    return svg;
  }

  root.RTime = { icon, PRESETS, tomorrowAt, parseLocalInput, toLocalInput, formatWhen, formatTime, messageIdOf, reminderLabels, ceilQuarter, createPicker };
  if (typeof module !== "undefined") module.exports = root.RTime;
})(typeof globalThis !== "undefined" ? globalThis : this);
