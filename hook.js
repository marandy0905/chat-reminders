// Runs in the page's own JS world (not the extension's isolated one) so it can see what Chat writes to the
// clipboard when you use its "Copy link" action. Only URLs are reported, via window.postMessage.
(function () {
  const report = (text) => {
    try {
      if (typeof text === "string" && /^https?:\/\//.test(text.trim())) {
        window.postMessage({ gcr: "copied-link", text: text.trim() }, "*");
      }
    } catch (_) {}
  };
  try {
    const cb = navigator.clipboard;
    const orig = cb && cb.writeText && cb.writeText.bind(cb);
    if (orig) cb.writeText = (t) => { report(t); return orig(t); };
  } catch (_) {}
  document.addEventListener("copy", (e) => {
    try {
      report((e.clipboardData && e.clipboardData.getData("text/plain")) || String(document.getSelection()));
    } catch (_) {}
  }, true);
})();
