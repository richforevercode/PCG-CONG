(function () {
  "use strict";

  const VTO_TYPE = "Voluntary Thanks Offering (VTO)";
  const MINI_HARVEST_TYPE = "Day Born Mini-Harvest";
  const MAIN_HARVEST_TYPE = "Main Harvest";
  const HARVEST_TYPES = new Set([MINI_HARVEST_TYPE, MAIN_HARVEST_TYPE]);
  const DISTRIBUTION_TYPES = new Set(["Tithe", "Adult Offertory", "Children Service Offertory", "Junior Youth (JY) Offertory"]);
  const HARVEST_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const COLLECTION_TYPES = ["Tithe", VTO_TYPE, "Adult Offertory", "Junior Youth (JY) Offertory", "Children Service Offertory", MINI_HARVEST_TYPE, MAIN_HARVEST_TYPE, "Sunday Offertory", "Thanksgiving", "Donation", "Other"];
  const MEMBER_GIVING_TYPES = new Set(["Tithe", VTO_TYPE]);
  const OFFERTORY_TYPES = new Set(["Sunday Offertory", "Adult Offertory", "Children Service Offertory", "Junior Youth (JY) Offertory"]);
  const SERVICE_NAMES = ["Sunday Divine Service", "Thanksgiving Service", "Harvest Service", "Communion Service", "Youth Service", "Children's Service", "Junior Youth Service", "Evangelism Service", "Funeral Service", "Wedding Service", "Special Programme", "Other"];
  const METHODS = ["Cash", "Mobile Money", "Bank", "Other"];
  const OCCASIONS = ["Birthday", "Anniversary", "Graduation", "Marriage", "Child Dedication", "Thanksgiving", "New Job", "Other"];
  const EXPENSE_CATEGORIES = ["Utilities", "Maintenance", "Repairs", "Transport", "Stationery", "Events", "Ministry", "Welfare", "Bank Charges", "Salaries/Allowances", "Other"];
  const PAGE_SIZE = 10;
  const sectionTypes = {
    tithes: "Tithe",
    vto: VTO_TYPE,
    children: "Children Service Offertory",
    jy: "Junior Youth (JY) Offertory",
    adult: "Adult Offertory",
    miniHarvest: MINI_HARVEST_TYPE,
    mainHarvest: MAIN_HARVEST_TYPE
  };
  const state = {
    client: null, userId: null, permissions: [], members: [], events: [], legacyTransactions: [],
    collections: [], expenses: [], funds: [], remittances: [], transfers: [], rules: [], audit: [],
    section: "dashboard", harvestDay: null, page: 1, loading: false, initialized: false, bound: false, editingCollectionId: null
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
  const distributionRule = type => state.rules.find(item => item.collection_type === type && item.enabled) || null;
  const rule = () => distributionRule("Adult Offertory") || distributionRule("Tithe");

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
        ${[["dashboard","Overview"],["tithes","Tithe"],["vto",VTO_TYPE],["adult","Adult Offertory"],["jy","Junior Youth (JY) Offertory"],["children","Children Service Offertory"],["miniHarvest",MINI_HARVEST_TYPE],["mainHarvest",MAIN_HARVEST_TYPE],["remittances","60/40 Distribution"],["reports","Financial Reports"],["collections","All Collections"],["expenses","Expenses"],["funds","Funds / Accounts"],["settings","Settings"],["audit","Audit Trail"]].map(([value,label]) => `<button type="button" data-finance-tab="${value}">${label}</button>`).join("")}
      </nav>
      <div class="finance-message" id="financeMessage" hidden></div>
      <div id="financeContent"><div class="finance-loading"><span></span><p>Loading secure financial records…</p></div></div>

      <dialog id="financeCollectionDialog" class="finance-dialog"><form id="financeCollectionForm">
        <input type="hidden" name="collection_id" />
        <div class="dialog-header"><div><p class="eyebrow">COLLECTION ENTRY</p><h3>Record collection</h3></div><button class="icon-btn" type="button" data-close-finance="financeCollectionDialog" aria-label="Close"><i data-lucide="x"></i></button></div>
        <div class="dialog-body">
          <label>Collection date<input name="collection_date" type="date" required /></label>
          <label>Collection type<select name="collection_type" required>${optionList(COLLECTION_TYPES)}</select></label>
          <label>Occasion / service<select name="service_name" required>${optionList(SERVICE_NAMES)}</select></label>
          <label id="financeCustomServiceField" hidden>Custom occasion / service<input name="custom_service_name" placeholder="e.g. Annual harvest" /></label>
          <label>Scheduled programme (optional)<select name="event_id"><option value="">No linked programme</option></select></label>
          <label id="financeMemberField">Member / giver<select name="member_id"><option value="">General collection</option></select><small id="financeMemberHint">Required for Tithe and Voluntary Thanks Offering (VTO).</small></label>
          <label id="financeHarvestDayField" hidden>Day<select name="harvest_day">${optionList(HARVEST_DAYS)}</select></label>
          <label id="financeMainHarvestTitleField" hidden>Main Harvest name / title<input name="harvest_title" placeholder="e.g. Annual Main Harvest 2026" /></label>
          <label id="financeActualCollectionField">Amount (GH₵)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" /></label>
          <label id="financePledgeField" hidden>Pledge (GH₵)<input name="pledge_amount" type="number" min="0" step="0.01" value="0" placeholder="0.00" /></label>
          <label id="financePledgeRedeemedField" hidden>Pledge Redeemed (GH₵)<input name="pledge_redeemed" type="number" min="0" step="0.01" value="0" placeholder="0.00" /></label>
          <label>Method<select name="collection_method">${optionList(METHODS)}</select></label>
          <label>Fund / account<select name="fund_id" required></select></label>
          <label>Reference number<input name="reference_number" placeholder="Optional receipt or bank reference" /></label>
          <label class="full" id="financeOccasionField" hidden>Voluntary Thanks Offering (VTO) reason<select name="occasion">${optionList(OCCASIONS)}</select></label>
          <label>Status<select name="status"><option>Pending</option><option>Counted</option><option data-verify-option>Verified</option><option>Deposited</option><option data-verify-option>Reconciled</option></select></label>
          <label class="full">Description / notes<textarea name="description" placeholder="Collection notes…"></textarea></label>
          <div class="full distribution-preview" id="financeDistributionPreview" hidden></div>
          <div class="full distribution-preview harvest-pledge-preview" id="financePledgePreview" hidden></div>
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

  function collectionTotalForTypes(types) {
    return state.collections.filter(item => accountedCollection(item) && types.has(item.collection_type)).reduce((sum, item) => sum + num(item.amount), 0);
  }

  function collectionMatchesType(item, type) {
    return type === "all" || (type === "harvest" ? HARVEST_TYPES.has(item.collection_type) : item.collection_type === type);
  }

  function harvestRecordMetrics(item) {
    const actual = num(item.amount); const pledge = num(item.pledge_amount); const redeemed = num(item.pledge_redeemed);
    return { actual, pledge, redeemed, outstanding: Math.max(0, pledge - redeemed) };
  }

  function addHarvestMetrics(target, item) {
    const values = harvestRecordMetrics(item);
    Object.keys(values).forEach(key => { target[key] += values[key]; });
    return target;
  }

  function harvestMetrics(records = state.collections.filter(accountedCollection)) {
    const blank = () => ({ actual: 0, pledge: 0, redeemed: 0, outstanding: 0 });
    const byDay = Object.fromEntries(HARVEST_DAYS.map(day => [day, blank()])); const mini = blank(); const main = blank(); const total = blank();
    records.forEach(item => {
      if (item.collection_type === MINI_HARVEST_TYPE && item.harvest_day in byDay) { addHarvestMetrics(byDay[item.harvest_day], item); addHarvestMetrics(mini, item); addHarvestMetrics(total, item); }
      if (item.collection_type === MAIN_HARVEST_TYPE) { addHarvestMetrics(main, item); addHarvestMetrics(total, item); }
    });
    return { byDay, mini, main, total };
  }

  function harvestTotals(records = state.collections.filter(accountedCollection)) {
    const metrics = harvestMetrics(records);
    return { byDay: Object.fromEntries(HARVEST_DAYS.map(day => [day, metrics.byDay[day].actual])), mini: metrics.mini.actual, main: metrics.main.actual, total: metrics.total.actual };
  }

  function periodGiving(prefix) {
    return state.collections.filter(item => accountedCollection(item) && item.collection_date?.startsWith(prefix)).reduce((sum, item) => sum + num(item.amount), 0);
  }

  function serviceLabel(item) {
    const event = relation(item, "events") || state.events.find(entry => entry.id === item.event_id);
    return item.service_name || event?.title || "Unspecified service";
  }

  function serviceGivingTotals(records = state.collections.filter(accountedCollection)) {
    const groups = new Map();
    records.forEach(item => {
      const name = serviceLabel(item); const key = `${item.collection_date}|${name.toLowerCase()}`;
      const group = groups.get(key) || { key, date: item.collection_date, service: name, tithes: 0, vto: 0, offertory: 0, miniHarvest: 0, mainHarvest: 0, other: 0, total: 0, transactions: 0, members: new Set() };
      const amount = num(item.amount);
      if (item.collection_type === "Tithe") group.tithes += amount;
      else if (item.collection_type === VTO_TYPE) group.vto += amount;
      else if (OFFERTORY_TYPES.has(item.collection_type)) group.offertory += amount;
      else if (item.collection_type === MINI_HARVEST_TYPE) group.miniHarvest += amount;
      else if (item.collection_type === MAIN_HARVEST_TYPE) group.mainHarvest += amount;
      else group.other += amount;
      group.total += amount; group.transactions += 1; if (item.member_id) group.members.add(item.member_id); groups.set(key, group);
    });
    return Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date) || a.service.localeCompare(b.service));
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

  function harvestMetricValue(item, metricName = "actual") {
    if (metricName === "actual") return num(item.amount);
    if (!HARVEST_TYPES.has(item.collection_type)) return 0;
    return harvestRecordMetrics(item)[metricName] || 0;
  }

  function aggregateSeries(records, granularity = "monthly", type = "all", metricName = "actual") {
    const totals = new Map();
    records.filter(accountedCollection).filter(item => collectionMatchesType(item, type)).forEach(item => {
      const key = bucketKey(item.collection_date, granularity);
      totals.set(key, (totals.get(key) || 0) + harvestMetricValue(item, metricName));
    });
    return Array.from(totals, ([key, value]) => ({ key, label: bucketLabel(key, granularity), value })).sort((a, b) => a.key.localeCompare(b.key));
  }

  function growthData() {
    const type = $("#financeGrowthType")?.value || "all";
    const metricName = $("#financeGrowthMetric")?.value || "actual";
    const comparison = $("#financeComparison")?.value || "month";
    const range = comparisonRange(comparison, $("#financeCustomStart")?.value, $("#financeCustomEnd")?.value);
    const eligible = state.collections.filter(accountedCollection).filter(item => collectionMatchesType(item, type));
    const timestamp = value => dateFromIso(value).getTime();
    const totalWithin = (start, end) => eligible.filter(item => timestamp(item.collection_date) >= start.getTime() && timestamp(item.collection_date) <= end.getTime()).reduce((sum, item) => sum + harvestMetricValue(item, metricName), 0);
    const current = totalWithin(range.start, range.end); const previous = totalWithin(range.previousStart, range.previousEnd);
    const percentage = previous === 0 ? (current === 0 ? 0 : null) : (current - previous) / previous * 100;
    return { current, previous, percentage, type, metricName, comparison, range };
  }

  function renderGrowthChart() {
    const container = $("#financeTrendChart"); if (!container) return;
    const granularity = $("#financeGranularity")?.value || "monthly";
    const type = $("#financeGrowthType")?.value || "all";
    const metricName = $("#financeGrowthMetric")?.value || "actual";
    const series = aggregateSeries(state.collections, granularity, type, metricName).slice(-12);
    const growth = growthData();
    const direction = growth.percentage === null || growth.percentage > 0 ? "increase" : growth.percentage < 0 ? "decrease" : "stable";
    const readableType = type === "all" ? "Collections" : type === "harvest" ? "Total Harvest" : type;
    const readableMetric = { actual: "Actual Collection", pledge: "Pledge", redeemed: "Pledge Redeemed", outstanding: "Outstanding Pledge" }[metricName];
    const growthText = growth.percentage === null ? "Increase from zero" : `${Math.abs(growth.percentage).toFixed(1)}% ${direction === "stable" ? "Stable" : direction === "increase" ? "Increase" : "Decrease"}`;
    $("#financeCurrentPeriod").textContent = money.format(growth.current);
    $("#financePreviousPeriod").textContent = money.format(growth.previous);
    const badge = $("#financeGrowthBadge"); badge.className = `growth-badge ${direction}`; badge.innerHTML = `<i data-lucide="${direction === "increase" ? "trending-up" : direction === "decrease" ? "trending-down" : "minus"}"></i>${esc(growthText)}`;
    const summary = direction === "increase" ? `${readableType} ${readableMetric} is growing. ${growth.percentage === null ? "The current period has value while the previous period had none." : `${readableMetric} increased by ${Math.abs(growth.percentage).toFixed(1)}% compared with the previous period.`}` : direction === "decrease" ? `${readableType} ${readableMetric} is decreasing. It decreased by ${Math.abs(growth.percentage).toFixed(1)}% compared with the previous period.` : `${readableType} ${readableMetric} is stable compared with the previous period.`;
    $("#financeGrowthSummary").textContent = summary;
    if (!series.length) { container.innerHTML = `<div class="finance-empty"><i data-lucide="chart-no-axes-combined"></i><p>No verified collection data is available for this chart.</p></div>`; refreshIcons(); return; }
    const width = 760, height = 260, left = 64, right = 20, top = 28, bottom = 47;
    const max = Math.max(...series.map(item => item.value), 1);
    const points = series.map((item, index) => ({ ...item, x: left + (series.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (series.length - 1)), y: top + (max - item.value) / max * (height - top - bottom) }));
    const grid = [0, .25, .5, .75, 1].map(fraction => { const y = top + fraction * (height - top - bottom); const value = max * (1 - fraction); return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="${left - 9}" y="${y + 4}" text-anchor="end">${esc(compactMoney.format(value))}</text>`; }).join("");
    const line = points.map(point => `${point.x},${point.y}`).join(" ");
    const area = `${left},${height - bottom} ${line} ${points.at(-1).x},${height - bottom}`;
    const segments = points.slice(1).map((point, index) => { const previous = points[index]; const movement = point.value > previous.value ? "increase" : point.value < previous.value ? "decrease" : "stable"; return `<line class="finance-chart-segment ${movement}" x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}"><title>${esc(previous.label)} to ${esc(point.label)}: ${movement}</title></line>`; }).join("");
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(readableType)} ${esc(readableMetric)} trend"><g class="finance-chart-grid">${grid}</g><polygon class="finance-chart-area" points="${area}"/>${segments}${points.length === 1 ? `<circle class="finance-chart-only-point" cx="${points[0].x}" cy="${points[0].y}" r="5"/>` : ""}${points.map(point => `<g><circle cx="${point.x}" cy="${point.y}" r="5"><title>${esc(point.label)}: ${money.format(point.value)}</title></circle><text class="finance-chart-value" x="${point.x}" y="${point.y - 12}" text-anchor="middle">${esc(compactMoney.format(point.value))}</text><text class="finance-chart-label" x="${point.x}" y="${height - 19}" text-anchor="middle">${esc(point.label)}</text></g>`).join("")}</svg>`;
    refreshIcons();
  }

  function renderHarvestDayChart() {
    const container = $("#financeHarvestDayChart"); if (!container) return;
    const totals = harvestMetrics(); const values = HARVEST_DAYS.flatMap(day => [totals.byDay[day].actual, totals.byDay[day].pledge, totals.byDay[day].redeemed]); const max = Math.max(...values, 1);
    container.innerHTML = HARVEST_DAYS.map(day => {
      const item = totals.byDay[day];
      const bars = [["actual", item.actual], ["pledge", item.pledge], ["redeemed", item.redeemed]].map(([name, value]) => `<span class="${name}" style="height:${value ? Math.max(6, value / max * 100) : 2}%"><i>${esc(compactMoney.format(value))}</i><title>${esc(day)} ${name}: ${money.format(value)}</title></span>`).join("");
      return `<div class="harvest-day-column" title="${esc(day)} — Actual ${money.format(item.actual)}, Pledge ${money.format(item.pledge)}, Redeemed ${money.format(item.redeemed)}, Outstanding ${money.format(item.outstanding)}"><div class="harvest-grouped-bars">${bars}</div><small>${esc(day.slice(0, 3))}</small><b>${esc(compactMoney.format(item.outstanding))} due</b></div>`;
    }).join("");
  }

  function growthChartMarkup(type = "all", fixedType = false, title = "Collections over time") {
    const typeControl = fixedType
      ? `<select id="financeGrowthType" aria-label="Collection type" disabled><option value="${esc(type)}" selected>${esc(type)}</option></select>`
      : `<select id="financeGrowthType" aria-label="Collection type"><option value="all">All Collections</option><option value="harvest">Total Harvest</option>${optionList(COLLECTION_TYPES, type)}</select>`;
    return `<article class="card finance-trend-card"><div class="finance-card-heading"><div><p class="eyebrow">FINANCIAL GROWTH</p><h3>${esc(title)}</h3></div><div class="finance-chart-controls">${typeControl}<select id="financeGrowthMetric" aria-label="Harvest metric"><option value="actual">Actual Collection</option><option value="pledge">Pledge (harvest only)</option><option value="redeemed">Pledge Redeemed (harvest only)</option><option value="outstanding">Outstanding Pledge (harvest only)</option></select><select id="financeGranularity" aria-label="Chart period"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div></div><div class="finance-comparison-controls"><select id="financeComparison"><option value="week">This week vs last week</option><option value="month" selected>This month vs last month</option><option value="quarter">This quarter vs previous quarter</option><option value="year">This year vs previous year</option><option value="custom">Custom range vs previous equivalent</option></select><div id="financeCustomRange" hidden><input id="financeCustomStart" type="date" aria-label="Custom start date"><input id="financeCustomEnd" type="date" aria-label="Custom end date"></div></div><div id="financeTrendChart" class="finance-trend-chart"></div><div class="finance-trend-legend" aria-label="Trend legend"><span><i class="increase"></i> Increase</span><span><i class="decrease"></i> Decrease</span><span><i class="stable"></i> Stable</span></div><div class="growth-stat-grid"><div><span>Current period</span><strong id="financeCurrentPeriod">GH₵0.00</strong></div><div><span>Previous period</span><strong id="financePreviousPeriod">GH₵0.00</strong></div><div><span>Growth</span><strong class="growth-badge stable" id="financeGrowthBadge">0% Stable</strong></div></div><p class="finance-growth-summary" id="financeGrowthSummary"></p></article>`;
  }

  function harvestSummaryMarkup() {
    const totals = harvestMetrics().total;
    return `<section class="finance-harvest-section">${harvestMetricStrip(totals, "All Day Born Mini-Harvest days + Main Harvest")}<article class="card finance-harvest-card"><div class="finance-card-heading"><div><p class="eyebrow">DAY BORN MINI-HARVEST</p><h3>Actual, pledged, and redeemed by day</h3><p>Outstanding Pledge is Pledge minus Pledge Redeemed and is never counted as cash.</p></div></div><div id="financeHarvestDayChart" class="harvest-day-chart" role="img" aria-label="Day Born Mini-Harvest Actual Collection, Pledge, and Pledge Redeemed comparison for Sunday through Saturday"></div><div class="harvest-day-legend"><span><i class="actual"></i> Actual Collection</span><span><i class="pledge"></i> Pledge</span><span><i class="redeemed"></i> Pledge Redeemed</span></div></article></section>`;
  }

  function harvestMetricStrip(values, scope) {
    return `<div class="finance-summary-strip harvest-totals">${metric("Actual Collection", money.format(values.actual), scope, "hand-coins", "green")}${metric("Pledge", money.format(values.pledge), "Commitments recorded separately", "scroll-text", "blue")}${metric("Pledge Redeemed", money.format(values.redeemed), "Redemptions tracked separately", "badge-check", "orange")}${metric("Outstanding Pledge", money.format(values.outstanding), "Pledge − Pledge Redeemed", "circle-alert", values.outstanding ? "red" : "green")}</div>`;
  }

  function dashboardMarkup() {
    const district = districtTotals();
    const expenses = state.expenses.filter(paidExpense).reduce((sum, item) => sum + num(item.amount), 0) + state.legacyTransactions.filter(item => item.type === "Expense").reduce((sum,item)=>sum+num(item.amount),0);
    const currentMonth = todayIso().slice(0, 7); const currentYear = todayIso().slice(0, 4);
    return `<div class="finance-metric-grid">
      ${metric("Total Tithe", money.format(collectionTotal("Tithe")), "Member giving", "badge-cent", "blue")}
      ${metric("Total Voluntary Thanks Offering (VTO)", money.format(collectionTotal(VTO_TYPE)), "Member thanksgiving giving", "heart-handshake", "red")}
      ${metric("Total Adult Offertory", money.format(collectionTotal("Adult Offertory")), "Adult service offertory", "church", "orange")}
      ${metric("Total JY Offertory", money.format(collectionTotal("Junior Youth (JY) Offertory")), "Junior Youth (JY) Offertory", "users-round", "blue")}
      ${metric("Total Children Service Offertory", money.format(collectionTotal("Children Service Offertory")), "Children Service Offertory", "baby", "orange")}
      ${metric("Total Day Born Mini-Harvest", money.format(collectionTotal(MINI_HARVEST_TYPE)), "Sunday through Saturday", "calendar-heart", "blue")}
      ${metric("Total Main Harvest", money.format(collectionTotal(MAIN_HARVEST_TYPE)), "Main Harvest events", "wheat", "orange")}
      ${metric("Total Harvest", money.format(collectionTotalForTypes(HARVEST_TYPES)), "Day Born Mini-Harvest + Main Harvest", "chart-column-big", "green")}
      ${metric("Total Giving", money.format(collectionTotal()), `${state.collections.filter(accountedCollection).length} accounted transactions`, "hand-coins", "green")}
      ${metric("Giving This Month", money.format(periodGiving(currentMonth)), currentMonth, "calendar-range", "blue")}
      ${metric("Giving This Year", money.format(periodGiving(currentYear)), currentYear, "calendar-days", "green")}
      ${metric("Total Expenses", money.format(expenses), "Paid expenses and posted legacy expenses", "receipt", "red")}
      ${metric("Current Church Balance", money.format(currentChurchBalance()), "Opening balances + church shares + legacy net − paid expenses", "landmark", "blue")}
      ${metric("District Amount Due", money.format(district.due), "Calculated distribution shares", "building-2", "orange")}
      ${metric("District Amount Remitted", money.format(district.remitted), "Non-voided remittances", "send", "green")}
      ${metric("Outstanding District Balance", money.format(district.outstanding), "Payable to Sebrepor District", "circle-alert", district.outstanding ? "red" : "green")}
    </div>
    <div class="finance-dashboard-grid">
      ${growthChartMarkup()}
      <article class="card finance-side-card"><div class="finance-card-heading"><div><p class="eyebrow">ACCOUNTABILITY</p><h3>District position</h3></div></div><div class="district-rule-summary">${rule() ? `<div class="rule-split"><span><b>${num(rule().local_percentage)}%</b> Local Church</span><span><b>${num(rule().district_percentage)}%</b> ${esc(rule().district_name)}</span></div><p>Applies only to Tithe, Adult Offertory, Children Service Offertory, and Junior Youth (JY) Offertory. Mini-Harvest and all other income remain 100% local.</p>` : `<div class="finance-empty compact"><p>No active distribution rule for the four eligible income types.</p></div>`}</div><div class="district-progress"><div><span>Remittance progress</span><strong>${district.due ? Math.min(100, district.remitted / district.due * 100).toFixed(1) : "0.0"}%</strong></div><progress value="${district.remitted}" max="${Math.max(district.due, 1)}"></progress></div><button class="secondary-btn full-btn" type="button" data-finance-open="remittance" ${!can("finance.manage") || !district.outstanding ? "disabled" : ""}><i data-lucide="send"></i> Record district remittance</button></article>
    </div>${harvestSummaryMarkup()}`;
  }

  function collectionFiltersMarkup() {
    const members = state.members.slice().sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const services = Array.from(new Set(state.collections.map(serviceLabel).filter(Boolean))).sort();
    const dayFilter = state.section === "miniHarvest" && !state.harvestDay ? `<select id="financeHarvestDayFilter" aria-label="Day Born Mini-Harvest day"><option value="all">All days</option>${optionList(HARVEST_DAYS)}</select>` : "";
    const periods = Array.from(new Set(state.collections.filter(item => item.collection_type === MINI_HARVEST_TYPE).map(item => item.harvest_period || item.collection_date?.slice(0, 4)).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a)));
    const periodFilter = state.section === "miniHarvest" ? `<select id="financeHarvestPeriodFilter" aria-label="Harvest period or year"><option value="all">All harvest years</option>${periods.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select>` : "";
    return `<div class="finance-filters"><label class="finance-search"><i data-lucide="search"></i><input id="financeRecordSearch" type="search" placeholder="Search reference, member, service, or notes…"></label><input id="financeDateFrom" type="date" aria-label="From date"><input id="financeDateTo" type="date" aria-label="To date"><select id="financeTypeFilter" aria-label="Giving type"><option value="all">All giving types</option>${optionList(COLLECTION_TYPES)}</select>${dayFilter}${periodFilter}<select id="financeMemberFilter" aria-label="Member"><option value="all">All members</option>${members.map(member => `<option value="${member.id}">${esc(fullName(member))}</option>`).join("")}</select><select id="financeServiceFilter" aria-label="Service or occasion"><option value="all">All services / occasions</option>${services.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select><select id="financeStatusFilter" aria-label="Status"><option value="all">All statuses</option>${optionList(["Pending","Counted","Verified","Deposited","Reconciled","Voided"])}</select></div>`;
  }

  function filteredCollections() {
    const forced = sectionTypes[state.section]; const search = ($("#financeRecordSearch")?.value || "").trim().toLowerCase();
    const from = $("#financeDateFrom")?.value || ""; const to = $("#financeDateTo")?.value || ""; const status = $("#financeStatusFilter")?.value || "all"; const type = $("#financeTypeFilter")?.value || "all"; const day = state.section === "miniHarvest" ? state.harvestDay || $("#financeHarvestDayFilter")?.value || "all" : "all"; const period = $("#financeHarvestPeriodFilter")?.value || "all"; const memberId = $("#financeMemberFilter")?.value || "all"; const service = $("#financeServiceFilter")?.value || "all";
    return state.collections.filter(item => !forced || item.collection_type === forced).filter(item => type === "all" || item.collection_type === type).filter(item => day === "all" || item.harvest_day === day).filter(item => period === "all" || String(item.harvest_period || item.collection_date?.slice(0, 4)) === period).filter(item => memberId === "all" || item.member_id === memberId).filter(item => service === "all" || serviceLabel(item) === service).filter(item => !from || item.collection_date >= from).filter(item => !to || item.collection_date <= to).filter(item => status === "all" || item.status === status).filter(item => {
      const member = relation(item, "members") || state.members.find(entry => entry.id === item.member_id);
      const event = relation(item, "events") || state.events.find(entry => entry.id === item.event_id);
      return !search || [item.collection_type, item.harvest_day, item.harvest_title, item.reference_number, item.description, item.occasion, serviceLabel(item), fullName(member), event?.title].join(" ").toLowerCase().includes(search);
    }).sort((a, b) => b.collection_date.localeCompare(a.collection_date) || b.created_at.localeCompare(a.created_at));
  }

  function collectionActionsMarkup(item) {
    return can("finance.manage") && item.status !== "Voided" ? `<div class="row-actions"><button class="icon-btn" data-finance-edit-collection="${item.id}" title="Edit financial record"><i data-lucide="pencil"></i></button>${item.status === "Pending" ? `<button class="icon-btn" data-finance-count="${item.id}" title="Mark counted"><i data-lucide="check"></i></button>` : ""}${item.status === "Counted" && can("finance.verify") ? `<button class="icon-btn" data-finance-verify="${item.id}" title="Verify"><i data-lucide="badge-check"></i></button>` : ""}<button class="icon-btn delete" data-finance-void="collection:${item.id}" title="Void record while preserving financial history"><i data-lucide="ban"></i></button></div>` : "";
  }

  function collectionTableMarkup() {
    const records = filteredCollections(); const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE)); state.page = Math.min(state.page, pages);
    const rows = records.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    return `<div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>Collection</th><th>Member / Service</th><th>Method</th><th>Status</th><th>Actual Collection</th><th>Pledge</th><th>Pledge Redeemed</th><th>Outstanding Pledge</th><th>Distribution</th><th>Recorded by</th><th></th></tr></thead><tbody>${rows.length ? rows.map(item => {
      const member = relation(item, "members") || state.members.find(entry => entry.id === item.member_id); const event = relation(item, "events") || state.events.find(entry => entry.id === item.event_id);
      const action = collectionActionsMarkup(item);
      const collectionContext = item.harvest_day || item.harvest_title || item.occasion || item.reference_number || "No reference";
      const harvest = HARVEST_TYPES.has(item.collection_type); const values = harvestRecordMetrics(item);
      return `<tr><td>${formatDate(item.collection_date)}</td><td><strong>${esc(item.collection_type)}</strong><small>${esc(collectionContext)}</small></td><td><span>${esc(member ? fullName(member) : "General collection")}</span><small>${esc(serviceLabel(item))}${event ? ` · scheduled ${formatDate(event.event_date)}` : ""}</small></td><td>${esc(item.collection_method)}</td><td><span class="finance-status ${item.status.toLowerCase()}">${esc(item.status)}</span></td><td class="finance-money">${money.format(values.actual)}</td><td class="finance-money">${harvest ? money.format(values.pledge) : "—"}</td><td class="finance-money">${harvest ? money.format(values.redeemed) : "—"}</td><td class="finance-money ${harvest && values.outstanding ? "finance-outstanding" : ""}">${harvest ? money.format(values.outstanding) : "—"}</td><td>${num(item.district_share) ? `<small>Church ${money.format(num(item.local_share))}<br>${esc(item.district_name_snapshot)} ${money.format(num(item.district_share))}</small>` : "—"}</td><td>${esc(item.recorded_by_name || "Finance officer")}</td><td>${action}</td></tr>`;
    }).join("") : `<tr><td colspan="12"><div class="finance-empty"><i data-lucide="receipt-text"></i><p>No collection records match these filters.</p></div></td></tr>`}</tbody></table></div><div class="table-footer"><span>${records.length} collection record${records.length === 1 ? "" : "s"}</span><div class="pagination"><button type="button" data-finance-page="previous" ${state.page === 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button><button class="active" type="button">${state.page}</button><button type="button" data-finance-page="next" ${state.page === pages ? "disabled" : ""}><i data-lucide="chevron-right"></i></button></div></div>`;
  }

  function miniHarvestDayTableMarkup() {
    const records = filteredCollections(); const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE)); state.page = Math.min(state.page, pages);
    const rows = records.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    return `<div class="table-scroll"><table class="finance-table finance-day-record-table"><thead><tr><th>Date</th><th>Actual Collection</th><th>Pledge</th><th>Pledge Redeemed</th><th>Outstanding Pledge</th><th>Notes / Description</th><th>Status</th><th>Recorded By</th><th>Created</th><th>Action</th></tr></thead><tbody>${rows.length ? rows.map(item => { const values = harvestRecordMetrics(item); return `<tr><td>${formatDate(item.collection_date)}</td><td class="finance-money">${money.format(values.actual)}</td><td class="finance-money">${money.format(values.pledge)}</td><td class="finance-money">${money.format(values.redeemed)}</td><td class="finance-money ${values.outstanding ? "finance-outstanding" : ""}">${money.format(values.outstanding)}</td><td><strong>${esc(item.description || "No notes")}</strong><small>${esc(serviceLabel(item))}</small></td><td><span class="finance-status ${item.status.toLowerCase()}">${esc(item.status)}</span></td><td>${esc(item.recorded_by_name || "Finance officer")}</td><td>${item.created_at ? dateTimeFormat.format(new Date(item.created_at)) : "—"}</td><td>${collectionActionsMarkup(item)}</td></tr>`; }).join("") : `<tr><td colspan="10"><div class="finance-empty"><i data-lucide="receipt-text"></i><p>No ${esc(state.harvestDay)} Mini-Harvest records match these filters.</p></div></td></tr>`}</tbody></table></div><div class="table-footer"><span>${records.length} ${esc(state.harvestDay)} record${records.length === 1 ? "" : "s"}</span><div class="pagination"><button type="button" data-finance-page="previous" ${state.page === 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button><button class="active" type="button">${state.page}</button><button type="button" data-finance-page="next" ${state.page === pages ? "disabled" : ""}><i data-lucide="chevron-right"></i></button></div></div>`;
  }

  function activeCollectionTableMarkup() {
    return state.section === "miniHarvest" && state.harvestDay ? miniHarvestDayTableMarkup() : collectionTableMarkup();
  }

  function collectionsMarkup() {
    const forced = sectionTypes[state.section]; const records = state.collections.filter(item => !forced || item.collection_type === forced).filter(accountedCollection);
    const total = records.reduce((sum, item) => sum + num(item.amount), 0);
    const currentMonth = todayIso().slice(0, 7); const monthTotal = records.filter(item => item.collection_date.startsWith(currentMonth)).reduce((sum, item) => sum + num(item.amount), 0);
    const memberCount = new Set(records.map(item => item.member_id).filter(Boolean)).size;
    const daySummary = forced === MINI_HARVEST_TYPE ? `<div class="finance-day-summary">${HARVEST_DAYS.map(day => `<div><span>${day}</span><strong>${money.format(records.filter(item => item.harvest_day === day).reduce((sum, item) => sum + num(item.amount), 0))}</strong></div>`).join("")}</div>` : "";
    return `<div class="finance-summary-strip">${metric(forced ? `${forced} total` : "All collections", money.format(total), "Accounted, non-voided records", "hand-coins", "green")}${metric("This month", money.format(monthTotal), currentMonth, "calendar-range", "blue")}${metric("Records", String(records.length), `${memberCount} linked member${memberCount === 1 ? "" : "s"}`, "list-checks", "orange")}${DISTRIBUTION_TYPES.has(forced) ? metric("District share", money.format(records.reduce((sum,item)=>sum+num(item.district_share),0)), "Historical rule snapshots", "building-2", "red") : metric("Pending", String(state.collections.filter(item => (!forced || item.collection_type === forced) && item.status === "Pending").length), "Awaiting counting", "clock-3", "orange")}</div>${daySummary}<article class="card finance-record-card">${collectionFiltersMarkup()}<div id="financeCollectionTable">${collectionTableMarkup()}</div></article>`;
  }

  function miniHarvestNavigationMarkup() {
    return `<nav class="finance-harvest-nav" aria-label="Day Born Mini-Harvest record sections"><button type="button" data-finance-harvest-day="" class="${state.harvestDay ? "" : "active"}">All days</button>${HARVEST_DAYS.map(day => `<button type="button" data-finance-harvest-day="${day}" class="${state.harvestDay === day ? "active" : ""}">${day}</button>`).join("")}</nav>`;
  }

  function miniHarvestMarkup() {
    const totals = harvestMetrics(); const day = state.harvestDay;
    if (day) {
      const records = state.collections.filter(item => item.collection_type === MINI_HARVEST_TYPE && item.harvest_day === day);
      return `${miniHarvestNavigationMarkup()}<div class="finance-day-page-heading"><div><p class="eyebrow">${esc(MINI_HARVEST_TYPE.toUpperCase())}</p><h3>${esc(day)} Mini-Harvest</h3><p>Actual Collection, Pledge, Pledge Redeemed, and Outstanding Pledge for ${esc(day)}.</p></div>${can("finance.manage") ? `<button class="primary-btn" type="button" data-finance-open="collection"><i data-lucide="plus"></i> Add Record</button>` : ""}</div>${harvestMetricStrip(totals.byDay[day], `${day} Mini-Harvest`)}<article class="card finance-record-card"><div class="finance-card-heading"><div><p class="eyebrow">RECORD HISTORY</p><h3>${esc(day)} Mini-Harvest records</h3></div></div>${collectionFiltersMarkup()}<div id="financeCollectionTable">${miniHarvestDayTableMarkup()}</div></article>`;
    }
    const dayCards = HARVEST_DAYS.map(dayName => {
      const count = state.collections.filter(item => accountedCollection(item) && item.collection_type === MINI_HARVEST_TYPE && item.harvest_day === dayName).length;
      const values = totals.byDay[dayName];
      return `<button type="button" class="finance-day-card" data-finance-harvest-day="${dayName}"><span>${esc(dayName)}</span><strong>${money.format(values.actual)} <em>Actual Collection</em></strong><small><b>${money.format(values.pledge)}</b> Pledge</small><small><b>${money.format(values.redeemed)}</b> Pledge Redeemed</small><small class="${values.outstanding ? "due" : ""}"><b>${money.format(values.outstanding)}</b> Outstanding Pledge</small><small>${count} record${count === 1 ? "" : "s"}</small><i data-lucide="arrow-up-right"></i></button>`;
    }).join("");
    return `${miniHarvestNavigationMarkup()}<div class="finance-day-overview-grid">${dayCards}</div>${harvestMetricStrip(totals.mini, "Sunday + Monday + Tuesday + Wednesday + Thursday + Friday + Saturday")}<div class="finance-mini-harvest-analytics"><article class="card finance-harvest-card"><div class="finance-card-heading"><div><p class="eyebrow">DAY PERFORMANCE</p><h3>Sunday through Saturday comparison</h3><p>Compare Actual Collection, Pledge, and Pledge Redeemed; the amount due is shown under each day.</p></div></div><div id="financeHarvestDayChart" class="harvest-day-chart" role="img" aria-label="Day Born Mini-Harvest metrics for Sunday through Saturday"></div><div class="harvest-day-legend"><span><i class="actual"></i> Actual Collection</span><span><i class="pledge"></i> Pledge</span><span><i class="redeemed"></i> Pledge Redeemed</span></div></article>${growthChartMarkup(MINI_HARVEST_TYPE, true, "Day Born Mini-Harvest over time")}</div><article class="card finance-record-card finance-mini-history"><div class="finance-card-heading"><div><p class="eyebrow">ALL DAY RECORDS</p><h3>Day Born Mini-Harvest history</h3></div>${can("finance.manage") ? `<button class="secondary-btn" type="button" data-finance-open="collection"><i data-lucide="plus"></i> Add Record</button>` : ""}</div>${collectionFiltersMarkup()}<div id="financeCollectionTable">${collectionTableMarkup()}</div></article>`;
  }

  function mainHarvestMarkup() {
    const records = state.collections.filter(item => item.collection_type === MAIN_HARVEST_TYPE && accountedCollection(item));
    return `${harvestMetricStrip(harvestMetrics(records).main, "All Main Harvest events")}<div class="finance-main-harvest-analytics">${growthChartMarkup(MAIN_HARVEST_TYPE, true, "Main Harvest over time")}</div><article class="card finance-record-card"><div class="finance-card-heading"><div><p class="eyebrow">MAIN HARVEST RECORDS</p><h3>Actual, pledged, redeemed, and outstanding</h3></div>${can("finance.manage") ? `<button class="secondary-btn" type="button" data-finance-open="collection"><i data-lucide="plus"></i> Add Record</button>` : ""}</div>${collectionFiltersMarkup()}<div id="financeCollectionTable">${collectionTableMarkup()}</div></article>`;
  }

  function remittanceMarkup() {
    const district = districtTotals();
    return `<div class="finance-summary-strip">${metric("Amount Due", money.format(district.due), "Tithe + Adult + Children + JY district shares", "building-2", "orange")}${metric("Amount Remitted", money.format(district.remitted), "Submitted and verified", "send", "green")}${metric("Outstanding", money.format(district.outstanding), "Cannot be overpaid", "circle-alert", district.outstanding ? "red" : "green")}</div><article class="card finance-record-card"><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>District</th><th>Method</th><th>Reference</th><th>Status</th><th>Remitted by</th><th>Amount</th><th></th></tr></thead><tbody>${state.remittances.length ? state.remittances.slice().sort((a,b)=>b.remittance_date.localeCompare(a.remittance_date)).map(item => `<tr><td>${formatDate(item.remittance_date)}</td><td>${esc(item.district_name)}</td><td>${esc(item.payment_method)}</td><td>${esc(item.reference_number || "—")}</td><td><span class="finance-status ${item.status.toLowerCase()}">${esc(item.status)}</span></td><td>${esc(item.remitted_by_name)}</td><td class="finance-money">${money.format(num(item.amount))}</td><td>${can("finance.manage") && item.status !== "Voided" ? `<button class="icon-btn delete" data-finance-void="remittance:${item.id}" title="Void remittance"><i data-lucide="ban"></i></button>` : ""}</td></tr>`).join("") : `<tr><td colspan="8"><div class="finance-empty"><i data-lucide="send"></i><p>No district remittances recorded.</p></div></td></tr>`}</tbody></table></div></article>`;
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

  function reportFiltersMarkup() {
    const members = state.members.slice().sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const services = Array.from(new Set(state.collections.map(serviceLabel).filter(Boolean))).sort();
    return `<article class="card finance-report-filter-card"><div class="finance-card-heading"><div><p class="eyebrow">REPORT FILTERS</p><h3>Giving reports</h3><p>Filter once to update member, service, monthly, and annual reports.</p></div></div><div class="finance-report-filters"><input id="financeReportFrom" type="date" aria-label="Report start date"><input id="financeReportTo" type="date" aria-label="Report end date"><select id="financeReportType"><option value="all">All giving types</option>${optionList(COLLECTION_TYPES)}</select><select id="financeReportMember"><option value="all">All members</option>${members.map(member => `<option value="${member.id}">${esc(fullName(member))}</option>`).join("")}</select><select id="financeReportService"><option value="all">All services / occasions</option>${services.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select></div></article>`;
  }

  function filteredReportCollections() {
    const from = $("#financeReportFrom")?.value || ""; const to = $("#financeReportTo")?.value || ""; const type = $("#financeReportType")?.value || "all"; const memberId = $("#financeReportMember")?.value || "all"; const service = $("#financeReportService")?.value || "all";
    return state.collections.filter(accountedCollection).filter(item => !from || item.collection_date >= from).filter(item => !to || item.collection_date <= to).filter(item => type === "all" || item.collection_type === type).filter(item => memberId === "all" || item.member_id === memberId).filter(item => service === "all" || serviceLabel(item) === service);
  }

  function reportPeriodRows(records, period) {
    const groups = new Map();
    records.forEach(item => { const key = period === "month" ? item.collection_date.slice(0, 7) : item.collection_date.slice(0, 4); const group = groups.get(key) || { key, tithes: 0, vto: 0, offertory: 0, miniHarvest: 0, mainHarvest: 0, other: 0, total: 0 }; const amount = num(item.amount); if (item.collection_type === "Tithe") group.tithes += amount; else if (item.collection_type === VTO_TYPE) group.vto += amount; else if (OFFERTORY_TYPES.has(item.collection_type)) group.offertory += amount; else if (item.collection_type === MINI_HARVEST_TYPE) group.miniHarvest += amount; else if (item.collection_type === MAIN_HARVEST_TYPE) group.mainHarvest += amount; else group.other += amount; group.total += amount; groups.set(key, group); });
    return Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key));
  }

  function reportResultsMarkup() {
    const records = filteredReportCollections(); const services = serviceGivingTotals(records); const months = reportPeriodRows(records, "month"); const years = reportPeriodRows(records, "year");
    const totalFor = type => records.filter(item => item.collection_type === type).reduce((sum, item) => sum + num(item.amount), 0);
    const offertory = records.filter(item => OFFERTORY_TYPES.has(item.collection_type)).reduce((sum, item) => sum + num(item.amount), 0); const total = records.reduce((sum, item) => sum + num(item.amount), 0);
    const memberGroups = new Map(); records.filter(item => item.member_id).forEach(item => { const member = relation(item, "members") || state.members.find(entry => entry.id === item.member_id); const group = memberGroups.get(item.member_id) || { name: fullName(member), tithes: 0, vto: 0, total: 0, count: 0 }; if (item.collection_type === "Tithe") group.tithes += num(item.amount); if (item.collection_type === VTO_TYPE) group.vto += num(item.amount); group.total += num(item.amount); group.count += 1; memberGroups.set(item.member_id, group); });
    const members = Array.from(memberGroups.values()).sort((a, b) => b.total - a.total);
    const periodTable = (title, rows) => `<article class="card finance-record-card"><div class="finance-card-heading"><div><p class="eyebrow">${title.toUpperCase()}</p><h3>${title}</h3></div></div><div class="table-scroll"><table class="finance-table compact"><thead><tr><th>Period</th><th>Tithe</th><th>Voluntary Thanks Offering (VTO)</th><th>Offertory</th><th>Day Born Mini-Harvest</th><th>Main Harvest</th><th>Total Harvest</th><th>Other</th><th>Total giving</th></tr></thead><tbody>${rows.length ? rows.map(row => `<tr><td><strong>${esc(row.key)}</strong></td><td>${money.format(row.tithes)}</td><td>${money.format(row.vto)}</td><td>${money.format(row.offertory)}</td><td>${money.format(row.miniHarvest)}</td><td>${money.format(row.mainHarvest)}</td><td>${money.format(row.miniHarvest + row.mainHarvest)}</td><td>${money.format(row.other)}</td><td class="finance-money">${money.format(row.total)}</td></tr>`).join("") : `<tr><td colspan="9"><div class="finance-empty compact"><p>No giving in this period.</p></div></td></tr>`}</tbody></table></div></article>`;
    const harvest = harvestMetrics(records);
    return `<div class="finance-summary-strip">${metric("Tithe", money.format(totalFor("Tithe")), "From individual giving transactions", "badge-cent", "blue")}${metric(VTO_TYPE, money.format(totalFor(VTO_TYPE)), "From individual giving transactions", "heart-handshake", "red")}${metric("Total Harvest Actual Collection", money.format(harvest.total.actual), "Day Born Mini-Harvest + Main Harvest", "wheat", "green")}${metric("Total Giving", money.format(total), `${records.length} accounted transaction${records.length === 1 ? "" : "s"}`, "hand-coins", "green")}</div>${harvestMetricStrip(harvest.total, "Filtered report period")}<div class="finance-report-stack"><article class="card finance-record-card"><div class="finance-card-heading"><div><p class="eyebrow">SERVICE GIVING REPORT</p><h3>Totals by service / occasion</h3></div></div><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>Service / occasion</th><th>Members</th><th>Tithe</th><th>Voluntary Thanks Offering (VTO)</th><th>Offertory</th><th>Day Born Mini-Harvest Actual</th><th>Main Harvest Actual</th><th>Total Harvest Actual</th><th>Other</th><th>Total</th></tr></thead><tbody>${services.length ? services.map(row => `<tr><td>${formatDate(row.date)}</td><td><strong>${esc(row.service)}</strong><small>${row.transactions} transaction${row.transactions === 1 ? "" : "s"}</small></td><td>${row.members.size}</td><td>${money.format(row.tithes)}</td><td>${money.format(row.vto)}</td><td>${money.format(row.offertory)}</td><td>${money.format(row.miniHarvest)}</td><td>${money.format(row.mainHarvest)}</td><td>${money.format(row.miniHarvest + row.mainHarvest)}</td><td>${money.format(row.other)}</td><td class="finance-money">${money.format(row.total)}</td></tr>`).join("") : `<tr><td colspan="11"><div class="finance-empty"><p>No service giving matches these filters.</p></div></td></tr>`}</tbody></table></div></article><article class="card finance-record-card"><div class="finance-card-heading"><div><p class="eyebrow">MEMBER GIVING REPORT</p><h3>Giving by member</h3></div></div><div class="table-scroll"><table class="finance-table compact"><thead><tr><th>Member</th><th>Tithe</th><th>Voluntary Thanks Offering (VTO)</th><th>Transactions</th><th>Total giving</th></tr></thead><tbody>${members.length ? members.map(row => `<tr><td><strong>${esc(row.name)}</strong></td><td>${money.format(row.tithes)}</td><td>${money.format(row.vto)}</td><td>${row.count}</td><td class="finance-money">${money.format(row.total)}</td></tr>`).join("") : `<tr><td colspan="5"><div class="finance-empty compact"><p>No member-linked giving matches these filters.</p></div></td></tr>`}</tbody></table></div></article>${periodTable("Monthly financial report", months)}${periodTable("Annual financial report", years)}</div>`;
  }

  function renderReportResults() { const node = $("#financeReportResults"); if (node) { node.innerHTML = reportResultsMarkup(); refreshIcons(); } }

  function reportsMarkup() {
    return `<div class="finance-report-actions"><button class="secondary-btn" id="financePrintReport" type="button"><i data-lucide="printer"></i> Print</button><button class="secondary-btn" id="financeExportReport" type="button"><i data-lucide="download"></i> Export filtered CSV</button></div>${reportFiltersMarkup()}<div id="financeReportResults"></div>${legacyLedgerMarkup()}`;
  }

  function legacyLedgerMarkup(){if(!state.legacyTransactions.length)return "";return `<article class="card finance-record-card finance-legacy-ledger"><div class="finance-card-heading"><div><p class="eyebrow">COMPATIBILITY</p><h3>Legacy transaction ledger</h3><p>Preserved from the original Finance module. These records affect balances but are not guessed into collection categories.</p></div></div><div class="table-scroll"><table class="finance-table"><thead><tr><th>Date</th><th>Description</th><th>Fund</th><th>Type</th><th>Amount</th></tr></thead><tbody>${state.legacyTransactions.slice().sort((a,b)=>b.transaction_date.localeCompare(a.transaction_date)).map(item=>`<tr><td>${formatDate(item.transaction_date)}</td><td>${esc(item.description)}</td><td>${esc(item.fund)}</td><td><span class="finance-status ${item.type.toLowerCase()}">${esc(item.type)}</span></td><td class="finance-money">${item.type==="Expense"?"−":"+"}${money.format(num(item.amount))}</td></tr>`).join("")}</tbody></table></div></article>`;}

  function settingsMarkup() {
    const activeRule=rule();
    return `<div class="finance-settings-grid"><article class="card"><div class="finance-card-heading"><div><p class="eyebrow">DISTRIBUTION</p><h3>Eligible income distribution rule</h3></div></div>${activeRule ? `<form id="financeRuleForm" class="finance-settings-form"><label>Applies to<input value="Tithe, Adult, Children Service, and JY Offertory" disabled></label><label>District name<input name="district_name" value="${esc(activeRule.district_name)}" required></label><label>Local Church (%)<input name="local_percentage" type="number" min="0" max="100" step="0.01" value="${num(activeRule.local_percentage)}" required></label><label>District (%)<input name="district_percentage" type="number" min="0" max="100" step="0.01" value="${num(activeRule.district_percentage)}" required></label><label>Enabled<select name="enabled"><option value="true" ${activeRule.enabled?"selected":""}>Yes</option><option value="false" ${!activeRule.enabled?"selected":""}>No</option></select></label><p class="full distribution-total" id="financeRuleTotal"></p><p class="full finance-form-error" id="financeRuleError" hidden></p><button class="primary-btn full" type="submit" ${!can("finance.settings")?"disabled":""}>Save distribution rule</button></form>` : `<div class="finance-empty"><p>No eligible-income distribution rule is available. Apply the latest Supabase migration.</p></div>`}</article><article class="card finance-integrity-card"><p class="eyebrow">FINANCIAL INTEGRITY</p><h3>Enforced in Supabase</h3><ul><li>Non-harvest collection amounts must be greater than zero.</li><li>Harvest pledges and redemptions are separate from Actual Collection.</li><li>Outstanding Pledge is derived and Pledge Redeemed cannot exceed Pledge.</li><li>Enabled distribution percentages must total exactly 100%.</li><li>Only Tithe, Adult, Children Service, and JY Offertory store distribution snapshots.</li><li>Mini-Harvest, Main Harvest, VTO, and all other income remain 100% local.</li><li>Remittances cannot exceed the outstanding district balance.</li><li>Financial records are voided, never permanently deleted.</li><li>Creates, updates, approvals, payments, remittances, and voids are audited.</li></ul></article></div>`;
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
    const details={dashboard:["Overview","Finance & stewardship","Accountable church collections, harvests, expenses, funds, remittance, and reporting."],collections:["All Collections","All Collections","Record and reconcile all church collection types."],tithes:["Tithe","Tithe","Member-linked Tithe history, totals, and automatic district distribution."],vto:[VTO_TYPE,VTO_TYPE,"Track member thanksgiving giving and occasions."],children:["Children Service Offertory","Children Service Offertory","Children Service Offertory records with automatic district distribution."],jy:["Junior Youth (JY) Offertory","Junior Youth (JY) Offertory","Junior Youth (JY) Offertory records with automatic district distribution."],adult:["Adult Offertory","Adult Offertory","Adult Offertory with automatic Local Church and Sebrepor District distribution."],miniHarvest:[MINI_HARVEST_TYPE,MINI_HARVEST_TYPE,"Track Sunday through Saturday Day Born Mini-Harvest records; no district distribution applies."],mainHarvest:[MAIN_HARVEST_TYPE,MAIN_HARVEST_TYPE,"Create and manage Main Harvest events separately; no district distribution applies."],remittances:["60/40 Distribution","60/40 Distribution","Track Tithe, Adult, Children Service, and JY Offertory amounts due, remitted, and outstanding."],expenses:["Expenses","Expenses","Pending → Approved → Paid expense workflow."],funds:["Funds / Accounts","Funds / Accounts","Track restricted and unrestricted church funds."],reports:["Financial Reports","Financial Reports","Clear collection, harvest, expense, fund, and remittance reporting."],settings:["Finance Settings","Finance Settings","Configure the four eligible income distribution rules."],audit:["Audit Trail","Finance Audit Trail","Immutable accountability history for financial actions."]}[state.section];
    if(state.section==="miniHarvest"&&state.harvestDay)details.splice(0,3,`${MINI_HARVEST_TYPE} / ${state.harvestDay}`,`${state.harvestDay} Mini-Harvest`,`View and manage ${state.harvestDay} Day Born Mini-Harvest records.`);
    $("#financeBreadcrumbSection").textContent=details[0]; $("#financeSectionTitle").textContent=details[1]; $("#financeSectionDescription").textContent=details[2];
    $$("[data-finance-tab]").forEach(button=>button.classList.toggle("active",button.dataset.financeTab===state.section));
    $$("[data-finance-day]").forEach(button=>button.classList.toggle("active",state.section==="miniHarvest"&&button.dataset.financeDay===state.harvestDay));
    const primary=$("#financePrimaryAction"); primary.hidden=!can("finance.manage") && !(state.section==="funds"&&can("finance.settings"));
    if(state.section==="remittances"){primary.innerHTML='<i data-lucide="send"></i> Record remittance';primary.dataset.financeAction="remittance";}
    else if(state.section==="expenses"){primary.innerHTML='<i data-lucide="plus"></i> Record expense';primary.dataset.financeAction="expense";}
    else if(state.section==="funds"){primary.hidden=!can("finance.settings");primary.innerHTML='<i data-lucide="plus"></i> Add fund';primary.dataset.financeAction="fund";}
    else if(["settings","audit","reports","dashboard"].includes(state.section)){primary.hidden=true;primary.dataset.financeAction="";}
    else if(state.section==="miniHarvest"){primary.innerHTML='<i data-lucide="plus"></i> Add Record';primary.dataset.financeAction="collection";}
    else {primary.innerHTML='<i data-lucide="plus"></i> Record collection';primary.dataset.financeAction="collection";}
    if(state.loading){content.innerHTML='<div class="finance-loading"><span></span><p>Loading secure financial records…</p></div>';refreshIcons();return;}
    content.innerHTML=state.section==="dashboard"?dashboardMarkup():state.section==="miniHarvest"?miniHarvestMarkup():state.section==="mainHarvest"?mainHarvestMarkup():["collections","tithes","vto","children","jy","adult"].includes(state.section)?collectionsMarkup():state.section==="remittances"?remittanceMarkup():state.section==="expenses"?expenseMarkup():state.section==="funds"?fundsMarkup():state.section==="reports"?reportsMarkup():state.section==="settings"?settingsMarkup():auditMarkup();
    if(state.section==="dashboard") { renderGrowthChart(); renderHarvestDayChart(); }
    if(state.section==="miniHarvest"&&!state.harvestDay) { renderHarvestDayChart(); renderGrowthChart(); }
    if(state.section==="mainHarvest") renderGrowthChart();
    if(state.section==="reports") renderReportResults();
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

  function populateForms(type, record = null, preset = {}) {
    const form=type==="collection"?$("#financeCollectionForm"):type==="expense"?$("#financeExpenseForm"):null;
    if(form){const fundSelect=form.elements.fund_id;fundSelect.innerHTML=state.funds.filter(item=>item.is_active).map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join("");}
    if(type==="collection"){
      form.elements.event_id.innerHTML='<option value="">No linked programme</option>'+state.events.slice().sort((a,b)=>b.event_date.localeCompare(a.event_date)).map(item=>`<option value="${item.id}">${esc(item.title)} · ${formatDate(item.event_date)}</option>`).join("");
      form.elements.member_id.innerHTML='<option value="">General collection</option>'+state.members.slice().sort((a,b)=>fullName(a).localeCompare(fullName(b))).map(item=>`<option value="${item.id}">${esc(fullName(item))}</option>`).join("");
      form.reset(); state.editingCollectionId=record?.id||null; form.elements.collection_id.value=record?.id||"";
      const forced=sectionTypes[state.section]; const selectedType=record?.collection_type||preset.type||forced||"Tithe"; form.elements.collection_type.value=selectedType; form.elements.collection_type.disabled=Boolean(forced&&!record);
      form.elements.collection_date.value=record?.collection_date||todayIso(); form.elements.status.value=record?.status||"Counted"; form.elements.event_id.value=record?.event_id||""; form.elements.member_id.value=record?.member_id||preset.memberId||""; form.elements.harvest_day.value=record?.harvest_day||preset.harvestDay||state.harvestDay||HARVEST_DAYS[dateFromIso(form.elements.collection_date.value).getDay()]; form.elements.harvest_day.disabled=Boolean(state.harvestDay&&!record); form.elements.harvest_title.value=record?.harvest_title||""; form.elements.amount.value=record?.amount ?? (HARVEST_TYPES.has(selectedType)?0:""); form.elements.pledge_amount.value=record?.pledge_amount ?? 0; form.elements.pledge_redeemed.value=record?.pledge_redeemed ?? 0; form.elements.collection_method.value=record?.collection_method||"Cash"; form.elements.fund_id.value=record?.fund_id||form.elements.fund_id.value; form.elements.reference_number.value=record?.reference_number||""; form.elements.occasion.value=record?.occasion||"Birthday"; form.elements.description.value=record?.description||"";
      const savedService=record?.service_name||preset.serviceName||(HARVEST_TYPES.has(selectedType)?"Harvest Service":"Sunday Divine Service"); if(SERVICE_NAMES.includes(savedService)){form.elements.service_name.value=savedService;form.elements.custom_service_name.value="";}else{form.elements.service_name.value="Other";form.elements.custom_service_name.value=savedService;}
      const dialog=$("#financeCollectionDialog"); dialog.querySelector(".dialog-header h3").textContent=record?"Edit giving transaction":selectedType===MINI_HARVEST_TYPE?`Add ${form.elements.harvest_day.value} Mini-Harvest Record`:"Record collection"; dialog.querySelector('[type="submit"]').textContent=record?"Save changes":selectedType===MINI_HARVEST_TYPE?"Save Record":"Save collection";
      $$('[data-verify-option]',form).forEach(option=>option.disabled=!can("finance.verify")); updateCollectionConditionalFields();
    }
    if(type==="expense"){form.reset();form.elements.expense_date.value=todayIso();$$('[data-approve-option]',form).forEach(option=>option.disabled=!can("finance.approve"));}
  }

  function openForm(type, options = {}) {
    if(type!=="fund"&&!can("finance.manage")) return notify("You do not have permission to manage finance records.","error");
    if(type==="fund"&&!can("finance.settings")) return notify("Finance settings permission is required.","error");
    if(type==="remittance"){$("#financeRemittanceForm").reset();$("#financeRemittanceForm").elements.remittance_date.value=todayIso();const outstanding=districtTotals().outstanding;$("#financeRemittanceForm").elements.amount.max=String(outstanding);$("#financeRemittanceCap").textContent=`Outstanding balance: ${money.format(outstanding)}`;$("#financeRemittanceDialog").showModal();}
    if(type==="collection"){if(!state.funds.some(item=>item.is_active))return notify("Create an active fund before recording collections.","error");const record=options.recordId?state.collections.find(item=>item.id===options.recordId):null;populateForms("collection",record,options);$("#financeCollectionDialog").showModal();}
    if(type==="expense"){if(!state.funds.some(item=>item.is_active))return notify("Create an active fund before recording expenses.","error");populateForms("expense");$("#financeExpenseDialog").showModal();}
    if(type==="fund"){$("#financeFundForm").reset();$("#financeFundDialog").showModal();}
    if(type==="transfer"){const form=$("#financeTransferForm");form.reset();form.elements.transfer_date.value=todayIso();const options=state.funds.filter(item=>item.is_active).map(item=>`<option value="${item.id}">${esc(item.name)} · ${money.format(fundBalance(item).current)}</option>`).join("");form.elements.from_fund_id.innerHTML=options;form.elements.to_fund_id.innerHTML=options;if(form.elements.to_fund_id.options.length>1)form.elements.to_fund_id.selectedIndex=1;$("#financeTransferDialog").showModal();}
    refreshIcons();
  }

  function updateCollectionConditionalFields() {
    const form=$("#financeCollectionForm"); if(!form)return; const type=form.elements.collection_type.value; const amount=num(form.elements.amount.value);
    const isHarvest=HARVEST_TYPES.has(type); const pledge=num(form.elements.pledge_amount.value); const redeemed=num(form.elements.pledge_redeemed.value); const outstanding=Math.max(0,pledge-redeemed);
    $("#financeOccasionField").hidden=type!==VTO_TYPE; form.elements.occasion.required=type===VTO_TYPE;
    $("#financeHarvestDayField").hidden=type!==MINI_HARVEST_TYPE; form.elements.harvest_day.required=type===MINI_HARVEST_TYPE;
    $("#financeMainHarvestTitleField").hidden=type!==MAIN_HARVEST_TYPE; form.elements.harvest_title.required=type===MAIN_HARVEST_TYPE;
    const memberRequired=MEMBER_GIVING_TYPES.has(type); form.elements.member_id.required=memberRequired; $("#financeMemberField").hidden=isHarvest; $("#financeMemberField").classList.toggle("required-giver",memberRequired); $("#financeMemberHint").textContent=memberRequired?"Required: select the member who made this contribution.":"Optional for general church collections.";
    const customService=form.elements.service_name.value==="Other"; $("#financeCustomServiceField").hidden=!customService; form.elements.custom_service_name.required=customService;
    $("#financePledgeField").hidden=!isHarvest; $("#financePledgeRedeemedField").hidden=!isHarvest; $("#financeActualCollectionField").childNodes[0].nodeValue=isHarvest?"Actual Collection (GH₵)":"Amount (GH₵)"; form.elements.amount.min=isHarvest?"0":"0.01"; if(isHarvest&&form.elements.amount.value==="")form.elements.amount.value="0";
    const pledgePreview=$("#financePledgePreview"); pledgePreview.hidden=!isHarvest;
    if(isHarvest) pledgePreview.innerHTML=`<strong>Harvest position</strong><div><span>Pledge<b>${money.format(pledge)}</b></span><span>Pledge Redeemed<b>${money.format(redeemed)}</b></span></div><small class="${redeemed>pledge?"invalid":""}">Outstanding Pledge: ${money.format(outstanding)}${redeemed>pledge?" — Pledge Redeemed cannot exceed Pledge.":""}</small>`;
    const preview=$("#financeDistributionPreview"); const activeRule=distributionRule(type); preview.hidden=!DISTRIBUTION_TYPES.has(type);
    if(DISTRIBUTION_TYPES.has(type)) { const localShare=Math.round(amount*num(activeRule?.local_percentage)/100*100)/100; const districtShare=amount-localShare; preview.innerHTML=activeRule?`<strong>Automatic distribution</strong><div><span>Local Church — ${num(activeRule.local_percentage)}%<b>${money.format(localShare)}</b></span><span>${esc(activeRule.district_name)} — ${num(activeRule.district_percentage)}%<b>${money.format(districtShare)}</b></span></div><small>Eligible income distribution · Total: ${money.format(amount)}</small>`:`<strong>No active distribution rule for ${esc(type)}.</strong>`; }
  }

  function formError(id,message="") {const node=$(id);node.hidden=!message;node.textContent=message;}

  async function saveCollection(event) {
    event.preventDefault();const form=event.currentTarget;formError("#financeCollectionError");const values=Object.fromEntries(new FormData(form).entries());if(form.elements.collection_type.disabled)values.collection_type=form.elements.collection_type.value;if(form.elements.harvest_day.disabled)values.harvest_day=form.elements.harvest_day.value;
    const amount=num(values.amount);const pledgeAmount=num(values.pledge_amount);const pledgeRedeemed=num(values.pledge_redeemed);const isHarvest=HARVEST_TYPES.has(values.collection_type);const serviceName=values.service_name==="Other"?values.custom_service_name.trim():values.service_name;if(amount<0||pledgeAmount<0||pledgeRedeemed<0)return formError("#financeCollectionError","Financial amounts cannot be negative.");if(!isHarvest&&amount<=0)return formError("#financeCollectionError","Amount must be greater than zero.");if(isHarvest&&amount===0&&pledgeAmount===0&&pledgeRedeemed===0)return formError("#financeCollectionError","Enter an Actual Collection, Pledge, or Pledge Redeemed amount.");if(isHarvest&&pledgeRedeemed>pledgeAmount)return formError("#financeCollectionError","Pledge Redeemed cannot exceed Pledge.");if(!serviceName)return formError("#financeCollectionError","Enter the service or occasion.");if(MEMBER_GIVING_TYPES.has(values.collection_type)&&!values.member_id)return formError("#financeCollectionError",`Select the member who made this Tithe or ${VTO_TYPE} contribution.`);if(values.collection_type===MINI_HARVEST_TYPE&&!HARVEST_DAYS.includes(values.harvest_day))return formError("#financeCollectionError","Select a valid day from Sunday through Saturday.");if(values.collection_type===MAIN_HARVEST_TYPE&&!values.harvest_title.trim())return formError("#financeCollectionError","Enter the Main Harvest name or title.");if(DISTRIBUTION_TYPES.has(values.collection_type)&&!distributionRule(values.collection_type))return formError("#financeCollectionError",`Enable the ${values.collection_type} distribution rule first.`);
    const duplicate=state.collections.find(item=>item.id!==state.editingCollectionId&&item.status!=="Voided"&&item.collection_date===values.collection_date&&item.collection_type===values.collection_type&&(item.member_id||null)===(values.member_id||null)&&(item.harvest_day||null)===(values.collection_type===MINI_HARVEST_TYPE?values.harvest_day:null)&&(item.harvest_title||"").toLowerCase()===(values.collection_type===MAIN_HARVEST_TYPE?(values.harvest_title||"").trim().toLowerCase():"")&&serviceLabel(item).toLowerCase()===serviceName.toLowerCase());if(duplicate&&!confirm("A matching financial record already exists for this date, category, and record-keeping section. Save another record anyway?"))return;
    const {collection_id,custom_service_name,...cleanValues}=values;const payload={...cleanValues,service_name:serviceName,amount,pledge_amount:isHarvest?pledgeAmount:0,pledge_redeemed:isHarvest?pledgeRedeemed:0,event_id:values.event_id||null,member_id:isHarvest?null:values.member_id||null,harvest_day:values.collection_type===MINI_HARVEST_TYPE?values.harvest_day:null,harvest_title:values.collection_type===MAIN_HARVEST_TYPE?values.harvest_title.trim():null,reference_number:values.reference_number.trim()||null,occasion:values.collection_type===VTO_TYPE?values.occasion:null,description:values.description.trim()};
    const query=state.editingCollectionId?state.client.from("finance_collections").update(payload).eq("id",state.editingCollectionId):state.client.from("finance_collections").insert(payload);const {error}=await query;if(error)return formError("#financeCollectionError",error.message);$("#financeCollectionDialog").close();notify(state.editingCollectionId?"Giving transaction updated; the audit history was preserved.":"Giving transaction recorded and service totals updated automatically.");state.editingCollectionId=null;await load();
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

  async function saveRule(event) {event.preventDefault();formError("#financeRuleError");const form=event.currentTarget;const values=Object.fromEntries(new FormData(form).entries());const total=num(values.local_percentage)+num(values.district_percentage);if(total!==100)return formError("#financeRuleError","Local Church and district percentages must total exactly 100%.");const {error}=await state.client.from("finance_distribution_rules").update({district_name:values.district_name.trim(),local_percentage:num(values.local_percentage),district_percentage:num(values.district_percentage),enabled:values.enabled==="true"}).in("collection_type",Array.from(DISTRIBUTION_TYPES));if(error)return formError("#financeRuleError",error.message);notify("Distribution rules updated for Tithe, Adult, Children Service, and JY Offertory. Existing collections retain their historical snapshots.");await load();}

  function csvValue(value){const text=String(value??"");return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
  function exportCollections(){const rows=state.section==="reports"?filteredReportCollections():filteredCollections();const headers=["Date","Service / Occasion","Member","Giving Type","Harvest Day","Main Harvest Title","Harvest Period","Actual Collection (GHS)","Pledge (GHS)","Pledge Redeemed (GHS)","Outstanding Pledge (GHS)","Method","Status","Reference","Local Share","District Share","District","Recorded By","Created At"];const body=rows.map(item=>{const member=relation(item,"members")||state.members.find(entry=>entry.id===item.member_id);const harvest=HARVEST_TYPES.has(item.collection_type);const values=harvestRecordMetrics(item);return [item.collection_date,serviceLabel(item),member?fullName(member):"General collection",item.collection_type,item.harvest_day||"",item.harvest_title||"",item.harvest_period||"",values.actual,harvest?values.pledge:"",harvest?values.redeemed:"",harvest?values.outstanding:"",item.collection_method,item.status,item.reference_number||"",item.local_share,item.district_share,item.district_name_snapshot||"",item.recorded_by_name,item.created_at]});const blob=new Blob([[headers,...body].map(row=>row.map(csvValue).join(",")).join("\n")],{type:"text/csv;charset=utf-8"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="resurrection-giving-report.csv";link.click();URL.revokeObjectURL(link.href);}

  function bindEvents() {
    if(state.bound)return;state.bound=true;
    document.addEventListener("click",event=>{
      const sidebar=event.target.closest("[data-finance-section]");if(sidebar){state.section=sidebar.dataset.financeSection;state.harvestDay=sidebar.dataset.financeDay||null;state.page=1;render();}
      const tab=event.target.closest("[data-finance-tab]");if(tab){state.section=tab.dataset.financeTab;state.harvestDay=null;state.page=1;render();}
      const harvestDay=event.target.closest("[data-finance-harvest-day]")?.dataset.financeHarvestDay;if(harvestDay!==undefined){state.section="miniHarvest";state.harvestDay=harvestDay||null;state.page=1;render();}
      const open=event.target.closest("[data-finance-open]")?.dataset.financeOpen;if(open)openForm(open);
      const action=event.target.closest("#financePrimaryAction")?.dataset.financeAction;if(action)openForm(action);
      const close=event.target.closest("[data-close-finance]")?.dataset.closeFinance;if(close){$("#"+close)?.close();if(close==="financeCollectionDialog")state.editingCollectionId=null;}
      const page=event.target.closest("[data-finance-page]")?.dataset.financePage;if(page){state.page+=page==="next"?1:-1;$("#financeCollectionTable").innerHTML=activeCollectionTableMarkup();refreshIcons();}
      const editCollection=event.target.closest("[data-finance-edit-collection]")?.dataset.financeEditCollection;if(editCollection)openForm("collection",{recordId:editCollection});
      const count=event.target.closest("[data-finance-count]")?.dataset.financeCount;if(count)updateRecord("finance_collections",count,{status:"Counted"},"Collection marked as counted.");
      const verify=event.target.closest("[data-finance-verify]")?.dataset.financeVerify;if(verify)updateRecord("finance_collections",verify,{status:"Verified"},"Collection verified.");
      const expenseStatus=event.target.closest("[data-finance-expense-status]")?.dataset.financeExpenseStatus;if(expenseStatus){const [status,id]=expenseStatus.split(":");updateRecord("finance_expenses",id,{status},`Expense marked ${status.toLowerCase()}.`);}
      const voidSpec=event.target.closest("[data-finance-void]")?.dataset.financeVoid;if(voidSpec)voidRecord(voidSpec);
      if(event.target.closest("#financeRefresh"))load();if(event.target.closest("#financePrintReport"))window.print();if(event.target.closest("#financeExportReport"))exportCollections();
    });
    document.addEventListener("input",event=>{
      if(event.target.matches("#financeRecordSearch,#financeDateFrom,#financeDateTo,#financeTypeFilter,#financeHarvestDayFilter,#financeHarvestPeriodFilter,#financeMemberFilter,#financeServiceFilter,#financeStatusFilter")){state.page=1;$("#financeCollectionTable").innerHTML=activeCollectionTableMarkup();refreshIcons();}
      if(event.target.matches("#financeReportFrom,#financeReportTo,#financeReportType,#financeReportMember,#financeReportService"))renderReportResults();
      if(event.target.closest("#financeCollectionForm")&&["amount","pledge_amount","pledge_redeemed","collection_type","service_name","collection_date"].includes(event.target.name)){
        const form=event.target.form;
        if(event.target.name==="collection_type"&&HARVEST_TYPES.has(event.target.value))form.elements.service_name.value="Harvest Service";
        if(event.target.name==="collection_date"&&form.elements.collection_type.value===MINI_HARVEST_TYPE&&!state.harvestDay)form.elements.harvest_day.value=HARVEST_DAYS[dateFromIso(event.target.value).getDay()];
        updateCollectionConditionalFields();
      }
      if(event.target.closest("#financeRuleForm")&&["local_percentage","district_percentage"].includes(event.target.name))updateRuleTotal();
      if(event.target.matches("#financeGrowthType,#financeGrowthMetric,#financeGranularity,#financeComparison,#financeCustomStart,#financeCustomEnd")){if(event.target.id==="financeComparison")$("#financeCustomRange").hidden=event.target.value!=="custom";renderGrowthChart();}
    });
    document.addEventListener("change",event=>{if(event.target.matches('#financeCollectionForm [name="event_id"]')&&event.target.value){const selected=state.events.find(item=>item.id===event.target.value);const form=$("#financeCollectionForm");if(selected&&form){form.elements.collection_date.value=selected.event_date;if(SERVICE_NAMES.includes(selected.title))form.elements.service_name.value=selected.title;else{form.elements.service_name.value="Other";form.elements.custom_service_name.value=selected.title;}updateCollectionConditionalFields();}}});
    $("#financeCollectionForm").addEventListener("submit",saveCollection);$("#financeExpenseForm").addEventListener("submit",saveExpense);$("#financeRemittanceForm").addEventListener("submit",saveRemittance);$("#financeFundForm").addEventListener("submit",saveFund);$("#financeTransferForm").addEventListener("submit",saveTransfer);
    document.addEventListener("submit",event=>{if(event.target.id==="financeRuleForm")saveRule(event);});
  }

  async function initialize(context) {state.client=context.client;state.userId=context.userId;state.permissions=context.permissions||[];state.members=context.members||[];state.events=context.events||[];state.legacyTransactions=context.legacyTransactions||[];state.initialized=true;bindEvents();if(can("finance.view"))await load();else render();}
  function syncReferenceData(members,events){state.members=members||[];state.events=events||[];}
  function openCollection(type){state.section=Object.entries(sectionTypes).find(([,value])=>value===type)?.[0]||"collections";state.harvestDay=null;render();openForm("collection");}
  function openMemberGiving(memberId,type="Tithe"){state.section=type===VTO_TYPE?"vto":"tithes";state.harvestDay=null;render();openForm("collection",{memberId,type});}
  function getMemberGiving(memberId){return can("finance.view")?state.collections.filter(item=>item.member_id===memberId).slice().sort((a,b)=>b.collection_date.localeCompare(a.collection_date)||b.created_at.localeCompare(a.created_at)):[];}

  mount();
  window.FinanceModule={initialize,load,render,syncReferenceData,openCollection,openMemberGiving,getMemberGiving,serviceGivingTotals,aggregateSeries,harvestTotals,harvestMetrics,comparisonRange,getData:()=>({collections:state.collections.slice(),expenses:state.expenses.slice(),funds:state.funds.slice(),remittances:state.remittances.slice(),transfers:state.transfers.slice(),rules:state.rules.slice()})};
})();
