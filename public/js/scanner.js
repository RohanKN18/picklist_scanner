/* ═══════════════════════════════════════════
   PICKLIST SCANNER — CLIENT LOGIC
   Handles real-time scanning, UI updates,
   and server sync via fetch API.
═══════════════════════════════════════════ */

/* ── STATE ── */
const State = {
  picklist: [],
  extra: {},
  stats: {},
  lastScannedCode: null,
  unscanMode: false,   // ← unscan mode flag
};

/* ── ELEMENTS ── */
const $ = (id) => document.getElementById(id);

const EL = {
  tbody:       () => $("picklist-tbody"),
  statExp:     () => $("stat-expected"),
  statDone:    () => $("stat-done"),
  statRem:     () => $("stat-remaining"),
  statAlerts:  () => $("stat-alerts"),
  progFill:    () => $("progress-fill"),
  progPct:     () => $("progress-pct"),
  scanInput:   () => $("scan-input"),
  indicator:   () => $("scan-indicator"),
  status:      () => $("scanner-status"),
  alertBanner: () => $("alert-banner"),
  alertMsg:    () => $("alert-message"),
};

/* ── STATUS HELPERS ── */
const getStatus = (item) => {
  if (item.scannedQty === 0) return "pending";
  if (item.scannedQty < item.expectedQty) return "partial";
  if (item.scannedQty === item.expectedQty) return "done";
  return "over";
};

const STATUS_LABELS = {
  pending: "PENDING",
  partial: "PARTIAL",
  done:    "DONE",
  over:    "OVER",
  extra:   "EXTRA",
};

/* ── RENDER TABLE ── */
function renderTable() {
  const tbody = EL.tbody();
  if (!tbody) return;

  let html = "";

  State.picklist.forEach((item) => {
    const expected  = Number(item.expectedQty || 0);
    const scanned   = Number(item.scannedQty  || 0);
    const remaining = Math.max(0, expected - scanned);
    const status    = getStatus(item);
    const isLast    = item.code === State.lastScannedCode;

    html += `
      <tr class="row--${status}${isLast ? " row--flash" : ""}" data-code="${item.code}">
        <td class="col-code">${escHtml(item.code)}</td>
        <td class="col-num">${expected}</td>
        <td class="col-num">${scanned}</td>
        <td class="col-num">${remaining}</td>
        <td class="col-status">
          <span class="badge badge--${status}">${STATUS_LABELS[status]}</span>
        </td>
      </tr>
    `;
  });

  // Extra scans (items not on picklist)
  Object.entries(State.extra).forEach(([code, count]) => {
    html += `
      <tr class="row--extra" data-code="${code}">
        <td class="col-code">${escHtml(code)}</td>
        <td class="col-num">—</td>
        <td class="col-num">${count}</td>
        <td class="col-num">—</td>
        <td class="col-status">
          <span class="badge badge--extra">EXTRA</span>
        </td>
      </tr>
    `;
  });

  if (!html) {
    html = `<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:40px;">No items loaded</td></tr>`;
  }

  tbody.innerHTML = html;
}

/* ── RENDER STATS ── */
function renderStats() {
  const s = State.stats;
  if (!s) return;

  setText("stat-expected",  s.totalExpected  ?? 0);
  setText("stat-done",      s.totalScanned   ?? 0);
  setText("stat-remaining", s.totalRemaining ?? 0);
  setText("stat-alerts",    s.alertCount     ?? 0);
  setText("progress-pct",   (s.progressPct   ?? 0) + "%");

  const fill = EL.progFill();
  if (fill) fill.style.width = (s.progressPct ?? 0) + "%";

  // Pulse alerts stat if non-zero
  const alertEl = $("stat-alerts");
  if (alertEl) {
    alertEl.parentElement.classList.toggle("stat-pill--alert", s.alertCount > 0);
  }
}

/* ── SHOW / HIDE ALERT ── */
function showAlert(msg, type = "error") {
  const banner = EL.alertBanner();
  const msgEl  = EL.alertMsg();

  if (!msg) {
    if (banner) banner.style.display = "none";
    return;
  }

  if (banner && msgEl) {
    banner.style.display = "flex";
    msgEl.textContent = msg;
    // Auto-dismiss after 4s
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => {
      banner.style.display = "none";
    }, 4000);
  }
}

