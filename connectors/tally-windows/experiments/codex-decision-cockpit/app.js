const views = [...document.querySelectorAll("[data-view]")];
const viewButtons = [...document.querySelectorAll("[data-view-target]")];
const dialog = document.querySelector("#action-dialog");
const toast = document.querySelector("#toast");
const partyLabel = document.querySelector("#dialog-party");
const message = document.querySelector("#message-text");
const actionStatus = document.querySelector("#action-status");
const foundationRail = document.querySelector(".foundation-rail");

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element && value != null) element.textContent = String(value);
}

function inrCompact(value) {
  const number = Number(value || 0);
  const absolute = Math.abs(number);
  if (absolute >= 1e7) return `₹${(number / 1e7).toFixed(2)}Cr`;
  if (absolute >= 1e5) return `₹${(number / 1e5).toFixed(2)}L`;
  if (absolute >= 1e3) return `₹${(number / 1e3).toFixed(1)}K`;
  return `₹${Math.round(number).toLocaleString("en-IN")}`;
}

function readableDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "Latest available books";
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

function shortCopy(value, limit = 92) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function showView(name) {
  views.forEach((view) => view.classList.toggle("active", view.dataset.view === name));
  viewButtons.forEach((button) => {
    const active = button.dataset.viewTarget === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

viewButtons.forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewTarget)));
document.querySelectorAll("[data-view-link]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewLink)));

const decisions = {
  collections: {
    eyebrow: "Priority 01",
    theme: "Cash collection",
    title: "Collect ₹8.74 lakh from seven overdue accounts this week.",
    detail: "Start with the three customers holding ₹4.01 lakh. They are overdue, historically responsive and have no active dispute.",
  },
  customers: {
    eyebrow: "Priority 02",
    theme: "Customer recovery",
    title: "Call Kaveri Silks before offering a discount.",
    detail: "They generated ₹3.67 lakh last year but have been quiet for 107 days. There is no complaint on record, so a personal owner call is the best first move.",
  },
  inventory: {
    eyebrow: "Priority 03",
    theme: "Working capital",
    title: "Clear ₹2.96 lakh of slow stock without damaging your best sellers.",
    detail: "Bundle Chiffon Saree, Velvet Roll and Denim Roll with proven products. Stop reordering these items until ageing returns below 60 days.",
  },
};

function showConnectionState(mode, headline, detail) {
  foundationRail.dataset.mode = mode;
  setText("#data-status", headline);
  setText("#data-detail", detail);

  const labels = {
    connected: "Live company data",
    empty: "Ready for first sync",
    unauthenticated: "Protected data · sign in",
    offline: "GI core offline",
    loading: "Checking GI data…",
  };
  setText("#mode-label", labels[mode] || "Prototype · Demo data");
}

function applyConnectedBrief(payload) {
  const { company, source, asOf, counts, quality, kpis, brief } = payload;
  const sourceLabel = source === "tally" ? "Tally" : source === "excel" ? "uploaded books" : source;
  const totalRows = counts.salesRows + counts.inventoryRows + counts.billRows + counts.voucherRows + counts.ledgerRows;
  const priorities = brief.priorities || [];
  const lead = priorities[0];

  document.body.classList.add("live-data");
  showConnectionState(
    "connected",
    `${sourceLabel === "Tally" ? "Tally data" : "Company data"} mapped into Growth Intelligence`,
    `${totalRows.toLocaleString("en-IN")} trusted records · ${counts.billRows} bills · ${counts.voucherRows} vouchers · books as of ${asOf}`,
  );
  setText("#mode-copy", `${company} is using the existing GI ingestion and analysis engine.`);
  setText("#data-layer-state", `${sourceLabel || "Books"} connected · ${quality.score}/100`);
  setText("#company-name", company);
  setText("#sync-text", `${sourceLabel || "Books"} · ${counts.voucherRows.toLocaleString("en-IN")} vouchers available`);
  setText("#owner-date", readableDate(asOf));
  setText("#decision-confidence", quality.score);

  if (lead) {
    setText(".priority-line span", "Priority 01");
    setText(".priority-line em", lead.label);
    setText("#decision-title", lead.action);
    setText("#decision-detail", lead.soWhat);
  }

  setText("#evidence-value", inrCompact(kpis.receivables));
  setText("#evidence-copy", "Receivables in connected books");
  setText("#evidence-note", quality.checks.accountingEvidence ? "Backed by bills and ledgers" : "Sales-derived · connect bills for stronger proof");
  setText("#judgment-value", lead ? inrCompact(lead.impactInr) : "Review");
  setText("#judgment-copy", lead?.label || "Highest-priority issue");
  setText("#judgment-note", lead ? `${lead.severity} priority · evidence ranked` : "Waiting for usable data");
  setText("#action-value", `${Math.min(3, priorities.length)} moves`);
  setText("#action-copy", "Ready for management review");
  setText("#action-status", "Automation remains in simulation");
  setText("#result-value", "Baseline");
  setText("#result-copy", "Outcome tracking starts here");
  setText("#result-note", "No result claimed until Tally verifies it");

  setText("#revenue-value", inrCompact(kpis.totalRevenue));
  setText("#revenue-note", `${kpis.invoiceCount} invoices · ${kpis.customerCount} customers`);
  setText("#receivables-value", inrCompact(kpis.billReceivables || kpis.receivables));
  setText("#receivables-note", `${inrCompact(kpis.overdueReceivables)} overdue`);
  setText("#cash-value", inrCompact(kpis.bankBalance + kpis.cashBalance));
  setText("#cash-note", kpis.hasFinancials ? "Bank and cash ledgers" : "Connect ledgers to calculate");
  setText("#dso-value", `${kpis.dso} days`);
  setText("#dso-note", "Calculated from connected receivables");

  const rows = [...document.querySelectorAll(".decision-row")];
  rows.forEach((row, index) => {
    const priority = priorities[index];
    if (!priority) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    const key = row.dataset.decision;
    decisions[key] = {
      eyebrow: `Priority 0${index + 1}`,
      theme: priority.label,
      title: priority.action,
      detail: priority.soWhat,
    };
    row.querySelector(".rank").textContent = `0${index + 1}`;
    row.querySelector(".decision-copy strong").textContent = priority.label;
    row.querySelector(".decision-copy small").textContent = shortCopy(priority.soWhat);
    row.querySelector(".impact small").textContent = `${priority.severity} priority`;
    row.querySelector(".impact strong").textContent = inrCompact(priority.impactInr);
  });
}

async function loadLiveBrief() {
  const refresh = document.querySelector("#refresh-data");
  refresh.disabled = true;
  refresh.textContent = "Checking…";
  showConnectionState("loading", "Checking the existing GI connection", "Live data will replace the demo only after authentication and a successful sync.");

  try {
    const response = await fetch("/api/live-brief", { credentials: "include", cache: "no-store" });
    const payload = await response.json();

    if (response.status === 401 || payload.mode === "unauthenticated") {
      showConnectionState("unauthenticated", "Sign in to GI to read connected company data", "The management cockpit never exposes company books without an authenticated GI session.");
      setText("#mode-copy", "Demo values remain visible until you sign in and connect a company.");
      setText("#data-layer-state", "Authentication required");
      setText("#sync-text", "Demo mode · no company data read");
      return;
    }

    if (!response.ok || payload.mode === "offline") {
      showConnectionState("offline", "Start the GI core to activate live data", payload.message || "The prototype is available, but the data service is offline.");
      setText("#mode-copy", "Demo values remain clearly separated from connected company data.");
      setText("#data-layer-state", "Core service offline");
      setText("#sync-text", "Demo mode · GI core offline");
      return;
    }

    if (payload.mode === "empty") {
      showConnectionState("empty", "GI is ready for the first Tally sync", "Open Connect Tally, run the local agent or upload an export. The cockpit will refresh from the canonical dataset.");
      setText("#mode-copy", "The core is connected, but no usable company dataset is available yet.");
      setText("#data-layer-state", "Awaiting company books");
      setText("#sync-text", "No company data connected");
      return;
    }

    applyConnectedBrief(payload);
  } catch {
    showConnectionState("offline", "Start the GI core to activate live data", "The visual prototype is running, but the existing GI application is not reachable on port 3122.");
    setText("#mode-copy", "Demo values remain clearly separated from connected company data.");
    setText("#data-layer-state", "Core service offline");
    setText("#sync-text", "Demo mode · GI core offline");
  } finally {
    refresh.disabled = false;
    refresh.textContent = "Refresh";
  }
}

document.querySelectorAll("[data-decision]").forEach((row) => {
  row.addEventListener("click", () => {
    document.querySelectorAll("[data-decision]").forEach((item) => item.classList.remove("selected"));
    row.classList.add("selected");
    const data = decisions[row.dataset.decision];
    document.querySelector(".priority-line span").textContent = data.eyebrow;
    document.querySelector(".priority-line em").textContent = data.theme;
    document.querySelector("#decision-title").textContent = data.title;
    document.querySelector(".decision-lead > p").textContent = data.detail;
    document.querySelector(".decision-ledger").scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

document.querySelectorAll("[data-open-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const party = button.dataset.party || "Capital Garments";
    partyLabel.textContent = party;
    const initials = party.split(" ").map((part) => part[0]).slice(0, 2).join("");
    document.querySelector(".party-avatar").textContent = initials;
    dialog.showModal();
  });
});

document.querySelector("#edit-message").addEventListener("click", (event) => {
  const editing = !message.hasAttribute("readonly");
  if (editing) {
    message.setAttribute("readonly", "");
    event.currentTarget.textContent = "Edit";
  } else {
    message.removeAttribute("readonly");
    message.focus();
    event.currentTarget.textContent = "Done editing";
  }
});

document.querySelector("#approve-action").addEventListener("click", () => {
  dialog.close();
  actionStatus.textContent = "Approved in prototype · not sent";
  actionStatus.style.color = "#7fd0bd";
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3500);
});

function attachSearch(inputSelector, rowSelector) {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  input.addEventListener("input", () => {
    const needle = input.value.trim().toLowerCase();
    document.querySelectorAll(rowSelector).forEach((row) => {
      row.hidden = Boolean(needle) && !row.dataset.search.includes(needle);
    });
  });
}

attachSearch("#collection-search", "#collection-rows tr");
attachSearch("#evidence-search", "#evidence-rows > div");

dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) dialog.close();
});

document.querySelector("#refresh-data").addEventListener("click", loadLiveBrief);
loadLiveBrief();
