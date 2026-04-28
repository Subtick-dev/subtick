// ─── Subtick — landing page logic ──────────────────────────────────────
//
// Two jobs:
//   1. Pull /health every 4s to keep the hero pill alive (height + tps proxy).
//   2. Subscribe to wss://.../v1/events and stream BatchExecuted into the
//      live feed, with smooth ingestion and bounded list size.
//
// Endpoint is auto-detected: same-origin in production (subtick.dev),
// falls back to a hardcoded base for local previews (file://, localhost).

const ORIGIN_HTTP = (() => {
  if (location.protocol === "https:" || location.protocol === "http:") {
    if (location.hostname && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      return `${location.protocol}//${location.host}`;
    }
  }
  return "https://subtick.dev";
})();
const ORIGIN_WS = ORIGIN_HTTP.replace(/^http/, "ws");

// ─── Copy buttons ─────────────────────────────────────────────────────
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.querySelector(btn.dataset.copy);
    if (!target) return;
    const text = target.innerText.trim();
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add("copied");
      const orig = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.classList.remove("copied"); btn.textContent = orig; }, 1400);
    } catch { /* clipboard blocked — silent */ }
  });
});

// ─── Hero status pill (height + tps proxy) ────────────────────────────
const elStatusText   = document.getElementById("status-text");
const elStatusHeight = document.getElementById("status-height");
const elStatusTps    = document.getElementById("status-tps");

let prevHeight = null;
let prevAt = null;

async function pollHealth() {
  try {
    const res = await fetch(`${ORIGIN_HTTP}/health`, { cache: "no-store" });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const body = await res.json();
    const now = performance.now();
    const height = Number(body.height ?? 0);

    elStatusText.textContent = "live";
    elStatusHeight.textContent = `height ${height.toLocaleString()}`;

    if (prevHeight !== null && prevAt !== null) {
      const dh = height - prevHeight;
      const dt = (now - prevAt) / 1000;
      // Heights grow per batch; we don't know tx-per-batch here, so just
      // report the pulse rate as bps. SDK callers can derive their own.
      if (dt > 0 && dh >= 0) {
        const bps = dh / dt;
        elStatusTps.textContent = `${bps.toFixed(1)} bps`;
      }
    }
    prevHeight = height;
    prevAt = now;
  } catch (e) {
    elStatusText.textContent = "offline";
    elStatusHeight.textContent = "";
    elStatusTps.textContent = "";
  }
}
pollHealth();
setInterval(pollHealth, 4000);

// ─── Live WebSocket feed ──────────────────────────────────────────────
const elList    = document.getElementById("live-list");
const elEmpty   = document.getElementById("live-empty");
const elWsState = document.getElementById("ws-state");
const elWsDot   = document.getElementById("ws-dot");
const elCounter = document.getElementById("ws-counter");

const MAX_ROWS = 12;
let totalEvents = 0;
let lastBatchAt = null;

function setWsState(state) {
  elWsState.textContent = state;
  elWsDot.style.background =
    state === "connected" ? "var(--ok)" :
    state === "connecting" ? "var(--accent)" :
    "var(--warn)";
}

function fmtNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}

function pushRow({ height, applied, latency }) {
  if (elEmpty) elEmpty.remove();

  const row = document.createElement("div");
  row.className = "live-feed-row";
  row.innerHTML = `
    <span class="height">batch ${fmtNum(height)}</span>
    <span class="applied">${fmtNum(applied)} txs</span>
    <span class="latency">${latency != null ? `${latency.toFixed(0)} ms` : "—"}</span>
    <span class="time">${new Date().toLocaleTimeString([], { hour12: false })}</span>
  `;

  elList.prepend(row);
  while (elList.childElementCount > MAX_ROWS) {
    elList.lastElementChild?.remove();
  }

  totalEvents += 1;
  elCounter.textContent = `${totalEvents} event${totalEvents === 1 ? "" : "s"}`;
}

function connectWs() {
  setWsState("connecting");
  let ws;
  try {
    ws = new WebSocket(`${ORIGIN_WS}/v1/events`);
  } catch {
    setWsState("offline");
    return;
  }

  ws.onopen = () => setWsState("connected");
  ws.onclose = () => {
    setWsState("offline");
    setTimeout(connectWs, 2500);
  };
  ws.onerror = () => { /* close handler will fire next */ };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    // The chain emits BatchExecuted frames. Field names follow the v1
    // contract; if a particular field is missing, fall back gracefully.
    const t = msg.type ?? msg.event ?? "";
    if (t && !t.toLowerCase().includes("batch")) return;

    const now = performance.now();
    const latency = lastBatchAt != null ? (now - lastBatchAt) : null;
    lastBatchAt = now;

    pushRow({
      height:  msg.height ?? msg.block_height ?? msg.batch_id ?? msg.idx,
      applied: msg.applied ?? msg.tx_count ?? msg.applied_count ?? 0,
      latency,
    });
  };
}
connectWs();
