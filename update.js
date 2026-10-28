// One-click updater for the unpacked install. The user grants access to the extension's own folder once (the handle
// is kept in IndexedDB); "Update now" then downloads the latest release zip, writes its files into that folder and
// reloads the extension. Everything is downloaded and unpacked before anything is written.
const ZIP_URL = "https://github.com/marandy0905/chat-reminders/releases/latest/download/chat-reminders.zip";
const $ = (id) => document.getElementById(id);
document.documentElement.lang = RTime.lang();
document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = RTime.t(n.dataset.i18n); });
const status = (msg, cls = "") => { $("status").textContent = msg; $("status").className = cls; };

const db = () => new Promise((resolve, reject) => {
  const req = indexedDB.open("gcr-updater", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("kv");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const kv = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const store = d.transaction("kv", mode).objectStore("kv");
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const getHandle = () => kv("readonly", (s) => s.get("dir")).catch(() => null);
const putHandle = (h) => kv("readwrite", (s) => s.put(h, "dir"));

let dir = null;

// The chosen folder must be this extension's own folder: its manifest.json has to carry our name.
async function isOurFolder(handle) {
  try {
    const file = await (await handle.getFileHandle("manifest.json")).getFile();
    const m = JSON.parse(await file.text());
    return m.name === chrome.runtime.getManifest().name;
  } catch (_) {
    return false;
  }
}

async function refresh() {
  const current = chrome.runtime.getManifest().version;
  const { update } = await chrome.storage.local.get("update");
  $("versions").textContent = update ? RTime.t("versions_new", { current, latest: update.version }) : RTime.t("versions_none", { current });
  $("step1").classList.toggle("done", !!dir);
  $("go").disabled = !dir;
}

$("pick").addEventListener("click", async () => {
  try {
    const handle = await showDirectoryPicker({ mode: "readwrite" });
    if (!(await isOurFolder(handle))) return status(RTime.t("wrong_folder"), "err");
    dir = handle;
    await putHandle(handle);
    status(RTime.t("saved"), "ok");
    refresh();
  } catch (e) {
    if (e.name !== "AbortError") status(RTime.t("folder_fail", { msg: e.message }), "err");
  }
});

async function writeFile(root, path, bytes) {
  const parts = path.split("/");
  const name = parts.pop();
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(bytes);
  await w.close();
}

$("go").addEventListener("click", async () => {
  $("go").disabled = true;
  try {
    // Must run in this click: re-confirm folder access if Chrome dropped it.
    if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted" && (await dir.requestPermission({ mode: "readwrite" })) !== "granted") {
      throw new Error(RTime.t("perm_denied"));
    }
    if (!(await isOurFolder(dir))) throw new Error(RTime.t("folder_changed"));
    status(RTime.t("downloading"));
    const res = await fetch(ZIP_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(RTime.t("dl_fail", { status: res.status }));
    const files = fflate.unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files).filter((n) => !n.endsWith("/") && !n.includes("..") && !n.startsWith("/"));
    if (!names.includes("manifest.json")) throw new Error(RTime.t("bad_zip"));
    status(RTime.t("installing"));
    // manifest.json last, so an interrupted update never leaves a new manifest pointing at old files.
    for (const n of names.filter((n) => n !== "manifest.json")) await writeFile(dir, n, files[n]);
    await writeFile(dir, "manifest.json", files["manifest.json"]);
    status(RTime.t("done"), "ok");
    setTimeout(() => chrome.runtime.reload(), 800);
  } catch (e) {
    status(e.message || String(e), "err");
    $("go").disabled = false;
  }
});

(async () => {
  const saved = await getHandle();
  if (saved && (await isOurFolder(saved))) dir = saved;
  await refresh();
})();