/* ── SCANNER STATUS ── */
function setStatus(msg) {
  const el = EL.status();
  if (el) el.textContent = msg;
}

/* ── FULL RENDER ── */
function render() {
  renderTable();
  renderStats();
}

/* ═══════════════════════════════════════════
   SCANNER MODULE
═══════════════════════════════════════════ */
const Scanner = {
  debounceTimer: null,
  isProcessing: false,

  init() {
    const input = EL.scanInput();
    if (!input) return;

    // Focus indicator
    input.addEventListener("focus", () => {
      EL.indicator()?.classList.add("active");
      setStatus("Ready");
    });

    input.addEventListener("blur", () => {
      EL.indicator()?.classList.remove("active");
    });

    // Enter key → scan immediately
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = input.value.trim();
        if (val) {
          this.handle(val);
          input.value = "";
        }
      }
    });

    // Debounced input (for hardware scanners that don't send Enter)
    input.addEventListener("input", () => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const val = input.value.trim();
        if (val.length > 2) {
          this.handle(val);
          input.value = "";
        }
      }, 120);
    });

    // Keep input focused
    input.focus();
  },

  async handle(code) {
    if (this.isProcessing || !code) return;
    this.isProcessing = true;

    setStatus(State.unscanMode ? "Unscanning…" : "Scanning…");

    try {
      const res = await fetch("/scan/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, unscan: State.unscanMode }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();

      // Update state
      State.picklist = data.picklist || [];
      State.extra    = data.extra    || {};
      State.stats    = data.stats    || {};
      State.lastScannedCode = data.code; // use resolved code for flash highlight

      render();

      // Show alert if any
      if (data.alert) {
        showAlert(data.alert);
        setStatus("⚠ Alert");
      } else {
        showAlert(null);
        let label = getScanTypeLabel(data.scanType);
        // Show remap info in status
        if (data.isRemapped) {
          label += ` (${data.rawCode} → ${data.code})`;
        }
        // Show qty if > 1
        if (data.qty && data.qty > 1) {
          label += ` ×${data.qty}`;
        }
        setStatus(label);
      }

      // Auto-clear status
      setTimeout(() => setStatus(State.unscanMode ? "Unscan ON" : "Ready"), 2500);

    } catch (err) {
      console.error("Scan error:", err);
      showAlert("Connection error — check server");
      setStatus("Error");
    } finally {
      this.isProcessing = false;
      EL.scanInput()?.focus();
    }
  },
};

function getScanTypeLabel(type) {
  switch (type) {
    case "complete":        return "✓ Complete!";
    case "match":           return "✓ Scanned";
    case "extra":           return "⚠ Extra";
    case "over":            return "⚠ Over";
    case "unscanned":       return "↩ Unscanned";
    case "unscanned-extra": return "↩ Removed extra";
    case "nothing-to-unscan": return "— Nothing to remove";
    default:                return "✓ OK";
  }
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ═══════════════════════════════════════════
   UNSCAN MODE TOGGLE
   Called by the button in scan.ejs
═══════════════════════════════════════════ */
function toggleUnscanMode() {
  State.unscanMode = !State.unscanMode;

  const btn        = document.getElementById("unscan-btn");
  const banner     = document.getElementById("unscan-banner");
  const toggle     = document.getElementById("unscan-toggle");
  const scanBlock  = document.getElementById("scanner-block");
  const scanInput  = document.getElementById("scan-input");

  if (State.unscanMode) {
    btn?.setAttribute("aria-checked", "true");
    btn?.classList.add("on");
    toggle?.classList.add("active");
    banner && (banner.style.display = "flex");
    scanBlock?.classList.add("unscan-active");
    if (scanInput) scanInput.placeholder = "Scan to REMOVE (unscan mode)...";
    setStatus("Unscan ON");
  } else {
    btn?.setAttribute("aria-checked", "false");
    btn?.classList.remove("on");
    toggle?.classList.remove("active");
    banner && (banner.style.display = "none");
    scanBlock?.classList.remove("unscan-active");
    if (scanInput) scanInput.placeholder = "Scan or type barcode...";
    setStatus("Ready");
  }

  // Re-focus input so scanner gun still works after click
  document.getElementById("scan-input")?.focus();
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  const init = window.__INIT__ || {};

  State.picklist = init.picklist || [];
  State.extra    = init.extra    || {};
  State.stats    = init.stats    || {};

  render();
  Scanner.init();
});
