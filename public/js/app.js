/* ================= STATE ================= */
const State = {
  picklist: [],
  extraItems: {},
};

/* ================= SCANNER ================= */
const Scanner = {
  timer: null,

  init() {
    const input = document.getElementById("scan-input");
    if (!input) return;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.handle(input.value);
        input.value = "";
      }
    });

    input.addEventListener("input", () => {
      clearTimeout(this.timer);

      this.timer = setTimeout(() => {
        if (input.value.length > 2) {
          this.handle(input.value);
          input.value = "";
        }
      }, 120);
    });

    input.addEventListener("focus", () => {
      document.getElementById("scan-indicator")?.classList.add("active");
    });

    input.addEventListener("blur", () => {
      document.getElementById("scan-indicator")?.classList.remove("active");
    });
  },

  async handle(code) {
    code = code.trim();
    if (!code) return;

    try {
      const res = await fetch("/scan/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      State.picklist = data.picklist || [];
      State.extraItems = data.extra || {};

      UI.render();
      UI.alert(data.alert);

    } catch (err) {
      UI.alert("Server error");
    }
  },
};

/* ================= UI ================= */
const UI = {
  init(data) {
    State.picklist = data.picklist || [];
    State.extraItems = data.extra || {};
    this.render();
  },

  render() {
    this.table();
    this.stats();
  },

  table() {
    const tbody = document.getElementById("picklist-tbody");
    if (!tbody) return;

    let html = "";

    State.picklist.forEach((item) => {
      let status = "pending";
      if (item.scannedQty === item.expectedQty) status = "done";
      else if (item.scannedQty > item.expectedQty) status = "over";
      else if (item.scannedQty > 0) status = "partial";

      html += `
        <tr class="row-state--${status}">
          <td>${item.code}</td>
          <td>${item.expectedQty}</td>
          <td>${item.scannedQty}</td>
          <td>${Math.max(0, item.expectedQty - item.scannedQty)}</td>
          <td>
            <span class="badge badge--${status}">
              ${status}
            </span>
          </td>
        </tr>
      `;
    });

    Object.entries(State.extraItems).forEach(([code, count]) => {
      html += `
        <tr class="row-state--extra">
          <td>${code}</td>
          <td>-</td>
          <td>${count}</td>
          <td>-</td>
          <td><span class="badge badge--extra">extra</span></td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  },

  stats() {
    const total = State.picklist.length;
    const done = State.picklist.filter(i => i.scannedQty === i.expectedQty).length;
    const remaining = total - done;
    const alerts = State.picklist.filter(i => i.scannedQty > i.expectedQty).length + Object.keys(State.extraItems).length;

    this.set("stat-expected", total);
    this.set("stat-done", done);
    this.set("stat-remaining", remaining);
    this.set("stat-alerts", alerts);

    const pct = total ? Math.round((done / total) * 100) : 0;
    this.set("progress-pct", pct + "%");

    const fill = document.getElementById("progress-fill");
    if (fill) fill.style.width = pct + "%";
  },

  alert(msg) {
    const banner = document.getElementById("alert-banner");
    const text = document.getElementById("alert-message");

    if (!msg) {
      if (banner) banner.style.display = "none";
      return;
    }

    if (banner && text) {
      banner.style.display = "flex";
      text.textContent = msg;
    }
  },

  set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  },
};

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  const data = window.__INIT__ || {};
  UI.init(data);
  Scanner.init();
});