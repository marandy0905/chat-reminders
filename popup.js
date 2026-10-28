const $ = (id) => document.getElementById(id);
const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || !r.ok) throw new Error((r && r.error) || "no response");
    return r.data;
  });

async function render() {
  const items = (await send({ type: "list" })).filter((r) => !r.done);
  const ul = $("list");
  ul.replaceChildren();
  $("empty").style.display = items.length ? "none" : "block";
  const now = Date.now();
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
    const s = document.createElement("span");
    const overdue = r.when <= now;
    s.className = overdue ? "due" : "";
    s.textContent = (overdue ? "Due · " : "") + RTime.formatWhen(r.when) + (r.source === "message" ? " · from message" : "");
    t.append(b, s);

    const mk = (label, title, fn, cls) => {
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = label;
      x.title = title;
      if (cls) x.className = cls;
      x.addEventListener("click", async (e) => { e.stopPropagation(); await fn(); render(); });
      return x;
    };
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "check";
    check.title = "Mark as done";
    check.addEventListener("click", async (e) => {
      e.stopPropagation();
      await send({ type: "complete", id: r.id });
      render();
    });

    const del = mk("", "Delete", () => send({ type: "delete", id: r.id }), "del");
    del.appendChild(RTime.icon("close", 16));
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(mk("Snooze 10m", "Snooze 10 minutes", () => send({ type: "snooze", id: r.id, ms: 10 * 60e3 })));

    li.title = "Open this message in Chat";
    li.addEventListener("click", () => send({ type: "open", id: r.id }));
    li.append(check, t, actions, del);
    ul.appendChild(li);
  }
}

$("all").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("reminders.html") });
});

render();
