const $ = (id) => document.getElementById(id);
document.documentElement.lang = RTime.lang();
document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = RTime.t(n.dataset.i18n); });
const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || !r.ok) throw new Error((r && r.error) || "no response");
    return r.data;
  });

let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.body.style.minHeight = "";
  document.querySelectorAll("li.menu-open").forEach((li) => li.classList.remove("menu-open"));
}

// Snooze dropdown: the fixed snooze times, then a custom date/time. It hangs off the button; the popup grows to fit it.
function snoozeMenu(r, anchor) {
  const wasOpen = openMenu && openMenu.anchor === anchor;
  closeMenu();
  if (wasOpen) return;
  const m = document.createElement("div");
  m.className = "menu";
  m.anchor = anchor;
  m.addEventListener("click", (e) => e.stopPropagation());
  const apply = async (when) => { closeMenu(); await send({ type: "snooze", id: r.id, when }); render(); };
  const now = Date.now();
  for (const p of RTime.snoozePresets()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "item";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = RTime.formatTime(p.at(now));
    b.append(p.label, hint);
    b.addEventListener("click", () => apply(p.at(Date.now())));
    m.appendChild(b);
  }
  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = RTime.t("custom_time");
  const picker = RTime.createPicker(now + 3600e3);
  const go = document.createElement("button");
  go.type = "button";
  go.className = "go";
  go.textContent = RTime.t("set_custom");
  go.addEventListener("click", () => {
    const when = picker.get();
    if (Number.isFinite(when)) apply(when);
  });
  m.append(document.createElement("hr"), sub, picker.el, go);
  document.body.appendChild(m);
  openMenu = m;
  anchor.closest("li").classList.add("menu-open");
  const a = anchor.getBoundingClientRect();
  m.style.top = `${a.bottom + window.scrollY + 4}px`;
  m.style.left = `${Math.max(8, a.right - m.offsetWidth)}px`;
  document.body.style.minHeight = `${a.bottom + window.scrollY + 4 + m.offsetHeight + 12}px`;
}
document.addEventListener("click", closeMenu);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());
$("list").addEventListener("scroll", closeMenu);

async function render() {
  closeMenu();
  const items = (await send({ type: "list" })).filter((r) => !r.done).sort((x, y) => x.when - y.when);
  const ul = $("list");
  ul.replaceChildren();
  $("empty").style.display = items.length ? "none" : "block";
  const now = Date.now();
  const dueCount = items.filter((r) => r.when <= now).length;
  $("sub").textContent = !items.length ? "" : dueCount ? RTime.t("sub_due", { due: dueCount, total: items.length }) : RTime.t("sub_up", { n: items.length });
  for (const r of items) {
    const li = document.createElement("li");
    const t = document.createElement("div");
    t.className = "t";
    if (r.sender) {
      const f = document.createElement("div");
      f.className = "from";
      f.textContent = r.sender;
      t.append(f);
    }
    const b = document.createElement("b");
    b.textContent = r.text;
    b.title = r.text;
    const meta = document.createElement("div");
    meta.className = "meta";
    if (r.when <= now) {
      const due = document.createElement("span");
      due.className = "due";
      due.textContent = RTime.t("due");
      meta.append(due);
    }
    const when = document.createElement("span");
    when.textContent = RTime.formatWhen(r.when);
    meta.append(when);
    t.append(b, meta);

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "check";
    check.title = RTime.t("mark_done");
    check.setAttribute("aria-label", RTime.t("mark_done"));
    check.addEventListener("click", async (e) => {
      e.stopPropagation();
      await send({ type: "complete", id: r.id });
      render();
    });

    const mk = (label, title, fn, cls) => {
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = label;
      x.title = title;
      x.setAttribute("aria-label", title);
      x.className = cls;
      x.addEventListener("click", async (e) => { e.stopPropagation(); await fn(); render(); });
      return x;
    };
    const del = mk("", RTime.t("del"), () => send({ type: "delete", id: r.id }), "del");
    del.appendChild(RTime.icon("close", 16));
    const actions = document.createElement("div");
    actions.className = "actions";
    const snooze = document.createElement("button");
    snooze.type = "button";
    snooze.className = "snooze";
    snooze.setAttribute("aria-haspopup", "menu");
    snooze.append(RTime.t("snooze"), RTime.icon("caret", 14));
    snooze.addEventListener("click", (e) => { e.stopPropagation(); snoozeMenu(r, snooze); });
    actions.append(snooze, del);

    li.title = RTime.t("open_msg");
    li.addEventListener("click", () => send({ type: "open", id: r.id }));
    li.append(check, t, actions);
    ul.appendChild(li);
  }
}

chrome.storage.local.get("update").then(({ update }) => {
  if (!update || RTime.compareVersions(update.version, chrome.runtime.getManifest().version) <= 0) return;
  const a = $("update");
  a.textContent = RTime.t("banner", { version: update.version });
  a.hidden = false;
  a.addEventListener("click", (e) => { e.preventDefault(); send({ type: "openUpdate" }); });
});

$("emptyIcon").appendChild(RTime.icon("check", 40));

$("all").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("reminders.html") });
});

render();
