// ─── Subtick demo — measure a real round-trip to the chain ────────────
//
// What this does:
//   - On click, fetch /health from subtick.dev and time the round-trip.
//   - Update the big-number display, history list, and best/avg/worst.
//   - Same-origin in production; falls back to https://subtick.dev for
//     local previews.

const ORIGIN = (() => {
  if ((location.protocol === "https:" || location.protocol === "http:")
      && location.hostname && location.hostname !== "localhost"
      && location.hostname !== "127.0.0.1") {
    return `${location.protocol}//${location.host}`;
  }
  return "https://subtick.dev";
})();

const elBtn      = document.getElementById("send-btn");
const elValue    = document.getElementById("latency-value");
const elBest     = document.getElementById("latency-best");
const elAvg      = document.getElementById("latency-avg");
const elWorst    = document.getElementById("latency-worst");
const elHist     = document.getElementById("hist");
const elHistCnt  = document.getElementById("hist-count");
const elHistEmpty = document.getElementById("hist-empty");

const samples = [];

// Copy buttons
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.querySelector(btn.dataset.copy);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.innerText.trim());
      const orig = btn.textContent;
      btn.classList.add("copied");
      btn.textContent = "Copied";
      setTimeout(() => { btn.classList.remove("copied"); btn.textContent = orig; }, 1400);
    } catch { /* clipboard blocked */ }
  });
});

function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 10) return ms.toFixed(1);
  return Math.round(ms).toString();
}

function refreshStats() {
  if (!samples.length) { elBest.textContent = elAvg.textContent = elWorst.textContent = "—"; return; }
  const best  = Math.min(...samples);
  const worst = Math.max(...samples);
  const avg   = samples.reduce((a, b) => a + b, 0) / samples.length;
  elBest.textContent  = `${fmtMs(best)} ms`;
  elAvg.textContent   = `${fmtMs(avg)} ms`;
  elWorst.textContent = `${fmtMs(worst)} ms`;
}

function pushHistory({ ix, ms, ok, err, height }) {
  if (elHistEmpty) elHistEmpty.remove();

  const row = document.createElement("div");
  row.className = "demo-row" + (ok ? "" : " err");
  row.innerHTML = `
    <span class="ix">#${ix}</span>
    <span class="meta">${ok ? `height ${(height ?? "—").toLocaleString?.() ?? height}` : (err || "error")}</span>
    <span class="ms">${ok ? `${fmtMs(ms)} ms` : "—"}</span>
  `;
  elHist.prepend(row);

  while (elHist.childElementCount > 12) elHist.lastElementChild?.remove();
  elHistCnt.textContent = ix.toString();
}

let counter = 0;

async function send() {
  if (elBtn.disabled) return;
  elBtn.disabled = true;
  elBtn.textContent = "Sending…";

  counter += 1;
  const ix = counter;
  const t0 = performance.now();
  let result;

  try {
    const res = await fetch(`${ORIGIN}/health`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    const ms = performance.now() - t0;

    if (!res.ok) throw new Error(`http ${res.status}`);

    samples.push(ms);
    if (samples.length > 64) samples.shift();

    elValue.textContent = fmtMs(ms);
    elValue.classList.remove("flash"); void elValue.offsetWidth; elValue.classList.add("flash");

    refreshStats();
    pushHistory({ ix, ms, ok: true, height: body.height });
    result = "ok";
  } catch (e) {
    elValue.textContent = "—";
    pushHistory({ ix, ok: false, err: e?.message || "error" });
    result = "err";
  }

  elBtn.disabled = false;
  elBtn.textContent = result === "ok" ? "Send another →" : "Retry →";
}

elBtn.addEventListener("click", send);

// Allow Space / Enter to repeat-fire when button focused (already default
// on <button>); also handle a keyboard shortcut: pressing "S" anywhere.
document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  if (e.key === "s" || e.key === "S") { send(); }
});
