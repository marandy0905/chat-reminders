// Options page: edit the quick options shown when setting or snoozing a reminder. Changes save immediately.
const $ = (id) => document.getElementById(id);
document.documentElement.lang = RTime.lang();
document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = RTime.t(n.dataset.i18n); });

let items = [];
let savedTimer;

const UNITS = [["unit_min", 1], ["unit_hr", 60], ["unit_day", 1440]];
const unitFor = (min) => (min % 1440 === 0 ? 1440 : min % 60 === 0 ? 60 : 1);

async function save() {
  items = RTime.sanitizePresets(items);
  await chrome.storage.local.set({ presets: items });
  const s = $("saved");
  s.textContent = RTime.t("opt_saved");
  s.classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove("show"), 1400);
}

function row(o, i) {
  const li = document.createElement("li");
  const kind = document.createElement("span");
  kind.className = "kind";
  if (o.kind === "tomorrow") {
    kind.textContent = RTime.t("opt_tomorrow");
    const time = document.createElement("input");
    time.type = "time";
    time.value = o.time;
    time.addEventListener("change", () => { if (time.value) { items[i] = { kind: "tomorrow", time: time.value }; save().then(render); } });
    li.append(kind, time);
  } else {
    kind.textContent = RTime.t("opt_from_now");
    const unit = unitFor(o.minutes);
    const num = document.createElement("input");
    num.type = "number";
    num.min = "1";
    num.step = "1";
    num.value = String(o.minutes / unit);
    const sel = document.createElement("select");
    for (const [key, mult] of UNITS) {
      const opt = document.createElement("option");
      opt.value = String(mult);
      opt.textContent = RTime.t(key);
      if (mult === unit) opt.selected = true;
      sel.appendChild(opt);
    }
    const commit = () => {
      const n = parseFloat(num.value);
      if (!(n > 0)) return render();
      items[i] = { kind: "in", minutes: Math.round(n * +sel.value) };
      save().then(render);
    };
    num.addEventListener("change", commit);
    sel.addEventListener("change", commit);
    li.append(kind, num, sel);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "x";
  x.title = RTime.t("remove");
  x.setAttribute("aria-label", RTime.t("remove"));
  x.appendChild(RTime.icon("close", 16));
  x.addEventListener("click", () => { items.splice(i, 1); save().then(render); });
  li.appendChild(x);
  return li;
}

function render() {
  const list = $("list");
  list.replaceChildren(...items.map(row));
  const full = items.length >= RTime.MAX_PRESETS;
  $("addIn").disabled = $("addTmr").disabled = full;
  $("note").textContent = full ? RTime.t("opt_max", { n: RTime.MAX_PRESETS }) : items.length ? "" : RTime.t("opt_empty");
}

$("addIn").addEventListener("click", () => { items.push({ kind: "in", minutes: 30 }); save().then(render); });
$("addTmr").addEventListener("click", () => { items.push({ kind: "tomorrow", time: "09:00" }); save().then(render); });
$("reset").addEventListener("click", () => { items = RTime.DEFAULT_PRESETS.map((p) => ({ ...p })); save().then(render); });

chrome.storage.local.get("presets").then((o) => { items = RTime.sanitizePresets(o.presets); render(); });
