(function () {
  "use strict";

  const COLLECTION_TYPES = ["Tithe", "Vote of Thanks (VTO)", "Children's Service Offertory", "Junior Youth (JY)", "Adult Offertory"];
  const METHODS = ["Cash", "Mobile Money", "Bank", "Other"];
  const OCCASIONS = ["Birthday", "Anniversary", "Graduation", "Marriage", "Child Dedication", "Thanksgiving", "New Job", "Other"];
  const EXPENSE_CATEGORIES = ["Utilities", "Maintenance", "Repairs", "Transport", "Stationery", "Events", "Ministry", "Welfare", "Bank Charges", "Salaries/Allowances", "Other"];
  const PAGE_SIZE = 10;
  const sectionTypes = {
    tithes: "Tithe",
    vto: "Vote of Thanks (VTO)",
    children: "Children's Service Offertory",
    jy: "Junior Youth (JY)",
    adult: "Adult Offertory"
  };
  const state = {
    client: null, userId: null, permissions: [], members: [], events: [], legacyTransactions: [],
    collections: [], expenses: [], funds: [], remittances: [], transfers: [], rules: [], audit: [],
    section: "dashboard", page: 1, loading: false, initialized: false, bound: false
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const money = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", minimumFractionDigits: 2 });
  const compactMoney = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", notation: "compact", maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const dateTimeFormat = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const num = value => Number(value || 0);
  const dateFromIso = value => new Date(`${value}T00:00:00`);
  const formatDate = value => value ? dateFormat.format(dateFromIso(value)) : "—";
  const relation = (record, key) => Array.isArray(record?.[key]) ? record[key][0] : record?.[key];
  const fullName = member => `${member?.first_name || ""} ${member?.last_name || ""}`.trim() || "—";
  const optionList = (values, selected = "") => values.map(value => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("");
  const accountedCollection = record => !["Pending", "Voided"].includes(record.status);
  const activeRemittance = record => record.status !== "Voided";
  const paidExpense = record => record.status === "Paid";
  const rule = () => state.rules.find(item => item.collection_type === "Adult Offertory" && item.enabled) || null;

  function mount() {
    const root = $("#financeModuleRoot");
    if (!root || root.dataset.mounted) return;
    root.dataset.mounted = "true";
    root.innerHTML = `
      <div class="finance-heading page-heading">
        <div><p class="breadcrumb">Home <i data-lucide="chevron-right"></i> Finance <i data-lucide="chevron-right"></i> <span id="financeBreadcrumbSection">Dashboard</span></p><h2 id="financeSectionTitle">Finance & stewardship</h2><p id="financeSectionDescription">Accountable church collections, expenses, funds, remittance, and reporting.</p></div>
        <div class="finance-heading-actions"><button class="secondary-btn" id="financeRefresh" type="button"><i data-lucide="refresh-cw"></i> Refresh</button><button class="primary-btn" id="financePrimaryAction" type="button" data-requires="finance.manage"><i data-lucide="plus"></i> Record collection</button></div>
      </div>
      <nav class="finance-tabs" id="financeTabs" aria-label="Finance sections">
        ${[["dashboard","Dashboard"],["collections","Collections"],["tithes","Tithes"],["vto","VTO"],["children","Children's Offertory"],["jy","Junior Youth"],["adult","Adult Offertory"],["remittances","District Remittance"],["expenses","Expenses"],["funds","Funds / Accounts"],["reports","Reports"],["settings","Settings"],["audit","Audit Trail"]].map(([value,label]) => `<button type="button" data-finance-tab="${value}">${label}</button>`).join("")}
      </nav>
      <div class="finance-message" id="financeMessage" hidden></div>
      <div id="financeContent"><div class="finance-loading"><span></span><p>Loading secure financial records…</p></div></div>

      <dialog id="financeCollectionDialog" class="finance-dialog"><form id="financeCollectionForm">
        <div class="dialog-header"><div><p class="eyebrow">COLLECTION ENTRY</p><h3>Record collection</h3></div><button class="icon-btn" type="button" data-close-finance="financeCollectionDialog" aria-label="Close"><i data-lucide="x"></i></button></div>
        <div class="dialog-body">
          <label>Collection date<input name="collection_date" type="date" required /></label>
          <label>Collection type<select name="collection_type" required>${optionList(COLLECTION_TYPES)}</select></label>
          <label>Service<select name="event_id"><option value="">No linked service</option></select></label>
          <label>Member / person<select name="member_id"><option value="">Not member-specific</option></select></label>
          <label>Amount (GH₵)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" /></label>
          <label>Method<select name="collection_method">${optionList(METHODS)}</select></label>
          <label>Fund / account<select name="fund_id" required></select></label>
          <label>Reference number<input name="reference_number" placeholder="Optional receipt or bank reference" /></label>
          <label class="full" id="financeOccasionField" hidden>VTO occasion<select name="occasion">${optionList(OCCASIONS)}</select></label>
          <label>Status<select name="status"><option>Pending</option><option>Counted</option><option data-verify-option>Verified</option><option>Deposited</option><option data-verify-option>Reconciled</option></select></label>
          <label class="full">Description / notes<textarea name="description" placeholder="Collection notes…"></textarea></label>
          <div class="full distribution-preview" id="financeDistributionPreview" hidden></div>
          <p class="full finance-form-error" id="financeCollectionError" hidden></p>
        </div>
        <div class="dialog-footer"><button class="secondary-btn" type="button" data-close-finance="financeCollectionDialog">Cancel</button><button class="primary-btn" type="submit">Save collection</button></div>
      </form></dialog>

      <dialog id="financeExpenseDialog" class="finance-dialog"><form id="financeExpenseForm">
        <div class="dialog-header"><div><p class="eyebrow">EXPENSE WORKFLOW</p><h3>Record expense</h3></div><button class="icon-btn" type="button" data-close-finance="financeExpenseDialog" aria-label="Close"><i data-lucide="x"></i></button></div>
        <div class="dialog-body">
          <label>Expense date<input name="expense_date" type="date" required /></label><label>Category<select name="category">${optionList(EXPENSE_CATEGORIES)}</select></label>
          <label class="full">Description<input name="description" required /></label><label>Amount (GH₵)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Fund / account<select name="fund_id" required></select></label><label>Payment method<select name="payment_method">${optionList(METHODS)}</select></label>
          <label>Reference number<input name="reference_number" /></label><label>Requested by<input name="requested_by" required /></label>
          <label>Status<select name="status"><option>Pending</option><option data-approve-option>Approved</option><option data-approve-option>Paid</option></select></label>
          <label>Receipt / attachment URL<input name="receipt_url" type="url" /></label><label class="full">Notes<textarea name="notes"></textarea></label>
          <p class="full finance-form-error" id="financeExpenseError" hidden></p>
        </div>
        <div class="dialog-footer"><button class="secondary-btn" type="button" data-close-finance="financeExpenseDialog">Cancel</button><button class="primary-btn" type="submit">Save expense</button></div>
      </form></dialog>

      <dialog id="financeRemittanceDialog" class="finance-dialog"><form id="financeRemittanceForm">
        <div class="dialog-header"><div><p class="eyebrow">SEBREPOR DISTRICT</p><h3>Record remittance</h3></div><button class="icon-btn" type="button" data-close-finance="financeRemittanceDialog" aria-label="Close"><i data-lucide="x"></i></button></div>
        <div class="dialog-body"><label>Remittance date<input name="remittance_date" type="date" required /></label><label>Amount (GH₵)<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Payment method<select name="payment_method">${optionList(METHODS)}</select></label><label>Reference number<input name="reference_number" /></label><label class="full">Notes<textarea name="notes"></textarea></label><div class="full remittance-cap" id="financeRemittanceCap"></div><p class="full finance-form-error" id="financeRemittanceError" hidden></p></div>
        <div class="dialog-footer"><button class="secondary-btn" type="button" data-close-finance="financeRemittanceDialog">Cancel</button><button class="primary-btn" type="submit">Record remittance</button></div>
      </form></dialog>

      <dialog id="financeFundDialog" class="finance-dialog"><form id="financeFundForm">
        <div class="dialog-header"><div><p class="eyebrow">FUND / ACCOUNT</p><h3>Add fund</h3></div><button class="icon-btn" type="button" data-close-finance="financeFundDialog" aria-label="Close"><i data-lucide="x"></i></button></div>
        <div class="dialog-body"><label class="full">Fund name<input name="name" required /></label><label>Opening balance (GH₵)<input name="opening_balance" type="number" min="0" step="0.01" value="0" required /></label><label>Status<select name="is_active"><option value="true">Active</option><option value="false">Inactive</option></select></label><label class="full">Description<textarea name="description"></textarea></label><p class="full finance-form-error" id="financeFundError" hidden></p></div>
        <div class="dialog-footer"><button class="secondary-btn" type="button" data-close-finance="financeFundDialog">Cancel</button><button class="primary-btn" type="submit">Save fund</button></div>
      </form></dialog>

      <dialog id="financeTransferDialog" class="finance-dialog"><form id="financeTransferForm">
        <div class="dialog-header"><div><p class="eyebrow">FUND TRANSFER</p><h3>Transfer between funds</h3></div><button class="icon-btn" type="button" data-close-finance="financeTransferDialog" aria-label="Close"><i data-lucide="x"></i></button></div>
        <div class="dialog-body"><label>Transfer date<input name="transfer_date" type="date" required></label><label>Amount (GH₵)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>From fund<select name="from_fund_id" required></select></label><label>To fund<select name="to_fund_id" required></select></label><label>Reference number<input name="reference_number"></label><label class="full">Notes<textarea name="notes"></textarea></label><p class="full finance-form-error" id="financeTransferError" hidden></p></div>
        <div class="dialog-footer"><button class="secondary-btn" type="button" data-close-finance="financeTransferDialog">Cancel</button><button class="primary-btn" type="submit">Post transfer</button></div>
      </form></dialog>`;
  }

  function metric(label, value, note, icon, tone = "blue") {
    return `<article class="finance-metric ${tone}"><div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div><i data-lucide="${icon}"></i></article>`;
  }

  function districtTotals() {
    const due = state.collections.filter(accountedCollection).reduce((sum, item) => sum + num(item.district_share), 0);
    const remitted = state.remittances.filter(activeRemittance).reduce((sum, item) => sum + num(item.amount), 0);
    return { due, remitted, outstanding: Math.max(0, due - remitted) };
  }

  function collectionTotal(type = null) {
    return state.collections.filter(item => accountedCollection(item) && (!type || item.collection_type === type)).reduce((sum, item) => sum + num(item.amount), 0);
  }

  function currentChurchBalance() {
    const opening = state.funds.reduce((sum, item) => sum + num(item.opening_balance), 0);
    const ownedCollections = state.collections.filter(accountedCollection).reduce((sum, item) => sum + num(item.local_share), 0);
    const paid = state.expenses.filter(paidExpense).reduce((sum, item) => sum + num(item.amount), 0);
    const legacyNet = state.legacyTransactions.reduce((sum, item) => sum + (item.type === "Expense" ? -num(item.amount) : num(item.amount)), 0);
    return opening + ownedCollections - paid + legacyNet;
  }

  function startOfWeek(date) {
    const result = new Date(date); const day = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - day); result.setHours(0, 0, 0, 0); return result;
  }

  function comparisonRange(kind, customStart, customEnd) {
    const now = dateFromIso(todayIso()); let start; let end;
    if (kind === "week") { start = startOfWeek(now); end = new Date(start); end.setDate(end.getDate() + 6); }
    if (kind === "month") { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0); }
    if (kind === "quarter") { const month = Math.floor(now.getMonth() / 3) * 3; start = new Date(now.getFullYear(), month, 1); end = new Date(now.getFullYear(), month + 3, 0); }
    if (kind === "year") { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31); }
    if (kind === "custom") { start = dateFromIso(customStart || todayIso()); end = dateFromIso(customEnd || todayIso()); if (start > end) [start, end] = [end, start]; }
    const duration = Math.round((end - start) / 86400000) + 1;
    const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - duration + 1);
    return { start, end, previousStart, previousEnd };
  }

  function bucketKey(value, granularity) {
    const date = dateFromIso(value);
    if (granularity === "daily") return value;
    if (granularity === "weekly") return startOfWeek(date).toISOString().slice(0, 10);
    if (granularity === "monthly") return value.slice(0, 7);
    if (granularity === "quarterly") return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    return String(date.getFullYear());
  }

  function bucketLabel(key, granularity) {
    if (granularity === "daily" || granularity === "weekly") return new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short" }).format(dateFromIso(key));
    if (granularity === "monthly") return new Intl.DateTimeFormat("en-GH", { month: "short", year: "2-digit" }).format(dateFromIso(`${key}-01`));
    return key;
  }

  function aggregateSeries(records, granularity = "monthly", type = "all") {
    const totals = new Map();
    records.filter(accountedCollection).filter(item => type === "all" || item.collection_type === type).forEach(item => {
      const key = bucketKey(item.collection_date, granularity);
      totals.set(key, (totals.get(key) || 0) + num(item.amount));
    });
    return Array.from(totals, ([key, value]) => ({ key, label: bucketLabel(key, granularity), value })).sort((a, b) => a.key.localeCompare(b.key));
  }

  function growthData() {
    const type = $("#financeGrowthType")?.value || "all";
    const comparison = $("#financeComparison")?.value || "month";
    const range = comparisonRange(comparison, $("#financeCustomStart")?.value, $("#financeCustomEnd")?.value);
    const eligible = state.collections.filter(accountedCollection).filter(item => type === "all" || item.collection_type === type);
    const timestamp = value => dateFromIso(value).getTime();
    const totalWithin = (start, end) => eligible.filter(item => timestamp(item.collection_date) >= start.getTime() && timestamp(item.collection_date) <= end.getTime()).reduce((sum, item) => sum + num(item.amount), 0);
    const current = totalWithin(range.start, range.end); const previous = totalWithin(range.previousStart, range.previousEnd);
    const percentage = previous === 0 ? (current === 0 ? 0 : null) : (current - previous) / previous * 100;
    return { current, previous, percentage, type, comparison, range };
  }

  function renderGrowthChart() {
    const container = $("#financeTrendChart"); if (!container) return;
    const granularity = $("#financeGranularity")?.value || "monthly";
    const type = $("#financeGrowthType")?.value || "all";
    const series = aggregateSeries(state.collections, granularity, type).slice(-12);
    const growth = growthData();
    const direction = growth.percentage === null || growth.percentage > 0 ? "increase" : growth.percentage < 0 ? "decrease" : "stable";
    const readableType = type === "all" ? "Collections" : type;
    const growthText = growth.percentage === null ? "Increase from zero" : `${Math.abs(growth.percentage).toFixed(1)}% ${direction === "stable" ? "Stable" : direction === "increase" ? "Increase" : "Decrease"}`;
    $("#financeCurrentPeriod").textContent = money.format(growth.current);
    $("#financePreviousPeriod").textContent = money.format(growth.previous);
    const badge = $("#financeGrowthBadge"); badge.className = `growth-badge ${direction}`; badge.innerHTML = `<i data-lucide="${direction === "increase" ? "trending-up" : direction === "decrease" ? "trending-down" : "minus"}"></i>${esc(growthText)}`;
    const summary = direction === "increase" ? `${readableType} are growing. ${growth.percentage === null ? "The current period has collections while the previous period had none." : `Total collections increased by ${Math.abs(growth.percentage).toFixed(1)}% compared with the previous period.`}` : direction === "decrease" ? `${readableType} are decreasing. Total collections decreased by ${Math.abs(growth.percentage).toFixed(1)}% compared with the previous period.` : `${readableType} are stable. Total collections have remained unchanged compared with the previous period.`;
    $("#financeGrowthSummary").textContent = summary;
    if (!series.length) { container.innerHTML = `<div class="finance-empty"><i data-lucide="chart-no-axes-combined"></i><p>No verified collection data is available for this chart.</p></div>`; refreshIcons(); return; }
    const width = 760, height = 260, left = 64, right = 20, top = 28, bottom = 47;
    const max = Math.max(...series.map(item => item.value), 1);
    const points = series.map((item, index) => ({ ...item, x: left + (series.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (series.length - 1)), y: top + (max - item.value) / max * (height - top - bottom) }));
    const grid = [0, .25, .5, .75, 1].map(fraction => { const y = top + fraction * (height - top - bottom); const value = max * (1 - fraction); return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="${left - 9}" y="${y + 4}" text-anchor="end">${esc(compactMoney.format(value))}</text>`; }).join("");
    const line = points.map(point => `${point.x},${point.y}`).join(" ");
    const area = `${left},${height - bottom} ${line} ${points.at(-1).x},${height - bottom}`;
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(readableType)} trend"><g class="finance-chart-grid">${grid}</g><polygon class="finance-chart-area" points="${area}"/><polyline class="finance-chart-line" points="${line}"/>${points.map(point => `<g><circle cx="${point.x}" cy="${point.y}" r="5"><title>${esc(point.label)}: ${money.format(point.value)}</title></circle><text class="finance-chart-value" x="${point.x}" y="${point.y - 12}" text-anchor="middle">${esc(compactMoney.format(point.value))}</text><text class="finance-chart-label" x="${point.x}" y="${height - 19}" text-anchor="middle">${esc(point.label)}</text></g>`).join("")}</svg>`;
    refreshIcons();
  }

  function dashboardMarkup() {
    const district = districtTotals();
    const expenses = state.expenses.filter(paidExpense).reduce((sum, item) => sum + num(item.amount), 0) + state.legacyTransactions.filter(item => item.type === "Expense").reduce((sum,item)=>sum+num(item.amount),0);
    return `<div class="finance-metric-grid">
      ${metric("Total Collections", money.format(collectionTotal()), `${state.collections.filter(accountedCollection).length} accounted records`, "hand-coins", "green")}
      ${metric("Total Tithes", money.format(collectionTotal("Tithe")), "Member giving", "badge-cent", "blue")}
      ${metric("Total VTO", money.format(collectionTotal("Vote of Thanks (VTO)")), "Vote of Thanks", "heart-handshake", "red")}
      ${metric("Children's Offertory", money.format(collectionTotal("Children's Service Offertory")), "Children's service", "baby", "orange")}
      ${metric("Junior Youth (JY)", money.format(collectionTotal("Junior Youth (JY)")), "JY collections", "users-round", "blue")}
      ${metric("Adult Offertory", money.format(collectionTotal("Adult Offertory")), "Sunday adult offertory", "church", "green")}
      ${metric("Total Expenses", money.format(expenses), "Paid expenses and posted legacy expenses", "receipt", "red")}
      ${metric("Current Church Balance", money.format(currentChurchBalance()), "Opening balances + church shares + legacy net − paid expenses", "landmark", "blue")}
      ${metric("District Amount Due", money.format(district.due), "Calculated distribution shares", "building-2", "orange")}
      ${metric("District Amount Remitted", money.format(district.remitted), "Non-voided remittances", "send", "green")}
      ${metric("Outstanding District Balance", money.format(district.outstanding), "Payable to Sebrepor District", "circle-alert", district.outstanding ? "red" : "green")}
    </div>
    <div class="finance-dashboard-grid">
      <article class="card finance-trend-card"><div class="finance-card-heading"><div><p class="eyebrow">FINANCIAL GROWTH</p><h3>Collections over time</h3></div><div class="finance-chart-controls"><select id="financeGrowthType" aria-label="Collection type"><option value="all">All Collections</option>${optionList(COLLECTION_TYPES)}</select><select id="financeGranularity" aria-label="Chart period"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div></div>
        <div class="finance-comparison-controls"><select id="financeComparison"><option value="week">This week vs last week</option><option value="month" selected>This month vs last month</option><option value="quarter">This quarter vs previous quarter</option><option value="year">This year vs previous year</option><option value="custom">Custom range vs previous equivalent</option></select><div id="financeCustomRange" hidden><input id="financeCustomStart" type="date" aria-label="Custom start date"><input id="financeCustomEnd" type="date" aria-label="Custom end date"></div></div>
        <div id="financeTrendChart" class="finance-trend-chart"></div>
        <div class="growth-stat-grid"><div><span>Current period</span><strong id="financeCurrentPeriod">GH₵0.00</strong></div><div><span>Previous period</span><strong id="financePreviousPeriod">GH₵0.00</strong></div><div><span>Growth</span><strong class="growth-badge stable" id="financeGrowthBadge">0% Stable</strong></div></div>
        <p class="finance-growth-summary" id="financeGrowthSummary"></p>
      </article>
      <article class="card finance-side-card"><div class="finance-card-heading"><div><p class="eyebrow">ACCOUNTABILITY</p><h3>District position</h3></div></div><div class="district-rule-summary">${rule() ? `<div class="rule-split"><span><b>${num(rule().local_percentage)}%</b> Local Church</span><span><b>${num(rule().district_percentage)}%</b> ${esc(rule().district_name)}</span></div><p>Active distribution rule for Adult Offertory.</p>` : `<div class="finance-empty compact"><p>No active Adult Offertory distribution rule.</p></div>`}</div><div class="district-progress"><div><span>Remittance progress</span><strong>${district.due ? Math.min(100, district.remitted / district.due * 100).toFixed(1) : "0.0"}%</strong></div><progress value="${district.remitted}" max="${Math.max(district.due, 1)}"></progress></div><button class="secondary-btn full-btn" type="button" data-finance-open="remittance" ${!can("finance.manage") || !district.outstanding ? "disabled" : ""}><i data-lucide="send"></i> Record district remittance</button></article>
    </div>`;
  }

  function collectionFiltersMarkup() {
    return `<div class="finance-filters"><label class="finance-search"><i data-lucide="search"></i><input id="financeRecordSearch" type="search" placeholder="Search reference, member, service, or notes…"></label><input id="financeDateFrom" type="date" aria-label="From date"><input id="financeDateTo" type="date" aria-label="To date"><select id="financeStatusFilter" aria-label="Status"><option value="all">All statuses</option>${optionList(["Pending","Counted","Verified","Deposited","Reconciled","Voided"])}</select></div>`;
  }

  function filteredCollections() {
    const forced = sectionTypes[state.section]; const search = ($("#financeRecordSearch")?.value || "").trim().toLowerCase();
    const from = $("#financeDateFrom")?.value || ""; const to = $("#financeDateTo")?.value || ""; const status = $("#financeStatusFilter")?.value || "all";
    return state.collections.filter(item => !forced || item.collection_type === forced).filter(item => !from || item.collection_date >= from).filter(item => !to || item.collection_date <= to).filter(item => status === "all" || item.status === status).filter(item => {
      const member = relation(item, "members") || state.members.find(entry => entry.id === item.member_id);
      const event = relation(item, "events") || state.events.find(entry => entry.id === item.event_id);
      return !search || [item.collection_type, item.reference_number, item.description, item.occasion, fullName(member), event?.title].join(" ").toLowerCase().includes(search);
    }).sort((a, b) => b.collection_date.localeCompare(a.collection_date) || b.created_at.localeCompare(a.created_at));
  }

  function collectionTableMarkup() {
    const records = filteredCollections(); const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE)); state.page = Math.min(state.page, pages);
    const rows = records.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    return `<div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>Collection</th><th>Member / Service</th><th>Method</th><th>Status</th><th>Amount</th><th>Distribution</th><th>Recorded by</th><th></th></tr></thead><tbody>${rows.length ? rows.map(item => {
      const member = relation(item, "members") || state.members.find(entry => entry.id === item.member_id); const event = relation(item, "events") || state.events.find(entry => entry.id === item.event_id);
      const action = can("finance.manage") && item.status !== "Voided" ? `<div class="row-actions">${item.status === "Pending" ? `<button class="icon-btn" data-finance-count="${item.id}" title="Mark counted"><i data-lucide="check"></i></button>` : ""}${item.status === "Counted" && can("finance.verify") ? `<button class="icon-btn" data-finance-verify="${item.id}" title="Verify"><i data-lucide="badge-check"></i></button>` : ""}<button class="icon-btn delete" data-finance-void="collection:${item.id}" title="Void record"><i data-lucide="ban"></i></button></div>` : "";
      return `<tr><td>${formatDate(item.collection_date)}</td><td><strong>${esc(item.collection_type)}</strong><small>${esc(item.occasion || item.reference_number || "No reference")}</small></td><td><span>${esc(member ? fullName(member) : "General collection")}</span><small>${esc(event?.title || "No linked service")}</small></td><td>${esc(item.collection_method)}</td><td><span class="finance-status ${item.status.toLowerCase()}">${esc(item.status)}</span></td><td class="finance-money">${money.format(num(item.amount))}</td><td>${num(item.district_share) ? `<small>Church ${money.format(num(item.local_share))}<br>${esc(item.district_name_snapshot)} ${money.format(num(item.district_share))}</small>` : "—"}</td><td>${esc(item.recorded_by_name || "Finance officer")}</td><td>${action}</td></tr>`;
    }).join("") : `<tr><td colspan="9"><div class="finance-empty"><i data-lucide="receipt-text"></i><p>No collection records match these filters.</p></div></td></tr>`}</tbody></table></div><div class="table-footer"><span>${records.length} collection record${records.length === 1 ? "" : "s"}</span><div class="pagination"><button type="button" data-finance-page="previous" ${state.page === 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button><button class="active" type="button">${state.page}</button><button type="button" data-finance-page="next" ${state.page === pages ? "disabled" : ""}><i data-lucide="chevron-right"></i></button></div></div>`;
  }

  function collectionsMarkup() {
    const forced = sectionTypes[state.section]; const records = state.collections.filter(item => !forced || item.collection_type === forced).filter(accountedCollection);
    const total = records.reduce((sum, item) => sum + num(item.amount), 0);
    const currentMonth = todayIso().slice(0, 7); const monthTotal = records.filter(item => item.collection_date.startsWith(currentMonth)).reduce((sum, item) => sum + num(item.amount), 0);
    const memberCount = new Set(records.map(item => item.member_id).filter(Boolean)).size;
    return `<div class="finance-summary-strip">${metric(forced ? `${forced} total` : "All collections", money.format(total), "Accounted, non-voided records", "hand-coins", "green")}${metric("This month", money.format(monthTotal), currentMonth, "calendar-range", "blue")}${metric("Records", String(records.length), `${memberCount} linked member${memberCount === 1 ? "" : "s"}`, "list-checks", "orange")}${forced === "Adult Offertory" ? metric("District share", money.format(records.reduce((sum,item)=>sum+num(item.district_share),0)), "Historical rule snapshots", "building-2", "red") : metric("Pending", String(state.collections.filter(item => (!forced || item.collection_type === forced) && item.status === "Pending").length), "Awaiting counting", "clock-3", "orange")}</div><article class="card finance-record-card">${collectionFiltersMarkup()}<div id="financeCollectionTable">${collectionTableMarkup()}</div></article>`;
  }

  function remittanceMarkup() {
    const district = districtTotals();
    return `<div class="finance-summary-strip">${metric("Amount Due", money.format(district.due), "Adult Offertory district shares", "building-2", "orange")}${metric("Amount Remitted", money.format(district.remitted), "Submitted and verified", "send", "green")}${metric("Outstanding", money.format(district.outstanding), "Cannot be overpaid", "circle-alert", district.outstanding ? "red" : "green")}</div><article class="card finance-record-card"><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>District</th><th>Method</th><th>Reference</th><th>Status</th><th>Remitted by</th><th>Amount</th><th></th></tr></thead><tbody>${state.remittances.length ? state.remittances.slice().sort((a,b)=>b.remittance_date.localeCompare(a.remittance_date)).map(item => `<tr><td>${formatDate(item.remittance_date)}</td><td>${esc(item.district_name)}</td><td>${esc(item.payment_method)}</td><td>${esc(item.reference_number || "—")}</td><td><span class="finance-status ${item.status.toLowerCase()}">${esc(item.status)}</span></td><td>${esc(item.remitted_by_name)}</td><td class="finance-money">${money.format(num(item.amount))}</td><td>${can("finance.manage") && item.status !== "Voided" ? `<button class="icon-btn delete" data-finance-void="remittance:${item.id}" title="Void remittance"><i data-lucide="ban"></i></button>` : ""}</td></tr>`).join("") : `<tr><td colspan="8"><div class="finance-empty"><i data-lucide="send"></i><p>No district remittances recorded.</p></div></td></tr>`}</tbody></table></div></article>`;
  }

  function expenseMarkup() {
    const totals = status => state.expenses.filter(item => !status || item.status === status).reduce((sum,item)=>sum+num(item.amount),0);
    return `<div class="finance-summary-strip">${metric("Pending", money.format(totals("Pending")), "Awaiting approval", "clock-3", "orange")}${metric("Approved", money.format(totals("Approved")), "Approved, not yet paid", "badge-check", "blue")}${metric("Paid", money.format(totals("Paid")), "Affects official balance", "circle-check", "green")}</div><article class="card finance-record-card"><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Fund</th><th>Requested by</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>${state.expenses.length ? state.expenses.slice().sort((a,b)=>b.expense_date.localeCompare(a.expense_date)).map(item => { const fund = relation(item,"finance_funds") || state.funds.find(entry=>entry.id===item.fund_id); return `<tr><td>${formatDate(item.expense_date)}</td><td><strong>${esc(item.description)}</strong><small>${esc(item.reference_number || item.payment_method)}</small></td><td>${esc(item.category)}</td><td>${esc(fund?.name || "—")}</td><td>${esc(item.requested_by)}</td><td><span class="finance-status ${item.status.toLowerCase()}">${esc(item.status)}</span></td><td class="finance-money">${money.format(num(item.amount))}</td><td>${item.status !== "Voided" ? `<div class="row-actions">${can("finance.approve") && item.status === "Pending" ? `<button class="icon-btn" data-finance-expense-status="Approved:${item.id}" title="Approve"><i data-lucide="badge-check"></i></button>` : ""}${can("finance.approve") && item.status === "Approved" ? `<button class="icon-btn" data-finance-expense-status="Paid:${item.id}" title="Mark paid"><i data-lucide="circle-check"></i></button>` : ""}${can("finance.manage") ? `<button class="icon-btn delete" data-finance-void="expense:${item.id}" title="Void"><i data-lucide="ban"></i></button>` : ""}</div>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="8"><div class="finance-empty"><i data-lucide="receipt"></i><p>No expenses recorded.</p></div></td></tr>`}</tbody></table></div></article>`;
  }

  function fundBalance(fund) {
    const legacyForFund = state.legacyTransactions.filter(item => item.fund === fund.name);
    const income = state.collections.filter(item => accountedCollection(item) && item.fund_id === fund.id).reduce((sum,item)=>sum+num(item.local_share),0) + legacyForFund.filter(item=>item.type==="Income").reduce((sum,item)=>sum+num(item.amount),0);
    const expenses = state.expenses.filter(item => paidExpense(item) && item.fund_id === fund.id).reduce((sum,item)=>sum+num(item.amount),0) + legacyForFund.filter(item=>item.type==="Expense").reduce((sum,item)=>sum+num(item.amount),0);
    const transfersIn = state.transfers.filter(item => item.status === "Posted" && item.to_fund_id === fund.id).reduce((sum,item)=>sum+num(item.amount),0);
    const transfersOut = state.transfers.filter(item => item.status === "Posted" && item.from_fund_id === fund.id).reduce((sum,item)=>sum+num(item.amount),0);
    return { income, expenses, transfersIn, transfersOut, current: num(fund.opening_balance) + income - expenses + transfersIn - transfersOut };
  }

  function fundsMarkup() {
    return `<div class="finance-fund-actions"><button class="secondary-btn" type="button" data-finance-open="transfer" ${!can("finance.manage") || state.funds.filter(item=>item.is_active).length<2?"disabled":""}><i data-lucide="arrow-left-right"></i> Transfer between funds</button></div><div class="finance-fund-grid">${state.funds.length ? state.funds.map(fund => { const totals=fundBalance(fund); return `<article class="card finance-fund"><div><span class="finance-status ${fund.is_active ? "verified" : "voided"}">${fund.is_active ? "Active" : "Inactive"}</span><h3>${esc(fund.name)}</h3><p>${esc(fund.description || "Church fund or designated account")}</p></div><strong>${money.format(totals.current)}</strong><dl><div><dt>Opening</dt><dd>${money.format(num(fund.opening_balance))}</dd></div><div><dt>Income</dt><dd>${money.format(totals.income)}</dd></div><div><dt>Expenses</dt><dd>${money.format(totals.expenses)}</dd></div><div><dt>Transfers in</dt><dd>${money.format(totals.transfersIn)}</dd></div><div><dt>Transfers out</dt><dd>${money.format(totals.transfersOut)}</dd></div></dl></article>`; }).join("") : `<article class="card finance-empty"><p>No funds configured.</p></article>`}</div><article class="card finance-record-card finance-transfer-history"><div class="finance-card-heading"><div><p class="eyebrow">TRANSFER HISTORY</p><h3>Fund transfers</h3></div></div><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>From</th><th>To</th><th>Reference</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>${state.transfers.length?state.transfers.map(item=>{const from=relation(item,"from_fund")||state.funds.find(f=>f.id===item.from_fund_id);const to=relation(item,"to_fund")||state.funds.find(f=>f.id===item.to_fund_id);return `<tr><td>${formatDate(item.transfer_date)}</td><td>${esc(from?.name||"—")}</td><td>${esc(to?.name||"—")}</td><td>${esc(item.reference_number||"—")}</td><td><span class="finance-status ${item.status.toLowerCase()}">${esc(item.status)}</span></td><td class="finance-money">${money.format(num(item.amount))}</td><td>${can("finance.manage")&&item.status!=="Voided"?`<button class="icon-btn delete" data-finance-void="transfer:${item.id}" title="Void transfer"><i data-lucide="ban"></i></button>`:""}</td></tr>`}).join(""):`<tr><td colspan="7"><div class="finance-empty compact"><p>No fund transfers recorded.</p></div></td></tr>`}</tbody></table></div></article>`;
  }

  function reportsMarkup() {
    const district=districtTotals(); const total=collectionTotal(); const expense=state.expenses.filter(paidExpense).reduce((s,i)=>s+num(i.amount),0)+state.legacyTransactions.filter(i=>i.type==="Expense").reduce((s,i)=>s+num(i.amount),0);
    return `<div class="finance-report-actions"><button class="secondary-btn" id="financePrintReport" type="button"><i data-lucide="printer"></i> Print</button><button class="secondary-btn" id="financeExportReport" type="button"><i data-lucide="download"></i> Export collections CSV</button></div><div class="finance-summary-strip">${metric("Collection Report",money.format(total),"All accounted classified collections","hand-coins","green")}${metric("Expense Report",money.format(expense),"Paid and legacy posted expenses","receipt","red")}${metric("Net Church Position",money.format(currentChurchBalance()),"Owned funds after paid expenses","landmark","blue")}${metric("District Outstanding",money.format(district.outstanding),"Sebrepor District","building-2","orange")}</div><div class="finance-report-grid">${COLLECTION_TYPES.map(type=>{const value=collectionTotal(type);return `<article class="card"><span>${esc(type)} Report</span><strong>${money.format(value)}</strong><small>${state.collections.filter(item=>accountedCollection(item)&&item.collection_type===type).length} records</small></article>`}).join("")}<article class="card district-report"><span>District Remittance Report</span><strong>${money.format(district.remitted)} remitted</strong><small>${money.format(collectionTotal("Adult Offertory"))} Adult Offertory · ${money.format(state.collections.filter(accountedCollection).reduce((s,i)=>s+num(i.local_share),0))} local shares · ${money.format(district.due)} district shares · ${money.format(district.outstanding)} outstanding</small></article></div>${legacyLedgerMarkup()}`;
  }

  function legacyLedgerMarkup(){if(!state.legacyTransactions.length)return "";return `<article class="card finance-record-card finance-legacy-ledger"><div class="finance-card-heading"><div><p class="eyebrow">COMPATIBILITY</p><h3>Legacy transaction ledger</h3><p>Preserved from the original Finance module. These records affect balances but are not guessed into collection categories.</p></div></div><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>Description</th><th>Fund</th><th>Type</th><th>Amount</th></tr></thead><tbody>${state.legacyTransactions.slice().sort((a,b)=>b.transaction_date.localeCompare(a.transaction_date)).map(item=>`<tr><td>${formatDate(item.transaction_date)}</td><td>${esc(item.description)}</td><td>${esc(item.fund)}</td><td><span class="finance-status ${item.type.toLowerCase()}">${esc(item.type)}</span></td><td class="finance-money">${item.type==="Expense"?"−":"+"}${money.format(num(item.amount))}</td></tr>`).join("")}</tbody></table></div></article>`;}

  function settingsMarkup() {
    const activeRule=rule();
    return `<div class="finance-settings-grid"><article class="card"><div class="finance-card-heading"><div><p class="eyebrow">DISTRIBUTION</p><h3>Adult Offertory rule</h3></div></div>${activeRule ? `<form id="financeRuleForm" class="finance-settings-form"><input type="hidden" name="id" value="${activeRule.id}"><label>Collection type<input value="Adult Offertory" disabled></label><label>District name<input name="district_name" value="${esc(activeRule.district_name)}" required></label><label>Local Church (%)<input name="local_percentage" type="number" min="0" max="100" step="0.01" value="${num(activeRule.local_percentage)}" required></label><label>District (%)<input name="district_percentage" type="number" min="0" max="100" step="0.01" value="${num(activeRule.district_percentage)}" required></label><label>Enabled<select name="enabled"><option value="true" ${activeRule.enabled?"selected":""}>Yes</option><option value="false" ${!activeRule.enabled?"selected":""}>No</option></select></label><p class="full distribution-total" id="financeRuleTotal"></p><p class="full finance-form-error" id="financeRuleError" hidden></p><button class="primary-btn full" type="submit" ${!can("finance.settings")?"disabled":""}>Save distribution rule</button></form>` : `<div class="finance-empty"><p>No Adult Offertory rule is available. Apply the latest Supabase migration.</p></div>`}</article><article class="card finance-integrity-card"><p class="eyebrow">FINANCIAL INTEGRITY</p><h3>Enforced in Supabase</h3><ul><li>Amounts must be greater than zero.</li><li>Enabled distribution percentages must total exactly 100%.</li><li>Each Adult Offertory stores its historical rule snapshot.</li><li>Remittances cannot exceed the outstanding district balance.</li><li>Financial records are voided, never permanently deleted.</li><li>Creates, updates, approvals, payments, remittances, and voids are audited.</li></ul></article></div>`;
  }

  function auditMarkup() {
    if (!can("finance.audit")) return `<article class="card finance-empty"><i data-lucide="shield-alert"></i><p>Your role does not provide access to the financial audit trail.</p></article>`;
    return `<article class="card finance-record-card"><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date/time</th><th>Action</th><th>Record type</th><th>Record ID</th><th>User</th><th>Change summary</th></tr></thead><tbody>${state.audit.length ? state.audit.map(item=>`<tr><td>${dateTimeFormat.format(new Date(item.occurred_at))}</td><td><span class="finance-status ${item.action.toLowerCase()}">${esc(item.action)}</span></td><td>${esc(item.table_name.replace("finance_","").replaceAll("_"," "))}</td><td><code>${esc(item.record_id.slice(0,8))}</code></td><td>${item.user_id===state.userId?"Current user":esc(item.user_id?.slice(0,8)||"System")}</td><td>${esc(auditSummary(item))}</td></tr>`).join("") : `<tr><td colspan="6"><div class="finance-empty"><i data-lucide="history"></i><p>No finance audit activity recorded.</p></div></td></tr>`}</tbody></table></div></article>`;
  }

  function auditSummary(item) {
    const before=item.previous_value||{}, after=item.new_value||{}; const changed=Object.keys(after).filter(key=>JSON.stringify(after[key])!==JSON.stringify(before[key])&&!['updated_at'].includes(key));
    return item.action === "Created" || item.action === "Remitted" ? `Created ${item.table_name.replace("finance_","").replaceAll("_"," ")} record` : changed.length ? `Changed ${changed.slice(0,4).join(", ")}${changed.length>4?"…":""}` : item.action;
  }

  function render() {
    const content=$("#financeContent"); if(!content) return;
    const details={dashboard:["Dashboard","Finance & stewardship","Accountable church collections, expenses, funds, remittance, and reporting."],collections:["Collections","Collections","Record and reconcile all church collection types."],tithes:["Tithes","Tithe management","Member-linked tithe history and totals."],vto:["Vote of Thanks (VTO)","Vote of Thanks (VTO)","Track thanksgiving giving and occasions."],children:["Children's Service Offertory","Children's Service Offertory","Keep children's collections separate and accountable."],jy:["Junior Youth (JY)","Junior Youth (JY)","JY collection records and reporting."],adult:["Adult Offertory","Adult Offertory","Automatic Local Church and Sebrepor District distribution."],remittances:["District Remittance","District Remittance","Track amounts due, remitted, and outstanding."],expenses:["Expenses","Expenses","Pending → Approved → Paid expense workflow."],funds:["Funds / Accounts","Funds / Accounts","Track restricted and unrestricted church funds."],reports:["Financial Reports","Financial Reports","Clear collection, expense, fund, and remittance reporting."],settings:["Finance Settings","Finance Settings","Configure the Adult Offertory distribution rule."],audit:["Audit Trail","Finance Audit Trail","Immutable accountability history for financial actions."]}[state.section];
    $("#financeBreadcrumbSection").textContent=details[0]; $("#financeSectionTitle").textContent=details[1]; $("#financeSectionDescription").textContent=details[2];
    $$("[data-finance-tab]").forEach(button=>button.classList.toggle("active",button.dataset.financeTab===state.section));
    const primary=$("#financePrimaryAction"); primary.hidden=!can("finance.manage") && !(state.section==="funds"&&can("finance.settings"));
    if(state.section==="remittances"){primary.innerHTML='<i data-lucide="send"></i> Record remittance';primary.dataset.financeAction="remittance";}
    else if(state.section==="expenses"){primary.innerHTML='<i data-lucide="plus"></i> Record expense';primary.dataset.financeAction="expense";}
    else if(state.section==="funds"){primary.hidden=!can("finance.settings");primary.innerHTML='<i data-lucide="plus"></i> Add fund';primary.dataset.financeAction="fund";}
    else if(["settings","audit","reports","dashboard"].includes(state.section)){primary.hidden=true;primary.dataset.financeAction="";}
    else {primary.innerHTML='<i data-lucide="plus"></i> Record collection';primary.dataset.financeAction="collection";}
    if(state.loading){content.innerHTML='<div class="finance-loading"><span></span><p>Loading secure financial records…</p></div>';refreshIcons();return;}
    content.innerHTML=state.section==="dashboard"?dashboardMarkup():["collections","tithes","vto","children","jy","adult"].includes(state.section)?collectionsMarkup():state.section==="remittances"?remittanceMarkup():state.section==="expenses"?expenseMarkup():state.section==="funds"?fundsMarkup():state.section==="reports"?reportsMarkup():state.section==="settings"?settingsMarkup():auditMarkup();
    if(state.section==="dashboard") renderGrowthChart();
    if(state.section==="settings") updateRuleTotal();
    refreshIcons();
  }

  function setMessage(message="",type="error") { const node=$("#financeMessage"); if(!node)return; node.hidden=!message; node.className=`finance-message ${type}`; node.textContent=message; }

  async function load() {
    if(!state.client||!can("finance.view")) return;
    state.loading=true; setMessage(); render();
    const queries=[
      state.client.from("finance_funds").select("*").order("name"),
      state.client.from("finance_distribution_rules").select("*").order("updated_at",{ascending:false}),
      state.client.from("finance_collections").select("*,members(id,first_name,last_name),events(id,title,event_date),finance_funds(id,name)").order("collection_date",{ascending:false}),
      state.client.from("finance_expenses").select("*,finance_funds(id,name)").order("expense_date",{ascending:false}),
      state.client.from("finance_remittances").select("*").order("remittance_date",{ascending:false}),
      state.client.from("finance_fund_transfers").select("*,from_fund:finance_funds!finance_fund_transfers_from_fund_id_fkey(id,name),to_fund:finance_funds!finance_fund_transfers_to_fund_id_fkey(id,name)").order("transfer_date",{ascending:false})
    ];
    if(can("finance.audit")) queries.push(state.client.from("finance_audit_log").select("*").order("occurred_at",{ascending:false}).limit(500));
    const results=await Promise.all(queries); const failed=results.find(result=>result.error);
    state.loading=false;
    if(failed){setMessage(`Unable to load finance records. Confirm the latest Supabase finance migration has been applied. ${failed.error.message}`);render();return;}
    [state.funds,state.rules,state.collections,state.expenses,state.remittances,state.transfers]=results.slice(0,6).map(result=>result.data||[]); state.audit=results[6]?.data||[]; render();
  }

  function populateForms(type) {
    const form=type==="collection"?$("#financeCollectionForm"):type==="expense"?$("#financeExpenseForm"):null;
    if(form){const fundSelect=form.elements.fund_id;fundSelect.innerHTML=state.funds.filter(item=>item.is_active).map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join("");}
    if(type==="collection"){
      form.elements.event_id.innerHTML='<option value="">No linked service</option>'+state.events.slice().sort((a,b)=>b.event_date.localeCompare(a.event_date)).map(item=>`<option value="${item.id}">${esc(item.title)} · ${formatDate(item.event_date)}</option>`).join("");
      form.elements.member_id.innerHTML='<option value="">Not member-specific</option>'+state.members.slice().sort((a,b)=>fullName(a).localeCompare(fullName(b))).map(item=>`<option value="${item.id}">${esc(fullName(item))}</option>`).join("");
      const forced=sectionTypes[state.section]; form.elements.collection_type.value=forced||"Tithe"; form.elements.collection_type.disabled=Boolean(forced);
      form.elements.collection_date.value=todayIso(); form.elements.status.value="Pending"; form.reset(); form.elements.collection_date.value=todayIso(); form.elements.collection_type.value=forced||"Tithe"; form.elements.collection_type.disabled=Boolean(forced);
      $$('[data-verify-option]',form).forEach(option=>option.disabled=!can("finance.verify")); updateCollectionConditionalFields();
    }
    if(type==="expense"){form.reset();form.elements.expense_date.value=todayIso();$$('[data-approve-option]',form).forEach(option=>option.disabled=!can("finance.approve"));}
  }

  function openForm(type) {
    if(type!=="fund"&&!can("finance.manage")) return notify("You do not have permission to manage finance records.","error");
    if(type==="fund"&&!can("finance.settings")) return notify("Finance settings permission is required.","error");
    if(type==="remittance"){$("#financeRemittanceForm").reset();$("#financeRemittanceForm").elements.remittance_date.value=todayIso();const outstanding=districtTotals().outstanding;$("#financeRemittanceForm").elements.amount.max=String(outstanding);$("#financeRemittanceCap").textContent=`Outstanding balance: ${money.format(outstanding)}`;$("#financeRemittanceDialog").showModal();}
    if(type==="collection"){if(!state.funds.some(item=>item.is_active))return notify("Create an active fund before recording collections.","error");populateForms("collection");$("#financeCollectionDialog").showModal();}
    if(type==="expense"){if(!state.funds.some(item=>item.is_active))return notify("Create an active fund before recording expenses.","error");populateForms("expense");$("#financeExpenseDialog").showModal();}
    if(type==="fund"){$("#financeFundForm").reset();$("#financeFundDialog").showModal();}
    if(type==="transfer"){const form=$("#financeTransferForm");form.reset();form.elements.transfer_date.value=todayIso();const options=state.funds.filter(item=>item.is_active).map(item=>`<option value="${item.id}">${esc(item.name)} · ${money.format(fundBalance(item).current)}</option>`).join("");form.elements.from_fund_id.innerHTML=options;form.elements.to_fund_id.innerHTML=options;if(form.elements.to_fund_id.options.length>1)form.elements.to_fund_id.selectedIndex=1;$("#financeTransferDialog").showModal();}
    refreshIcons();
  }

  function updateCollectionConditionalFields() {
    const form=$("#financeCollectionForm"); if(!form)return; const type=form.elements.collection_type.value; const amount=num(form.elements.amount.value); const activeRule=rule();
    $("#financeOccasionField").hidden=type!=="Vote of Thanks (VTO)"; form.elements.occasion.required=type==="Vote of Thanks (VTO)";
    const preview=$("#financeDistributionPreview"); preview.hidden=type!=="Adult Offertory";
    if(type==="Adult Offertory") { const localShare=Math.round(amount*num(activeRule?.local_percentage)/100*100)/100; const districtShare=amount-localShare; preview.innerHTML=activeRule?`<strong>Automatic distribution</strong><div><span>Local Church — ${num(activeRule.local_percentage)}%<b>${money.format(localShare)}</b></span><span>${esc(activeRule.district_name)} — ${num(activeRule.district_percentage)}%<b>${money.format(districtShare)}</b></span></div><small>Total: ${money.format(amount)}</small>`:`<strong>No active Adult Offertory distribution rule.</strong>`; }
  }

  function formError(id,message="") {const node=$(id);node.hidden=!message;node.textContent=message;}

  async function saveCollection(event) {
    event.preventDefault();const form=event.currentTarget;formError("#financeCollectionError");const values=Object.fromEntries(new FormData(form).entries());if(form.elements.collection_type.disabled)values.collection_type=form.elements.collection_type.value;
    const amount=num(values.amount);if(amount<=0)return formError("#financeCollectionError","Amount must be greater than zero.");if(values.collection_type==="Adult Offertory"&&!rule())return formError("#financeCollectionError","Enable the Adult Offertory distribution rule first.");
    const payload={...values,amount,event_id:values.event_id||null,member_id:values.member_id||null,reference_number:values.reference_number.trim()||null,occasion:values.collection_type==="Vote of Thanks (VTO)"?values.occasion:null,description:values.description.trim()};
    const {error}=await state.client.from("finance_collections").insert(payload);if(error)return formError("#financeCollectionError",error.message);$("#financeCollectionDialog").close();notify("Collection recorded with database-verified calculations.");await load();
  }

  async function saveExpense(event) {
    event.preventDefault();formError("#financeExpenseError");const values=Object.fromEntries(new FormData(event.currentTarget).entries());if(num(values.amount)<=0)return formError("#financeExpenseError","Amount must be greater than zero.");
    const payload={...values,amount:num(values.amount),reference_number:values.reference_number.trim()||null,receipt_url:values.receipt_url.trim()||null};const {error}=await state.client.from("finance_expenses").insert(payload);if(error)return formError("#financeExpenseError",error.message);$("#financeExpenseDialog").close();notify("Expense recorded in the approval workflow.");await load();
  }

  async function saveRemittance(event) {
    event.preventDefault();formError("#financeRemittanceError");const values=Object.fromEntries(new FormData(event.currentTarget).entries());const amount=num(values.amount);if(amount<=0)return formError("#financeRemittanceError","Amount must be greater than zero.");if(amount>districtTotals().outstanding)return formError("#financeRemittanceError","Amount cannot exceed the outstanding district balance.");
    const {error}=await state.client.rpc("record_finance_remittance",{p_remittance_date:values.remittance_date,p_amount:amount,p_payment_method:values.payment_method,p_reference_number:values.reference_number||null,p_notes:values.notes||""});if(error)return formError("#financeRemittanceError",error.message);$("#financeRemittanceDialog").close();notify("District remittance recorded.");await load();
  }

  async function saveFund(event) {event.preventDefault();formError("#financeFundError");const values=Object.fromEntries(new FormData(event.currentTarget).entries());const {error}=await state.client.from("finance_funds").insert({...values,opening_balance:num(values.opening_balance),is_active:values.is_active==="true"});if(error)return formError("#financeFundError",error.message);$("#financeFundDialog").close();notify("Fund created.");await load();}

  async function saveTransfer(event){event.preventDefault();formError("#financeTransferError");const values=Object.fromEntries(new FormData(event.currentTarget).entries());if(values.from_fund_id===values.to_fund_id)return formError("#financeTransferError","Source and destination funds must be different.");const source=state.funds.find(item=>item.id===values.from_fund_id);if(num(values.amount)>fundBalance(source).current)return formError("#financeTransferError","Transfer cannot exceed the source fund balance.");const {error}=await state.client.from("finance_fund_transfers").insert({...values,amount:num(values.amount),reference_number:values.reference_number.trim()||null});if(error)return formError("#financeTransferError",error.message);$("#financeTransferDialog").close();notify("Fund transfer posted.");await load();}

  async function updateRecord(table,id,changes,message) {const {error}=await state.client.from(table).update(changes).eq("id",id);if(error)return notify(error.message,"error");notify(message);await load();}

  async function voidRecord(spec) {if(!can("finance.manage"))return;const [type,id]=spec.split(":");if(!confirm("Void this financial record? Its history will remain in the audit trail."))return;const tables={collection:"finance_collections",expense:"finance_expenses",remittance:"finance_remittances",transfer:"finance_fund_transfers"};await updateRecord(tables[type],id,{status:"Voided"},"Financial record voided; history was preserved.");}

  function updateRuleTotal() {const form=$("#financeRuleForm");if(!form)return;const total=num(form.elements.local_percentage.value)+num(form.elements.district_percentage.value);const node=$("#financeRuleTotal");node.className=`full distribution-total ${total===100?"valid":"invalid"}`;node.textContent=`Distribution total: ${total.toFixed(2)}% ${total===100?"✓":"— must equal 100%"}`;}

  async function saveRule(event) {event.preventDefault();formError("#financeRuleError");const form=event.currentTarget;const values=Object.fromEntries(new FormData(form).entries());const total=num(values.local_percentage)+num(values.district_percentage);if(total!==100)return formError("#financeRuleError","Local Church and district percentages must total exactly 100%.");const {error}=await state.client.from("finance_distribution_rules").update({district_name:values.district_name.trim(),local_percentage:num(values.local_percentage),district_percentage:num(values.district_percentage),enabled:values.enabled==="true"}).eq("id",values.id);if(error)return formError("#financeRuleError",error.message);notify("Distribution rule updated. Existing collections retain their historical snapshots.");await load();}

  function csvValue(value){const text=String(value??"");return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
  function exportCollections(){const rows=state.collections;const headers=["Date","Collection Type","Amount (GHS)","Method","Status","Reference","Local Share","District Share","District","Recorded By"];const body=rows.map(item=>[item.collection_date,item.collection_type,item.amount,item.collection_method,item.status,item.reference_number||"",item.local_share,item.district_share,item.district_name_snapshot||"",item.recorded_by_name]);const blob=new Blob([[headers,...body].map(row=>row.map(csvValue).join(",")).join("\n")],{type:"text/csv;charset=utf-8"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="resurrection-finance-collections.csv";link.click();URL.revokeObjectURL(link.href);}

  function bindEvents() {
    if(state.bound)return;state.bound=true;
    document.addEventListener("click",event=>{
      const sidebar=event.target.closest("[data-finance-section]");if(sidebar){state.section=sidebar.dataset.financeSection;state.page=1;render();}
      const tab=event.target.closest("[data-finance-tab]");if(tab){state.section=tab.dataset.financeTab;state.page=1;render();}
      const open=event.target.closest("[data-finance-open]")?.dataset.financeOpen;if(open)openForm(open);
      const action=event.target.closest("#financePrimaryAction")?.dataset.financeAction;if(action)openForm(action);
      const close=event.target.closest("[data-close-finance]")?.dataset.closeFinance;if(close)$("#"+close)?.close();
      const page=event.target.closest("[data-finance-page]")?.dataset.financePage;if(page){state.page+=page==="next"?1:-1;$("#financeCollectionTable").innerHTML=collectionTableMarkup();refreshIcons();}
      const count=event.target.closest("[data-finance-count]")?.dataset.financeCount;if(count)updateRecord("finance_collections",count,{status:"Counted"},"Collection marked as counted.");
      const verify=event.target.closest("[data-finance-verify]")?.dataset.financeVerify;if(verify)updateRecord("finance_collections",verify,{status:"Verified"},"Collection verified.");
      const expenseStatus=event.target.closest("[data-finance-expense-status]")?.dataset.financeExpenseStatus;if(expenseStatus){const [status,id]=expenseStatus.split(":");updateRecord("finance_expenses",id,{status},`Expense marked ${status.toLowerCase()}.`);}
      const voidSpec=event.target.closest("[data-finance-void]")?.dataset.financeVoid;if(voidSpec)voidRecord(voidSpec);
      if(event.target.closest("#financeRefresh"))load();if(event.target.closest("#financePrintReport"))window.print();if(event.target.closest("#financeExportReport"))exportCollections();
    });
    document.addEventListener("input",event=>{
      if(event.target.matches("#financeRecordSearch,#financeDateFrom,#financeDateTo,#financeStatusFilter")){state.page=1;$("#financeCollectionTable").innerHTML=collectionTableMarkup();refreshIcons();}
      if(event.target.closest("#financeCollectionForm")&&(event.target.name==="amount"||event.target.name==="collection_type"))updateCollectionConditionalFields();
      if(event.target.closest("#financeRuleForm")&&["local_percentage","district_percentage"].includes(event.target.name))updateRuleTotal();
      if(event.target.matches("#financeGrowthType,#financeGranularity,#financeComparison,#financeCustomStart,#financeCustomEnd")){if(event.target.id==="financeComparison")$("#financeCustomRange").hidden=event.target.value!=="custom";renderGrowthChart();}
    });
    $("#financeCollectionForm").addEventListener("submit",saveCollection);$("#financeExpenseForm").addEventListener("submit",saveExpense);$("#financeRemittanceForm").addEventListener("submit",saveRemittance);$("#financeFundForm").addEventListener("submit",saveFund);$("#financeTransferForm").addEventListener("submit",saveTransfer);
    document.addEventListener("submit",event=>{if(event.target.id==="financeRuleForm")saveRule(event);});
  }

  async function initialize(context) {state.client=context.client;state.userId=context.userId;state.permissions=context.permissions||[];state.members=context.members||[];state.events=context.events||[];state.legacyTransactions=context.legacyTransactions||[];state.initialized=true;bindEvents();if(can("finance.view"))await load();else render();}
  function syncReferenceData(members,events){state.members=members||[];state.events=events||[];}
  function openCollection(type){state.section=Object.entries(sectionTypes).find(([,value])=>value===type)?.[0]||"collections";render();openForm("collection");}

  mount();
  window.FinanceModule={initialize,load,render,syncReferenceData,openCollection,aggregateSeries,comparisonRange,getData:()=>({collections:state.collections.slice(),expenses:state.expenses.slice(),funds:state.funds.slice(),remittances:state.remittances.slice(),transfers:state.transfers.slice(),rules:state.rules.slice()})};
})();
