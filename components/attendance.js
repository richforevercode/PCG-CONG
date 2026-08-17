(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const OCCASIONS = [
    "Sunday Divine Service", "Thanksgiving Service", "Harvest Service",
    "Communion Service", "Youth Service", "Children's Service",
    "Evangelism Service", "Funeral Service", "Wedding Service",
    "Special Programme", "Other"
  ];
  const state = {
    client: null,
    userId: null,
    permissions: [],
    records: [],
    page: 1,
    editingId: null,
    viewOnly: false,
    loading: false,
    initialized: false,
    bound: false,
    onChange: null
  };

  const $ = selector => document.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const num = value => Math.max(0, Number.parseInt(value, 10) || 0);
  const dateFromIso = value => new Date(`${value}T00:00:00`);
  const dateFormat = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const monthFormat = new Intl.DateTimeFormat("en-GH", { month: "short", year: "numeric" });
  const formatDate = value => value ? dateFormat.format(dateFromIso(value)) : "—";
  const optionList = (values, selected = "") => values.map(value => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("");

  function totals(record = {}) {
    const adultMale = num(record.adult_male);
    const adultFemale = num(record.adult_female);
    const jyBoys = num(record.junior_youth_boys);
    const jyGirls = num(record.junior_youth_girls);
    const childrenBoys = num(record.children_boys);
    const childrenGirls = num(record.children_girls);
    const visitorMale = num(record.visitor_male);
    const visitorFemale = num(record.visitor_female);
    const legacyAdults = num(record.adults);
    const legacyChildren = num(record.children);
    const legacyVisitors = num(record.visitors);
    const adult = record.adult_total == null ? legacyAdults + adultMale + adultFemale : num(record.adult_total);
    const juniorYouth = record.junior_youth_total == null ? jyBoys + jyGirls : num(record.junior_youth_total);
    const children = record.children_total == null ? legacyChildren + childrenBoys + childrenGirls : num(record.children_total);
    const visitors = record.visitor_total == null ? legacyVisitors + visitorMale + visitorFemale : num(record.visitor_total);
    const maleBoys = record.male_boys_total == null ? adultMale + jyBoys + childrenBoys : num(record.male_boys_total);
    const femaleGirls = record.female_girls_total == null ? adultFemale + jyGirls + childrenGirls : num(record.female_girls_total);
    const regular = record.regular_total == null ? adult + juniorYouth + children : num(record.regular_total);
    const includeVisitors = record.include_visitors !== false;
    const grand = record.grand_total == null ? regular + (includeVisitors ? visitors : 0) : num(record.grand_total);
    return { adultMale, adultFemale, jyBoys, jyGirls, childrenBoys, childrenGirls, visitorMale, visitorFemale, legacyAdults, legacyChildren, legacyVisitors, adult, juniorYouth, children, visitors, maleBoys, femaleGirls, regular, grand, includeVisitors };
  }

  function mount() {
    const root = $("#attendanceModuleRoot");
    if (!root || root.dataset.mounted) return;
    root.dataset.mounted = "true";
    root.innerHTML = `
      <div class="page-heading attendance-heading">
        <div><p class="breadcrumb">Home <i data-lucide="chevron-right"></i> Attendance</p><h2>Church service attendance</h2><p>Record service statistics by adults, Junior Youth, children, gender, and visitors.</p></div>
        <button class="primary-btn" id="recordServiceAttendanceBtn" type="button" data-requires="attendance.manage"><i data-lucide="plus"></i> Record Service Attendance</button>
      </div>
      <div class="attendance-module-message" id="attendanceModuleMessage" hidden></div>
      <div id="attendanceModuleContent"><div class="attendance-loading"><i data-lucide="loader-circle"></i> Loading attendance statistics…</div></div>

      <dialog id="serviceAttendanceDialog" class="service-attendance-dialog" aria-labelledby="serviceAttendanceDialogTitle">
        <form id="serviceAttendanceForm">
          <div class="dialog-header"><div><p class="eyebrow">ATTENDANCE REGISTER</p><h3 id="serviceAttendanceDialogTitle">Record Service Attendance</h3></div><button class="icon-btn" type="button" data-close-service-attendance aria-label="Close"><i data-lucide="x"></i></button></div>
          <div class="service-attendance-body">
            <section class="attendance-context-fields">
              <label>Date<input id="serviceAttendanceDate" name="service_date" type="date" required></label>
              <label>Occasion / Service<select id="serviceAttendanceOccasion" name="occasion_type" required><option value="">Select an occasion</option>${optionList(OCCASIONS)}</select></label>
              <label class="attendance-custom-occasion" id="customOccasionField" hidden>Custom occasion<input id="customAttendanceOccasion" name="custom_occasion" maxlength="120" placeholder="Enter the occasion name"></label>
            </section>

            <div class="attendance-entry-grid">
              ${categoryCard("Adult Service", "users", "adult_male", "Male", "adult_female", "Female", "adultTotalPreview")}
              ${categoryCard("Junior Youth (JY)", "users-round", "junior_youth_boys", "Boys", "junior_youth_girls", "Girls", "jyTotalPreview")}
              ${categoryCard("Children Service", "baby", "children_boys", "Boys", "children_girls", "Girls", "childrenTotalPreview")}
              ${categoryCard("Visitors", "user-plus", "visitor_male", "Male visitors", "visitor_female", "Female visitors", "visitorTotalPreview", true)}
            </div>

            <label class="visitors-inclusion"><input id="includeVisitorsInGrandTotal" name="include_visitors" type="checkbox" checked><span><strong>Include visitors in Grand Attendance</strong><small>Regular attendance remains separate. Turn this off if your reporting policy excludes visitors from the grand total.</small></span></label>
            <div class="legacy-attendance-note" id="legacyAttendanceNote" hidden></div>
            <section class="attendance-entry-summary" aria-live="polite">
              <div><span>Male / Boys</span><strong id="maleBoysPreview">0</strong></div>
              <div><span>Female / Girls</span><strong id="femaleGirlsPreview">0</strong></div>
              <div><span>Regular Attendance</span><strong id="regularTotalPreview">0</strong></div>
              <div><span>Total Visitors</span><strong id="summaryVisitorsPreview">0</strong></div>
              <div class="grand-attendance-preview"><span>Grand Attendance</span><strong id="grandTotalPreview">0</strong></div>
            </section>
            <p class="attendance-form-error" id="serviceAttendanceFormError" role="alert" hidden></p>
          </div>
          <div class="dialog-footer"><button class="secondary-btn" type="button" data-close-service-attendance>Cancel</button><button class="primary-btn" id="saveServiceAttendanceBtn" type="submit"><i data-lucide="save"></i> Save attendance</button></div>
        </form>
      </dialog>`;
  }

  function categoryCard(title, icon, firstName, firstLabel, secondName, secondLabel, totalId, visitor = false) {
    return `<section class="attendance-entry-card ${visitor ? "visitor-card" : ""}"><div class="attendance-entry-card-title"><span><i data-lucide="${icon}"></i></span><h4>${esc(title)}</h4></div><div class="attendance-number-fields"><label>${esc(firstLabel)}<input name="${firstName}" type="number" min="0" step="1" inputmode="numeric" value="0"></label><label>${esc(secondLabel)}<input name="${secondName}" type="number" min="0" step="1" inputmode="numeric" value="0"></label></div><div class="attendance-category-total"><span>Total</span><strong id="${totalId}">0</strong></div></section>`;
  }

  function metric(label, value, note, icon, tone = "blue") {
    return `<article class="attendance-stat-metric ${tone}"><div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div><i data-lucide="${icon}"></i></article>`;
  }

  function sortedRecords() {
    return state.records.slice().sort((left, right) => String(right.service_date).localeCompare(String(left.service_date)) || String(right.created_at).localeCompare(String(left.created_at)));
  }

  function renderMetrics() {
    const latest = sortedRecords()[0];
    if (!latest) return `<div class="attendance-stat-grid">${[
      ["Current Attendance", "0", "No service recorded", "users", "blue"],
      ["Adult Service", "0", "Latest service", "users-round", "blue"],
      ["Junior Youth", "0", "Latest service", "users", "orange"],
      ["Children Service", "0", "Latest service", "baby", "green"],
      ["Male / Boys", "0", "Latest regular attendance", "person-standing", "blue"],
      ["Female / Girls", "0", "Latest regular attendance", "person-standing", "red"],
      ["Visitors", "0", "Latest service", "user-plus", "orange"],
      ["Services Recorded", "0", "Attendance history", "calendar-check", "green"]
    ].map(args => metric(...args)).join("")}</div>`;
    const value = totals(latest);
    return `<div class="attendance-stat-grid">
      ${metric("Current Attendance", value.grand, `${latest.service_name} · ${formatDate(latest.service_date)}`, "users", "blue")}
      ${metric("Adult Service", value.adult, "Latest service", "users-round", "blue")}
      ${metric("Junior Youth", value.juniorYouth, "Latest service", "users", "orange")}
      ${metric("Children Service", value.children, "Latest service", "baby", "green")}
      ${metric("Male / Boys", value.maleBoys, "Regular attendance", "person-standing", "blue")}
      ${metric("Female / Girls", value.femaleGirls, "Regular attendance", "person-standing", "red")}
      ${metric("Visitors", value.visitors, value.includeVisitors ? "Included in grand total" : "Excluded from grand total", "user-plus", "orange")}
      ${metric("Services Recorded", state.records.length, "Attendance history", "calendar-check", "green")}
    </div>`;
  }

  function weekStart(value) {
    const date = dateFromIso(value);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    return date.toISOString().slice(0, 10);
  }

  function categoryValue(record, category) {
    const value = totals(record);
    return category === "adult" ? value.adult : category === "jy" ? value.juniorYouth : category === "children" ? value.children : category === "visitors" ? value.visitors : value.grand;
  }

  function trendSeries(records, period = "service", category = "total") {
    if (period === "service") return records.slice().sort((a, b) => a.service_date.localeCompare(b.service_date) || a.service_name.localeCompare(b.service_name)).map(record => ({ key: record.id, label: new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short" }).format(dateFromIso(record.service_date)), title: record.service_name, value: categoryValue(record, category) }));
    const grouped = new Map();
    records.forEach(record => {
      const key = period === "daily" ? record.service_date : period === "weekly" ? weekStart(record.service_date) : record.service_date.slice(0, 7);
      if (!grouped.has(key)) grouped.set(key, { key, value: 0, count: 0 });
      grouped.get(key).value += categoryValue(record, category);
      grouped.get(key).count += 1;
    });
    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key)).map(item => ({ ...item, label: period === "monthly" ? monthFormat.format(dateFromIso(`${item.key}-01`)) : new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short" }).format(dateFromIso(item.key)), title: period === "daily" ? formatDate(item.key) : period === "weekly" ? `Week of ${formatDate(item.key)}` : monthFormat.format(dateFromIso(`${item.key}-01`)) }));
  }

  function trendMarkup() {
    return `<article class="card church-attendance-trend-card"><div class="attendance-card-heading"><div><p class="eyebrow">ATTENDANCE GROWTH</p><h3>Attendance trends over time</h3></div><div class="attendance-chart-controls"><select id="attendanceTrendCategory" aria-label="Attendance category"><option value="total">Total Attendance</option><option value="adult">Adult Service</option><option value="jy">Junior Youth</option><option value="children">Children Service</option><option value="visitors">Visitors</option></select><select id="attendanceTrendPeriod" aria-label="Attendance period"><option value="service">By service</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select><select id="attendanceTrendOccasion" aria-label="Filter trend by occasion"><option value="all">All occasions</option>${optionList(Array.from(new Set(state.records.map(record => record.occasion_type || record.service_name))).sort())}</select></div></div><div id="churchAttendanceTrendChart" class="church-attendance-trend-chart"></div><div class="attendance-growth-stats"><div><span>Current Attendance</span><strong id="attendanceCurrentStat">0</strong></div><div><span>Previous Attendance</span><strong id="attendancePreviousStat">0</strong></div><div><span>Percentage Change</span><strong class="attendance-growth-badge stable" id="attendanceChangeStat"><i data-lucide="minus"></i> 0% Stable</strong></div></div><div class="attendance-chart-legend"><span><i class="increase"></i> Increasing</span><span><i class="decrease"></i> Decreasing</span><span><i class="unchanged"></i> Stable</span></div></article>`;
  }

  function renderTrend() {
    const container = $("#churchAttendanceTrendChart");
    if (!container) return;
    const category = $("#attendanceTrendCategory")?.value || "total";
    const period = $("#attendanceTrendPeriod")?.value || "service";
    const occasion = $("#attendanceTrendOccasion")?.value || "all";
    const records = state.records.filter(record => occasion === "all" || (record.occasion_type || record.service_name) === occasion);
    const series = trendSeries(records, period, category).slice(-12);
    if (!series.length) {
      container.innerHTML = `<div class="attendance-empty compact"><i data-lucide="chart-no-axes-combined"></i><p>Attendance growth will appear after a service is recorded.</p></div>`;
      updateGrowthStats([]);
      refreshIcons();
      return;
    }
    const width = 780, height = 270, left = 48, right = 24, top = 32, bottom = 52;
    const max = Math.max(4, Math.ceil(Math.max(...series.map(item => item.value), 1) / 4) * 4);
    const points = series.map((item, index) => ({ ...item, x: series.length === 1 ? left + (width - left - right) / 2 : left + index * (width - left - right) / (series.length - 1), y: top + (max - item.value) / max * (height - top - bottom) }));
    const grid = [0, 1, 2, 3, 4].map(index => { const y = top + index / 4 * (height - top - bottom); const tick = Math.round(max * (4 - index) / 4); return `<line class="attendance-chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="attendance-chart-axis-label" x="${left - 8}" y="${y + 4}" text-anchor="end">${tick}</text>`; }).join("");
    const segments = points.slice(1).map((point, index) => { const previous = points[index]; const direction = point.value > previous.value ? "increase" : point.value < previous.value ? "decrease" : "unchanged"; return `<line class="attendance-trend-segment ${direction}" x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}"></line>`; }).join("");
    const dots = points.map(point => `<g><circle class="attendance-chart-dot" cx="${point.x}" cy="${point.y}" r="5"><title>${esc(point.title)}: ${point.value}</title></circle><text class="attendance-chart-value" x="${point.x}" y="${point.y - 12}" text-anchor="middle">${point.value}</text><text class="attendance-chart-date" x="${point.x}" y="${height - 20}" text-anchor="middle">${esc(point.label)}</text></g>`).join("");
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Attendance growth chart">${grid}${segments}${dots}</svg>`;
    updateGrowthStats(series);
    refreshIcons();
  }

  function updateGrowthStats(series) {
    const current = series.at(-1)?.value || 0;
    const previous = series.at(-2)?.value || 0;
    const difference = current - previous;
    const percentage = previous ? Math.abs(difference) / previous * 100 : difference ? null : 0;
    const direction = difference > 0 ? "increase" : difference < 0 ? "decrease" : "stable";
    const badge = $("#attendanceChangeStat");
    if ($("#attendanceCurrentStat")) $("#attendanceCurrentStat").textContent = current;
    if ($("#attendancePreviousStat")) $("#attendancePreviousStat").textContent = series.length > 1 ? previous : "—";
    if (badge) {
      const text = percentage === null ? "New growth" : `${Math.abs(percentage).toFixed(1)}% ${direction === "stable" ? "Stable" : direction === "increase" ? "Increase" : "Decrease"}`;
      badge.className = `attendance-growth-badge ${direction}`;
      badge.innerHTML = `<i data-lucide="${direction === "increase" ? "trending-up" : direction === "decrease" ? "trending-down" : "minus"}"></i> ${esc(text)}`;
    }
  }

  function historyFiltersMarkup() {
    return `<div class="attendance-history-filters"><label class="attendance-history-search"><i data-lucide="search"></i><input id="attendanceHistorySearch" type="search" placeholder="Search occasion or recorder…"></label><input id="attendanceDateFrom" type="date" aria-label="Attendance from date"><input id="attendanceDateTo" type="date" aria-label="Attendance to date"><select id="attendanceOccasionFilter" aria-label="Filter by occasion"><option value="all">All occasions</option>${optionList(Array.from(new Set(state.records.map(record => record.occasion_type || record.service_name))).sort())}</select><button class="secondary-btn" id="clearAttendanceHistoryFilters" type="button"><i data-lucide="list-filter"></i> Clear</button></div>`;
  }

  function filteredRecords() {
    const search = ($("#attendanceHistorySearch")?.value || "").trim().toLowerCase();
    const from = $("#attendanceDateFrom")?.value || "";
    const to = $("#attendanceDateTo")?.value || "";
    const occasion = $("#attendanceOccasionFilter")?.value || "all";
    return sortedRecords().filter(record => !search || `${record.service_name} ${record.occasion_type || ""} ${record.recorded_by_name || ""}`.toLowerCase().includes(search)).filter(record => !from || record.service_date >= from).filter(record => !to || record.service_date <= to).filter(record => occasion === "all" || (record.occasion_type || record.service_name) === occasion);
  }

  function historyTableMarkup() {
    const records = filteredRecords();
    const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const rows = records.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    return `<div class="table-scroll"><table class="service-attendance-table"><thead><tr><th>Date / Occasion</th><th>Adult</th><th>JY</th><th>Children</th><th>Male / Boys</th><th>Female / Girls</th><th>Visitors</th><th>Grand Total</th><th>Recorded by</th><th></th></tr></thead><tbody>${rows.length ? rows.map(record => { const value = totals(record); return `<tr><td><strong>${formatDate(record.service_date)}</strong><small>${esc(record.service_name)}</small></td><td>${value.adult}</td><td>${value.juniorYouth}</td><td>${value.children}</td><td>${value.maleBoys}</td><td>${value.femaleGirls}</td><td>${value.visitors}<small>${value.includeVisitors ? "Included" : "Excluded"}</small></td><td class="attendance-grand-cell">${value.grand}</td><td>${esc(record.recorded_by_name || "Administrator")}</td><td><div class="row-actions"><button class="icon-btn" type="button" data-view-service-attendance="${record.id}" title="View attendance"><i data-lucide="eye"></i></button>${can("attendance.manage") ? `<button class="icon-btn" type="button" data-edit-service-attendance="${record.id}" title="Edit attendance"><i data-lucide="pencil"></i></button><button class="icon-btn delete" type="button" data-delete-service-attendance="${record.id}" title="Delete attendance"><i data-lucide="trash-2"></i></button>` : ""}</div></td></tr>`; }).join("") : `<tr><td colspan="10"><div class="attendance-empty"><i data-lucide="clipboard-x"></i><p>No attendance records match these filters.</p></div></td></tr>`}</tbody></table></div><div class="table-footer"><span>${records.length ? `Showing ${(state.page - 1) * PAGE_SIZE + 1}–${Math.min(state.page * PAGE_SIZE, records.length)} of ${records.length} records` : "No attendance records"}</span><div class="pagination"><button type="button" data-attendance-page="previous" ${state.page === 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button><button class="active" type="button">${state.page}</button><button type="button" data-attendance-page="next" ${state.page === totalPages ? "disabled" : ""}><i data-lucide="chevron-right"></i></button></div></div>`;
  }

  function historyMarkup() {
    return `<article class="card service-attendance-history"><div class="attendance-card-heading"><div><p class="eyebrow">ATTENDANCE HISTORY</p><h3>Recorded services and occasions</h3></div></div>${historyFiltersMarkup()}<div id="attendanceHistoryTable">${historyTableMarkup()}</div></article>`;
  }

  function renderReport() {
    const container = $("#attendanceReportSummary");
    if (!container) return;
    const recent = sortedRecords().slice(0, 8);
    container.innerHTML = recent.length ? `<div class="attendance-report-grid">${recent.map(record => { const value = totals(record); return `<div class="attendance-report-item"><div><div><strong>${esc(record.service_name)}</strong><small>${formatDate(record.service_date)}</small></div><span class="attendance-report-rate">${value.grand}</span></div><div class="attendance-report-counts"><span>${value.adult} adults</span><span>${value.juniorYouth} JY</span><span>${value.children} children</span><span>${value.maleBoys} male/boys</span><span>${value.femaleGirls} female/girls</span><span>${value.visitors} visitors</span></div></div>`; }).join("")}</div>` : `<div class="empty-state compact"><i data-lucide="chart-no-axes-column"></i><p>Attendance reports will appear after a service is recorded.</p></div>`;
  }

  function render() {
    const content = $("#attendanceModuleContent");
    if (!content) return;
    $("#recordServiceAttendanceBtn").hidden = !can("attendance.manage");
    if (state.loading) {
      content.innerHTML = `<div class="attendance-loading"><i data-lucide="loader-circle"></i> Loading attendance statistics…</div>`;
      refreshIcons();
      return;
    }
    content.innerHTML = `${renderMetrics()}${trendMarkup()}${historyMarkup()}`;
    renderTrend();
    renderReport();
    refreshIcons();
  }

  function setMessage(message = "", type = "error") {
    const node = $("#attendanceModuleMessage");
    if (!node) return;
    node.hidden = !message;
    node.className = `attendance-module-message ${type}`;
    node.textContent = message;
  }

  async function load() {
    if (!state.client || !can("attendance.view")) return;
    state.loading = true;
    setMessage();
    render();
    const fields = "id,service_name,service_date,occasion_type,adults,children,visitors,adult_male,adult_female,junior_youth_boys,junior_youth_girls,children_boys,children_girls,visitor_male,visitor_female,include_visitors,adult_total,junior_youth_total,children_total,visitor_total,male_boys_total,female_girls_total,regular_total,grand_total,recorded_by,recorded_by_name,created_at,updated_at";
    const { data, error } = await state.client.from("attendance_records").select(fields).order("service_date", { ascending: false }).order("created_at", { ascending: false });
    state.loading = false;
    if (error) {
      setMessage(`Unable to load church attendance statistics. Confirm the latest Supabase attendance migration has been applied. ${error.message}`);
      state.records = [];
      render();
      return;
    }
    state.records = data || [];
    render();
    if (typeof state.onChange === "function") state.onChange(state.records.slice());
  }

  function formValues() {
    const form = $("#serviceAttendanceForm");
    const values = Object.fromEntries(new FormData(form).entries());
    const numericFields = ["adult_male", "adult_female", "junior_youth_boys", "junior_youth_girls", "children_boys", "children_girls", "visitor_male", "visitor_female"];
    numericFields.forEach(field => { values[field] = num(values[field]); });
    values.include_visitors = form.elements.include_visitors.checked;
    values.service_name = values.occasion_type === "Other" ? values.custom_occasion.trim() : values.occasion_type;
    delete values.custom_occasion;
    return values;
  }

  function calculateFormTotals() {
    const form = $("#serviceAttendanceForm");
    if (!form) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const existing = state.editingId ? state.records.find(record => record.id === state.editingId) : null;
    const value = totals({ ...values, adults: existing?.adults || 0, children: existing?.children || 0, visitors: existing?.visitors || 0, include_visitors: form.elements.include_visitors.checked });
    $("#adultTotalPreview").textContent = value.adult;
    $("#jyTotalPreview").textContent = value.juniorYouth;
    $("#childrenTotalPreview").textContent = value.children;
    $("#visitorTotalPreview").textContent = value.visitors;
    $("#maleBoysPreview").textContent = value.maleBoys;
    $("#femaleGirlsPreview").textContent = value.femaleGirls;
    $("#regularTotalPreview").textContent = value.regular;
    $("#summaryVisitorsPreview").textContent = value.visitors;
    $("#grandTotalPreview").textContent = value.grand;
  }

  function toggleCustomOccasion() {
    const custom = $("#serviceAttendanceOccasion").value === "Other";
    $("#customOccasionField").hidden = !custom;
    $("#customAttendanceOccasion").required = custom;
  }

  function showFormError(message = "") {
    const node = $("#serviceAttendanceFormError");
    node.hidden = !message;
    node.textContent = message;
  }

  function openRecord(record = null, viewOnly = false) {
    if (!record && !can("attendance.manage")) return notify("You do not have permission to record attendance.", "error");
    state.editingId = record?.id || null;
    state.viewOnly = viewOnly;
    const form = $("#serviceAttendanceForm");
    form.reset();
    form.elements.service_date.value = record?.service_date || todayIso();
    form.elements.service_date.max = todayIso();
    const occasionType = record?.occasion_type || record?.service_name || "";
    const standard = OCCASIONS.includes(occasionType) && occasionType !== "Other";
    form.elements.occasion_type.value = record ? (standard ? occasionType : "Other") : "";
    form.elements.custom_occasion.value = record && !standard ? record.service_name : "";
    ["adult_male", "adult_female", "junior_youth_boys", "junior_youth_girls", "children_boys", "children_girls", "visitor_male", "visitor_female"].forEach(field => { form.elements[field].value = num(record?.[field]); });
    form.elements.include_visitors.checked = record?.include_visitors !== false;
    const legacy = record ? totals(record) : null;
    const legacyCount = legacy ? legacy.legacyAdults + legacy.legacyChildren + legacy.legacyVisitors : 0;
    const note = $("#legacyAttendanceNote");
    note.hidden = !legacyCount;
    note.innerHTML = legacyCount ? `<i data-lucide="info"></i><span>This historical record includes unclassified legacy totals: ${legacy.legacyAdults} adults, ${legacy.legacyChildren} children, and ${legacy.legacyVisitors} visitors. They remain included without inventing a gender split.</span>` : "";
    $("#serviceAttendanceDialogTitle").textContent = viewOnly ? "Attendance Details" : record ? "Edit Service Attendance" : "Record Service Attendance";
    $("#saveServiceAttendanceBtn").hidden = viewOnly;
    $$("input, select", form).forEach(field => { field.disabled = viewOnly; });
    $$('[data-close-service-attendance]').forEach(button => { button.disabled = false; });
    toggleCustomOccasion();
    calculateFormTotals();
    showFormError();
    $("#serviceAttendanceDialog").showModal();
    refreshIcons();
  }

  async function save(event) {
    event.preventDefault();
    showFormError();
    const values = formValues();
    if (!values.service_date) return showFormError("Select a valid attendance date.");
    if (!values.service_name) return showFormError("Select or enter an occasion or service.");
    if (Object.values(values).some(value => typeof value === "number" && (!Number.isInteger(value) || value < 0))) return showFormError("Attendance counts must be whole numbers of zero or more.");
    const duplicate = state.records.find(record => record.id !== state.editingId && record.service_date === values.service_date && record.service_name.trim().toLowerCase() === values.service_name.toLowerCase());
    let targetId = state.editingId;
    if (duplicate) {
      if (!confirm(`Attendance already exists for ${values.service_name} on ${formatDate(values.service_date)}. Update the existing record with these figures?`)) return;
      targetId = duplicate.id;
    }
    const payload = { ...values };
    if (!targetId) Object.assign(payload, { adults: 0, children: 0, visitors: 0 });
    const query = targetId ? state.client.from("attendance_records").update(payload).eq("id", targetId) : state.client.from("attendance_records").insert(payload);
    const { error } = await query;
    if (error) return showFormError(error.message);
    $("#serviceAttendanceDialog").close();
    notify(targetId ? "Service attendance updated." : "Service attendance recorded.");
    await load();
  }

  async function remove(id) {
    if (!can("attendance.manage")) return;
    const record = state.records.find(item => item.id === id);
    if (!record || !confirm(`Delete attendance for ${record.service_name} on ${formatDate(record.service_date)}?`)) return;
    const { error } = await state.client.from("attendance_records").delete().eq("id", id);
    if (error) return notify(error.message, "error");
    notify("Attendance record deleted.");
    await load();
  }

  function rerenderHistory() {
    const container = $("#attendanceHistoryTable");
    if (container) container.innerHTML = historyTableMarkup();
    refreshIcons();
  }

  function bindEvents() {
    if (state.bound) return;
    state.bound = true;
    $("#recordServiceAttendanceBtn").addEventListener("click", () => openRecord());
    $("#serviceAttendanceForm").addEventListener("submit", save);
    $$('[data-close-service-attendance]').forEach(button => button.addEventListener("click", () => $("#serviceAttendanceDialog").close()));
    $("#serviceAttendanceForm").addEventListener("input", event => {
      if (event.target.type === "number" && event.target.value !== "") event.target.value = String(num(event.target.value));
      if (event.target.id === "serviceAttendanceOccasion") toggleCustomOccasion();
      calculateFormTotals();
    });
    $("#serviceAttendanceForm").addEventListener("change", event => {
      if (event.target.id === "serviceAttendanceOccasion") toggleCustomOccasion();
      calculateFormTotals();
    });
    document.addEventListener("click", event => {
      const viewId = event.target.closest("[data-view-service-attendance]")?.dataset.viewServiceAttendance;
      if (viewId) openRecord(state.records.find(record => record.id === viewId), true);
      const editId = event.target.closest("[data-edit-service-attendance]")?.dataset.editServiceAttendance;
      if (editId) openRecord(state.records.find(record => record.id === editId));
      const deleteId = event.target.closest("[data-delete-service-attendance]")?.dataset.deleteServiceAttendance;
      if (deleteId) remove(deleteId);
      const page = event.target.closest("[data-attendance-page]")?.dataset.attendancePage;
      if (page) { state.page += page === "next" ? 1 : -1; rerenderHistory(); }
      if (event.target.closest("#clearAttendanceHistoryFilters")) { ["#attendanceHistorySearch", "#attendanceDateFrom", "#attendanceDateTo"].forEach(selector => { $(selector).value = ""; }); $("#attendanceOccasionFilter").value = "all"; state.page = 1; rerenderHistory(); }
    });
    document.addEventListener("input", event => {
      if (event.target.matches("#attendanceHistorySearch,#attendanceDateFrom,#attendanceDateTo,#attendanceOccasionFilter")) { state.page = 1; rerenderHistory(); }
      if (event.target.matches("#attendanceTrendCategory,#attendanceTrendPeriod,#attendanceTrendOccasion")) renderTrend();
    });
    document.addEventListener("change", event => {
      if (event.target.matches("#attendanceDateFrom,#attendanceDateTo,#attendanceOccasionFilter")) { state.page = 1; rerenderHistory(); }
      if (event.target.matches("#attendanceTrendCategory,#attendanceTrendPeriod,#attendanceTrendOccasion")) renderTrend();
    });
  }

  async function initialize(context) {
    state.client = context.client;
    state.userId = context.userId;
    state.permissions = context.permissions || [];
    state.records = context.records || [];
    state.onChange = context.onChange || null;
    state.initialized = true;
    bindEvents();
    const reportCard = $("#attendanceReportSummary")?.closest(".attendance-report-card");
    if (reportCard) reportCard.hidden = !can("attendance.view");
    if (can("attendance.view")) await load(); else render();
  }

  function syncReferenceData() {}
  function openTakeAttendance() { openRecord(); }

  mount();
  window.AttendanceModule = {
    initialize,
    load,
    render,
    openTakeAttendance,
    syncReferenceData,
    totals,
    trendSeries,
    summarizeRecords: records => records.map(record => ({ ...record, ...totals(record) })),
    getRecords: () => state.records.slice()
  };
})();
