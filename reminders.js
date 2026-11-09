const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || !r.ok) throw new Error((r && r.error) || "no response");
    return r.data;
  });

document.documentElement.lang = RTime.lang();
document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = RTime.t(n.dataset.i18n); });

const DAY = 24 * 3600e3;

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sectionOf(r, now) {
  if (r.done) return "Completed";
  if (RTime.isTodo(r)) return "Todo";
  if (r.when <= now) return "Overdue";
  const today = startOfDay(now);
  if (r.when < today + DAY) return "Today";
  if (r.when < today + 2 * DAY) return "Tomorrow";
  return "Later";
}
const ORDER = ["Overdue", "Today", "Tomorrow", "Later", "Todo", "Completed"];


let openMenu = null;
function closeMenu() {
  openMenu && openMenu.remove();
  openMenu = null;
}

function btn(label, cls, fn, title) {
  const b = document.createElement("button");
  b.type = "button";
  if (label instanceof Node) b.appendChild(label);
  else b.textContent = label;
  if (cls) b.className = cls;
  if (title) b.title = title;
  b.addEventListener("click", (e) => { e.stopPropagation(); fn(e); });
  return b;
}

function snoozeMenu(r, li) {
  closeMenu();
  const presets = RTime.snoozePresets();
  const m = document.createElement("div");
  m.className = "menu";
  m.addEventListener("click", (e) => e.stopPropagation());
  const apply = (when) => { closeMenu(); send({ type: "snooze", id: r.id, when }); };
  // A completed reminder can come back as a todo, and a timed one can drop its time; an active todo already is one.
  if (r.done || !RTime.isTodo(r)) {
    m.appendChild(btn(RTime.t("add_todo"), "", () => { closeMenu(); send({ type: "todo", id: r.id }); }));
    m.appendChild(document.createElement("hr"));
  }
  presets.forEach((p) => m.appendChild(btn(p.label, "", () => apply(p.at(Date.now())))));
  m.appendChild(document.createElement("hr"));
  const picker = RTime.createPicker(Date.now() + 3600e3);
  m.appendChild(picker.el);
  m.appendChild(btn(RTime.t("set_custom"), "go primary", () => {
    const when = picker.get();
    if (Number.isFinite(when)) apply(when);
  }));
  li.appendChild(m);
  openMenu = m;
}

function row(r) {
  const li = document.createElement("li");
  if (r.done) li.className = "done";
  const t = document.createElement("div");
  t.className = "t";
  if (r.sender) {
    const f = document.createElement("div");
    f.className = "from";
    f.textContent = r.sender;
    t.appendChild(f);
  }
  const b = document.createElement("b");
  b.textContent = r.text;
  b.title = r.text;
  const site = RTime.SITES[RTime.siteOf(r)];
  const chip = document.createElement("i");
  chip.className = "site";
  chip.textContent = site.short;
  chip.style.setProperty("--site", site.color);
  const s = document.createElement("span");
  s.textContent = r.done
    ? RTime.t("completed_at", { when: RTime.formatDay(r.done, Date.now()) })
    : (RTime.isTodo(r) ? RTime.t("todo") : RTime.formatDue(r.when, Date.now())) + (r.source === "message" ? ` · ${RTime.t("from_message")}` : "");
  t.append(b, chip, s);
  li.appendChild(t);
  li.title = RTime.t("open_msg");
  li.addEventListener("click", () => send({ type: "open", id: r.id }));

  const withIcon = (text, name) => {
    const s = document.createElement("span");
    s.className = "lbl";
    s.append(text, RTime.icon(name, 16));
    return s;
  };
  const timeLabel = RTime.isTodo(r) ? RTime.t("set_reminder") : RTime.t("snooze");
  li.appendChild(btn(r.done ? RTime.t("reactivate") : withIcon(timeLabel, "caret"), "", () => snoozeMenu(r, li)));
  if (!r.done) li.appendChild(btn(withIcon(RTime.t("mark_done"), "check"), "", () => send({ type: "complete", id: r.id })));
  li.appendChild(btn(RTime.icon("close", 16), "danger icon", () => send({ type: "delete", id: r.id }), RTime.t("del")));
  return li;
}

// Filter row: All · Slack · Chat · Teams. The choice is kept for next time.
let filter = "all";
function renderFilters(all) {
  const bar = document.getElementById("filters");
  bar.replaceChildren();
  const opts = [["all", RTime.t("filter_all"), all.length]];
  for (const [id, site] of Object.entries(RTime.SITES)) {
    const n = all.filter((r) => RTime.siteOf(r) === id).length;
    if (n || filter === id) opts.push([id, site.short, n]);
  }
  if (opts.length <= 2 && filter === "all") return; // one app only: nothing to filter
  for (const [id, label, n] of opts) {
    const b = btn(`${label} (${n})`, id === filter ? "on" : "", () => {
      filter = id;
      chrome.storage.local.set({ overviewFilter: id }).catch(() => {});
      render();
    });
    if (id !== "all") b.style.setProperty("--site", RTime.SITES[id].color);
    bar.appendChild(b);
  }
}

async function render() {
  closeMenu();
  const all = await send({ type: "list" });
  renderFilters(all);
  const bySite = filter === "all" ? all : all.filter((r) => RTime.siteOf(r) === filter);
  // Second row: All / Scheduled / To-do, shared with the popup and the in-page panel.
  const kind = await RTime.loadFilter();
  document.getElementById("filter").replaceChildren(RTime.createFilterBar(kind, RTime.saveFilter, bySite));
  const items = bySite.filter((r) => RTime.matchesFilter(r, kind));
  const now = Date.now();
  const groups = {};
  items.forEach((r) => (groups[sectionOf(r, now)] ||= []).push(r));
  groups.Completed?.sort((a, b) => b.done - a.done);

  const root = document.getElementById("sections");
  root.replaceChildren();
  document.getElementById("empty").style.display = all.length ? "none" : "block";
  for (const name of ORDER) {
    if (!groups[name]) continue;
    const h = document.createElement("h2");
    h.textContent = `${RTime.t("sec_" + name.toLowerCase())} (${groups[name].length})`;
    if (name === "Overdue") h.className = "overdue";
    const ul = document.createElement("ul");
    groups[name].forEach((r) => ul.appendChild(row(r)));
    root.append(h, ul);
  }
}

chrome.storage.onChanged.addListener((c, area) => area === "local" && !c.overviewFilter && render());
document.addEventListener("click", closeMenu);
setInterval(render, 60e3); // refresh sections as time passes
chrome.storage.local.get("overviewFilter").then((o) => {
  if (o.overviewFilter && (o.overviewFilter === "all" || RTime.SITES[o.overviewFilter])) filter = o.overviewFilter;
}).catch(() => {}).finally(render);
