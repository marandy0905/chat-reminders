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

  // Picker: a date field plus a dropdown of 15-minute slots.
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

  // > 0 when version a is newer than b ("1.10.0" > "1.9.2"); non-numeric parts count as 0.
  function compareVersions(a, b) {
    const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // Wording for the update flow: Traditional Chinese when the browser/system language is, otherwise English.
  const STRINGS = {
    en: {
      page_title: "Update Chat Reminders",
      versions_new: "You have v{current}. v{latest} is available.",
      versions_none: "You have v{current}. No newer version found yet.",
      step1_title: "Allow updating",
      step1_desc: "Pick the folder this extension was loaded from. You only need to do this once.",
      btn_pick: "Choose folder",
      step2_title: "Update",
      step2_desc: "Downloads the latest version into that folder and reloads the extension.",
      btn_go: "Update now",
      manual_pre: "Prefer to do it by hand?",
      manual_link: "Download the zip",
      manual_post: "and unzip it over your folder.",
      wrong_folder: "That doesn't look like the Chat Reminders folder (no matching manifest.json). Pick the folder you loaded at chrome://extensions.",
      saved: "Folder saved.",
      folder_fail: "Couldn't use that folder: {msg}",
      perm_denied: "Folder access was not granted.",
      folder_changed: "The saved folder no longer looks like this extension's folder. Choose it again.",
      downloading: "Downloading…",
      dl_fail: "Download failed ({status}).",
      bad_zip: "The download doesn't look like a Chat Reminders release.",
      installing: "Installing…",
      done: "Updated. Reloading… refresh Google Chat afterwards.",
      banner: "Update available: v{version}. Click to update.",
      notif_title: "Chat Reminders update available",
      notif_msg: "Version {latest} is out (you have {current}). Click to update in one step.",
    },
    "zh-TW": {
      page_title: "更新 Chat Reminders",
      versions_new: "你目前是 v{current}，最新版本為 v{latest}。",
      versions_none: "你目前是 v{current}，尚未發現新版本。",
      step1_title: "允許更新",
      step1_desc: "選擇載入此擴充功能的資料夾。只需要做一次。",
      btn_pick: "選擇資料夾",
      step2_title: "更新",
      step2_desc: "把最新版本下載到該資料夾，並重新載入擴充功能。",
      btn_go: "立即更新",
      manual_pre: "想手動更新？",
      manual_link: "下載 zip",
      manual_post: "並解壓縮覆蓋原資料夾。",
      wrong_folder: "這看起來不是 Chat Reminders 資料夾（找不到相符的 manifest.json）。請選擇你在 chrome://extensions 載入的資料夾。",
      saved: "已儲存資料夾。",
      folder_fail: "無法使用該資料夾：{msg}",
      perm_denied: "未取得資料夾存取權。",
      folder_changed: "已儲存的資料夾看起來不再是此擴充功能的資料夾，請重新選擇。",
      downloading: "下載中…",
      dl_fail: "下載失敗（{status}）。",
      bad_zip: "下載的檔案看起來不是 Chat Reminders 的發行檔。",
      installing: "安裝中…",
      done: "更新完成，即將重新載入… 之後請重新整理 Google Chat。",
      banner: "有新版本 v{version}，點此更新。",
      notif_title: "Chat Reminders 有新版本",
      notif_msg: "新版本 {latest} 已發布（目前 {current}）。點選即可一鍵更新。",
    },
  };
  function lang() {
    let l = "en";
    try { l = chrome.i18n.getUILanguage(); } catch (_) { l = (typeof navigator !== "undefined" && navigator.language) || "en"; }
    return /^zh[-_](tw|hk|mo|hant)/i.test(l) ? "zh-TW" : "en";
  }
  function t(key, vars) {
    const s = STRINGS[lang()][key] || STRINGS.en[key] || key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ""));
  }

  root.RTime = { t, lang, compareVersions, icon, PRESETS, tomorrowAt, parseLocalInput, toLocalInput, formatWhen, formatTime, messageIdOf, reminderLabels, ceilQuarter, createPicker };
  if (typeof module !== "undefined") module.exports = root.RTime;
})(typeof globalThis !== "undefined" ? globalThis : this);
