(function () {
  "use strict";

  const money = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 0 });
  const dateFormat = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const longDateFormat = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "long", year: "numeric" });
  const shortDate = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short" });
  const nameCollator = new Intl.Collator("en-GH", { sensitivity: "base" });

  const seed = { members: [], transactions: [], events: [], attendance_records: [] };
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);
  let lastClassificationDate = todayIso();

  const state = {
    page: "dashboard",
    dataMode: "demo",
    client: null,
    user: null,
    userProfile: null,
    permissions: [],
    members: [],
    transactions: [],
    events: [],
    attendance_records: [],
    dialogType: null,
    editingId: null,
    viewingMemberId: null,
    userManagementInitialized: false,
    generationalGroupsInitialized: false,
    attendanceInitialized: false,
    financeInitialized: false
  };

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const initials = person => `${person.first_name?.[0] || ""}${person.last_name?.[0] || ""}`.toUpperCase();
  const fullName = person => `${person.first_name || ""} ${person.last_name || ""}`.trim();
  const memberClassification = member => window.GenerationalGroups?.classify(member) || { age: null, code: "rules-unavailable", group: null, matches: [] };
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  const hasPermission = permission => state.permissions.includes(permission);

  function classificationPresentation(classification) {
    if (classification.code === "matched") return { label: classification.group.name, note: `Age ${classification.age}`, warning: false };
    if (classification.code === "missing-date") return { label: "Date of birth required", note: "Not yet classified", warning: true };
    if (classification.code === "invalid-date") return { label: "Invalid date of birth", note: "Review member record", warning: true };
    if (classification.code === "future-date") return { label: "Future date of birth", note: "Review member record", warning: true };
    if (classification.code === "multiple-matches") return { label: "Configuration conflict", note: `${classification.matches.length} rules match`, warning: true };
    if (classification.code === "rules-unavailable") return { label: "Rules unavailable", note: "Configuration not loaded", warning: true };
    return { label: "No matching active group", note: classification.age === null ? "Not classified" : `Age ${classification.age}`, warning: true };
  }

  function formatMemberDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Not provided";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "Invalid date" : longDateFormat.format(date);
  }
  const pagePermissions = {
    dashboard: "dashboard.view",
    members: "members.view",
    attendance: "attendance.view",
    finance: "finance.view",
    events: "events.view",
    reports: "reports.view",
    users: "users.manage",
    settings: "settings.manage"
  };

  function getAdminProfile() {
    const stored = JSON.parse(localStorage.getItem("pcg_admin_profile") || "null") || {};
    const metadata = state.user?.user_metadata || {};
    const role = Array.isArray(state.userProfile?.app_roles) ? state.userProfile.app_roles[0] : state.userProfile?.app_roles;
    const email = state.user?.email || stored.email || "";
    const emailName = email ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()) : "";
    return {
      name: state.userProfile?.display_name || metadata.display_name || stored.display_name || emailName || "Church Admin",
      role: role?.name || metadata.church_role || stored.church_role || "Administrator",
      phone: state.userProfile?.phone || metadata.phone || stored.phone || "",
      email,
      mode: state.dataMode
    };
  }

  function updateProfileUI() {
    window.ProfileController?.render(getAdminProfile());
    refreshIcons();
  }

  function getStoredData(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(`pcg_${key}`));
      return Array.isArray(parsed) ? parsed : structuredClone(seed[key]);
    } catch (_) {
      return structuredClone(seed[key]);
    }
  }

  function storeDemoData(key) {
    localStorage.setItem(`pcg_${key}`, JSON.stringify(state[key]));
  }

  function removeLegacyDemoData() {
    const legacyIds = {
      members: new Set(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]),
      transactions: new Set(["t1", "t2", "t3", "t4", "t5", "t6"]),
      events: new Set(["e1", "e2", "e3", "e4", "e5"]),
      attendance_records: new Set()
    };
    Object.entries(legacyIds).forEach(([key, ids]) => {
      const records = getStoredData(key).filter(record => !ids.has(record.id));
      localStorage.setItem(`pcg_${key}`, JSON.stringify(records));
    });
  }

  function toast(message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.innerHTML = `<i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}"></i><span>${esc(message)}</span>`;
    $("#toastRegion").append(node);
    refreshIcons();
    setTimeout(() => node.remove(), 3300);
  }

  function navigate(page, updateUrl = true) {
    if (!$("#page-" + page)) return;
    const requiredPermission = pagePermissions[page];
    if (requiredPermission && !hasPermission(requiredPermission)) {
      const fallback = Object.keys(pagePermissions).find(candidate => hasPermission(pagePermissions[candidate]));
      if (fallback && fallback !== page) return navigate(fallback, updateUrl);
      return toast("Your role does not provide access to this area.", "error");
    }
    state.page = page;
    $$(".page").forEach(item => item.classList.toggle("active", item.id === `page-${page}`));
    $$(".nav-item[data-page]").forEach(item => item.classList.toggle("active", item.dataset.page === page));
    document.title = `${$("#page-" + page).dataset.pageTitle} • Resurrection Congregation`;
    if (updateUrl && location.hash !== `#${page}`) history.pushState({ page }, "", `#${page}`);
    closeMobileMenu();
    $("#mainContent").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeMobileMenu() {
    window.SidebarController?.close({ restoreFocus: false });
  }

  function applyPermissions() {
    $$('[data-requires]').forEach(element => {
      element.hidden = !hasPermission(element.dataset.requires);
    });
    $$('[data-action="add-member"]').forEach(element => { element.hidden = !hasPermission("members.manage"); });
    $$('[data-action="add-transaction"]').forEach(element => { element.hidden = !hasPermission("finance.manage"); });
    $$('[data-action="add-event"]').forEach(element => { element.hidden = !hasPermission("events.manage"); });
    $$('[data-action="add-attendance"]').forEach(element => { element.hidden = !hasPermission("attendance.manage"); });
    $("#quickAddBtn").hidden = !["members.manage", "attendance.manage", "finance.manage", "events.manage"].some(hasPermission);
    const settingsProfileAction = $('[data-profile-action="settings"]');
    if (settingsProfileAction) settingsProfileAction.hidden = !hasPermission("settings.manage");
  }

  function metricCard(label, value, note, icon, accent = "#0a3995") {
    return `<article class="metric-card" style="--accent:${accent}"><div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div><div class="metric-icon"><i data-lucide="${icon}"></i></div></article>`;
  }

  function renderDashboard() {
    const now = new Date();
    const currentMonth = monthKey(now);
    const today = todayIso();
    const inThirtyDays = new Date(now);
    inThirtyDays.setDate(inThirtyDays.getDate() + 30);
    const horizon = inThirtyDays.toISOString().slice(0, 10);
    const active = state.members.filter(m => m.status === "Active").length;
    const visitors = state.members.filter(m => m.status === "Visitor").length;
    const inactive = state.members.filter(m => m.status === "Inactive").length;
    const monthTransactions = state.transactions.filter(t => t.transaction_date?.startsWith(currentMonth));
    const financeData = window.FinanceModule?.getData();
    const monthCollections = (financeData?.collections || []).filter(record => record.collection_date?.startsWith(currentMonth) && !["Pending", "Voided"].includes(record.status));
    const income = monthCollections.length
      ? monthCollections.reduce((sum, record) => sum + Number(record.amount || 0), 0)
      : monthTransactions.filter(t => t.type === "Income").reduce((sum, t) => sum + Number(t.amount), 0);
    const expenses = monthTransactions.filter(t => t.type === "Expense").reduce((sum, t) => sum + Number(t.amount), 0);
    const upcoming = state.events.filter(e => e.event_date >= today && e.event_date <= horizon);
    $("#dashboardMetrics").innerHTML = [
      metricCard("Total membership", state.members.length, state.members.length ? `${Math.round(active / state.members.length * 100)}% currently active` : "No members recorded", "users", "#0a3995"),
      metricCard("New this month", state.members.filter(m => m.joined_at?.startsWith(currentMonth)).length, `${visitors} visitor${visitors === 1 ? "" : "s"} awaiting follow-up`, "user-plus", "#d80011"),
      metricCard("Giving this month", money.format(income), `${monthCollections.length || monthTransactions.length} record${(monthCollections.length || monthTransactions.length) === 1 ? "" : "s"}`, "hand-coins", "#087a38"),
      metricCard("Upcoming events", upcoming.length, "Next 30 days", "calendar-days", "#b54708")
    ].join("");
    const attendance = state.attendance_records.slice().sort((a, b) => a.service_date.localeCompare(b.service_date) || String(a.created_at).localeCompare(String(b.created_at))).slice(-7);
    if (attendance.length) {
      const latest = attendance[attendance.length - 1];
      const totals = attendance.map(record => Number(record.grand_total ?? (Number(record.adults || 0) + Number(record.children || 0) + Number(record.visitors || 0))));
      const maxAttendance = Math.max(...totals, 1);
      $("#lastAttendance").textContent = totals[totals.length - 1];
      $("#attendanceNote").textContent = `${latest.service_name} · ${shortDate.format(new Date(`${latest.service_date}T00:00:00`))}`;
      $("#attendanceChart").className = "bar-chart";
      $("#attendanceChart").innerHTML = totals.map((total, index) => `<div class="bar ${index === totals.length - 1 ? "current" : ""}" style="height:${Math.max(8, Math.round(total / maxAttendance * 100))}%" data-value="${total}"></div>`).join("");
      $("#attendanceAxis").innerHTML = attendance.map(record => `<span>${shortDate.format(new Date(`${record.service_date}T00:00:00`))}</span>`).join("");
    } else {
      $("#lastAttendance").textContent = "—";
      $("#attendanceNote").textContent = "No attendance records yet";
      $("#attendanceChart").className = "bar-chart empty-chart";
      $("#attendanceChart").innerHTML = `<div><i data-lucide="clipboard-list"></i><p>Record a service to begin tracking participation.</p></div>`;
      $("#attendanceAxis").innerHTML = "";
    }
    const upcomingHtml = state.events.filter(e => e.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date)).slice(0, 3).map(event => {
      const date = new Date(`${event.event_date}T00:00:00`);
      return `<div class="event-row"><div class="date-box"><strong>${date.getDate()}</strong><span>${date.toLocaleString("en", { month: "short" })}</span></div><div><h4>${esc(event.title)}</h4><p>${esc(formatTime(event.start_time))} · ${esc(event.location)}</p></div><i data-lucide="chevron-right"></i></div>`;
    }).join("");
    $("#upcomingEvents").innerHTML = upcomingHtml || `<div class="empty-state compact"><i data-lucide="calendar"></i><p>No upcoming events.</p></div>`;
    const totalMembers = Math.max(state.members.length, 1);
    const activeEnd = Math.round(active / totalMembers * 100);
    const visitorEnd = Math.min(100, activeEnd + Math.round(visitors / totalMembers * 100));
    $("#membershipHealth").innerHTML = `<div class="membership-ring" style="--active-end:${activeEnd}%;--visitor-end:${visitorEnd}%"><div class="membership-ring-center"><strong>${state.members.length}</strong><span>Members</span></div></div><div class="membership-legend"><div><i style="--legend-color:#087a38"></i><span>Active</span><strong>${active}</strong></div><div><i style="--legend-color:#3974cf"></i><span>Visitors</span><strong>${visitors}</strong></div><div><i style="--legend-color:#d6dae1"></i><span>Inactive</span><strong>${inactive}</strong></div></div><div class="membership-note"><i data-lucide="heart-handshake"></i><span>${visitors + inactive ? `${visitors + inactive} ${visitors + inactive === 1 ? "person needs" : "people need"} follow-up` : "No pastoral follow-ups currently flagged"}</span></div>`;
    const activity = [
      ...state.members.map(item => ({ icon: "user-plus", color: "blue", text: "Member record", detail: fullName(item), date: item.created_at || item.joined_at })),
      ...state.transactions.map(item => ({ icon: "circle-dollar-sign", color: "green", text: `${item.type} recorded`, detail: `${item.description} · ${money.format(item.amount)}`, date: item.created_at || item.transaction_date })),
      ...state.events.map(item => ({ icon: "calendar-check", color: "red", text: "Programme scheduled", detail: item.title, date: item.created_at || item.event_date })),
      ...state.attendance_records.map(item => ({ icon: "clipboard-check", color: "blue", text: "Attendance recorded", detail: item.service_name, date: item.created_at || item.service_date }))
    ].filter(item => item.date).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    $("#activityList").innerHTML = activity.length ? activity.map(item => `<div class="activity-item"><span class="activity-icon ${item.color}"><i data-lucide="${item.icon}"></i></span><div><p>${esc(item.text)}</p><small>${esc(item.detail)}</small></div><small>${shortDate.format(new Date(item.date))}</small></div>`).join("") : `<div class="empty-state compact"><i data-lucide="activity"></i><p>No recent activity.</p></div>`;
    const cashflowTotal = Math.max(income + expenses, 1);
    const incomeShare = income + expenses ? Math.round(income / cashflowTotal * 100) : 0;
    const expenseShare = income + expenses ? 100 - incomeShare : 0;
    $("#cashflowSummary").innerHTML = `<div class="cashflow-stat income"><span><i style="--cash-color:#087a38"></i>Income</span><strong>${money.format(income)}</strong></div><div class="cashflow-stat expense"><span><i style="--cash-color:#e46f66"></i>Expenses</span><strong>${money.format(expenses)}</strong></div>`;
    $("#cashflowVisual").innerHTML = `<div class="cashflow-track" title="Income ${incomeShare}%"><i class="income" style="width:${incomeShare}%"></i><i class="expense" style="width:${expenseShare}%"></i></div><div class="cashflow-balance"><span>Net balance</span><strong>${money.format(income - expenses)}</strong></div>`;
    $("#givingTransactionCount").textContent = monthTransactions.length;
  }

  function renderMembers() {
    const query = $("#memberSearch")?.value.trim().toLowerCase() || "";
    const status = $("#memberStatusFilter")?.value || "all";
    const filtered = state.members.filter(member => {
      const classification = classificationPresentation(memberClassification(member));
      const haystack = `${fullName(member)} ${member.email} ${member.phone} ${member.group_name} ${classification.label} ${member.role}`.toLowerCase();
      return (!query || haystack.includes(query)) && (status === "all" || member.status === status);
    }).sort((a, b) => nameCollator.compare(fullName(a), fullName(b)));
    const statuses = [
      ["All members", state.members.length, "#0a3995"],
      ["Active", state.members.filter(m => m.status === "Active").length, "#087a38"],
      ["Visitors", state.members.filter(m => m.status === "Visitor").length, "#175cd3"],
      ["Inactive", state.members.filter(m => m.status === "Inactive").length, "#98a2b3"]
    ];
    $("#memberSummary").innerHTML = statuses.map(([label, count, color]) => `<div class="summary-item"><span class="summary-dot" style="--dot:${color}"></span><div><strong>${count}</strong><span>${label}</span></div></div>`).join("");
    const configuredGroups = window.GenerationalGroups?.getGroups().filter(group => group.status === "Active") || [];
    const groupCounts = new Map(configuredGroups.map(group => [group.id, 0]));
    let unclassified = 0;
    state.members.forEach(member => {
      const classification = memberClassification(member);
      if (classification.code === "matched") groupCounts.set(classification.group.id, (groupCounts.get(classification.group.id) || 0) + 1);
      else unclassified += 1;
    });
    const generationSummary = $("#memberGenerationalSummary");
    if (generationSummary) {
      const rulesReady = window.GenerationalGroups?.getStatus() === "ready";
      generationSummary.innerHTML = configuredGroups.length
        ? [
          ...configuredGroups.map(group => `<div class="generational-summary-item" title="${esc(window.GenerationalGroups.formatAgeRange(group))}, ${esc(group.gender)}"><strong>${groupCounts.get(group.id) || 0}</strong><span>${esc(group.name)}</span></div>`),
          ...(unclassified ? [`<div class="generational-summary-item"><strong>${unclassified}</strong><span>Not currently classified</span></div>`] : [])
        ].join("")
        : `<p class="generational-summary-empty">${rulesReady ? "No active generational group rules are configured." : "Generational group rules are currently unavailable."}</p>`;
    }
    $("#memberNavCount").textContent = state.members.length;
    $("#memberTableCount").textContent = `Showing ${filtered.length} of ${state.members.length} members`;
    $("#membersTable").innerHTML = filtered.length ? filtered.map(member => {
      const classification = classificationPresentation(memberClassification(member));
      return `<tr>
        <td><div class="member-cell"><span class="avatar">${initials(member)}</span><div><button class="member-name-button" type="button" data-view-member="${member.id}">${esc(fullName(member))}</button><small>${esc(member.gender)}</small></div></div></td>
        <td><span>${esc(member.phone || "—")}</span><small class="cell-subtext">${esc(member.email || "No email")}</small></td>
        <td><div class="classification-cell ${classification.warning ? "warning" : ""}"><strong>${esc(classification.label)}</strong><small>${esc(classification.note)}</small></div></td><td>${esc(member.role)}</td>
        <td><span class="status-pill ${member.status.toLowerCase()}">${esc(member.status)}</span></td>
        <td>${hasPermission("members.manage") ? `<div class="row-actions"><button class="icon-btn" data-edit-member="${member.id}" aria-label="Edit ${esc(fullName(member))}"><i data-lucide="pencil"></i></button><button class="icon-btn delete" data-delete-member="${member.id}" aria-label="Delete ${esc(fullName(member))}"><i data-lucide="trash-2"></i></button></div>` : ""}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty-state"><i data-lucide="search-x"></i><br>No members match your search.</div></td></tr>`;
  }

  function renderFinance() {
    window.FinanceModule?.syncReferenceData(state.members, state.events);
    window.FinanceModule?.render();
  }

  function renderEvents() {
    const type = $("#eventTypeFilter")?.value || "all";
    const colors = { Worship: "#0a3995", Meeting: "#b54708", Outreach: "#087a38", Fellowship: "#d80011" };
    const events = state.events.filter(e => type === "all" || e.type === type).sort((a, b) => a.event_date.localeCompare(b.event_date));
    $("#eventsSchedule").innerHTML = events.length ? events.map(event => {
      const date = new Date(`${event.event_date}T00:00:00`);
      return `<div class="schedule-item"><div class="schedule-date"><strong>${date.getDate()}</strong>${date.toLocaleString("en", { month: "short" })}</div><span class="event-accent" style="--event-color:${colors[event.type] || "#0a3995"}"></span><div><h4>${esc(event.title)}</h4><div class="schedule-meta"><span><i data-lucide="clock-3"></i>${esc(formatTime(event.start_time))}</span><span><i data-lucide="map-pin"></i>${esc(event.location)}</span></div></div><span class="status-pill ${event.type.toLowerCase() === "meeting" ? "meeting" : "neutral"}">${esc(event.type)}</span></div>`;
    }).join("") : `<div class="empty-state"><i data-lucide="calendar-x"></i><br>No events in this category.</div>`;
    renderCalendar();
  }

  function renderCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const previousLast = new Date(year, month, 0).getDate();
    const mondayOffset = (firstDay.getDay() + 6) % 7;
    $("#calendarTitle").textContent = now.toLocaleDateString("en-GH", { month: "long", year: "numeric" });
    const days = [];
    for (let i = mondayOffset; i > 0; i--) days.push(`<span class="muted">${previousLast - i + 1}</span>`);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hasEvent = state.events.some(e => e.event_date === isoDate);
      days.push(`<span class="${d === now.getDate() ? "today " : ""}${hasEvent ? "event-day" : ""}">${d}</span>`);
    }
    let nextDay = 1;
    while (days.length % 7) days.push(`<span class="muted">${nextDay++}</span>`);
    $("#calendarDays").innerHTML = days.join("");
  }

  function renderReports() {
    const active = state.members.filter(m => m.status === "Active").length;
    const currentMonth = monthKey();
    const income = state.transactions.filter(t => t.type === "Income" && t.transaction_date?.startsWith(currentMonth)).reduce((sum, t) => sum + Number(t.amount), 0);
    const joinedThisMonth = state.members.filter(m => m.joined_at?.startsWith(currentMonth)).length;
    $("#reportCards").innerHTML = [
      ["users", state.members.length, "Total members", `${joinedThisMonth} joined this month`, "#0a3995"],
      ["user-check", active, "Active members", `${Math.round(active / Math.max(state.members.length, 1) * 100)}% of membership`, "#087a38"],
      ["hand-coins", money.format(income), "Giving this month", `${state.transactions.filter(t => t.transaction_date?.startsWith(currentMonth)).length} transactions`, "#b54708"]
    ].map(([icon, value, label, note, color]) => `<article class="card report-card"><div class="metric-icon" style="--accent:${color}"><i data-lucide="${icon}"></i></div><strong>${esc(value)}</strong><p>${esc(label)}</p><span class="report-note">${esc(note)}</span></article>`).join("");
    const monthSeries = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      return { label: date.toLocaleDateString("en-GH", { month: "short" }), count: state.members.filter(member => member.joined_at?.startsWith(key)).length };
    });
    const maxGrowth = Math.max(...monthSeries.map(item => item.count), 1);
    $("#growthChart").innerHTML = monthSeries.some(item => item.count) ? monthSeries.map(item => `<span class="line-bar" style="height:${Math.max(8, Math.round(item.count / maxGrowth * 100))}%" title="${item.count} members"></span>`).join("") : `<div class="empty-state compact"><i data-lucide="chart-no-axes-column"></i><p>No membership growth data yet.</p></div>`;
    $("#growthAxis").innerHTML = monthSeries.map(item => `<span>${item.label}</span>`).join("");
    const female = state.members.filter(m => m.gender === "Female").length;
    const male = state.members.filter(m => m.gender === "Male").length;
    const generationColors = ["#6b4eff", "#175cd3", "#087a38", "#b54708", "#c11574", "#475467"];
    const configuredGroups = window.GenerationalGroups?.getGroups().filter(group => group.status === "Active") || [];
    const groupProfiles = configuredGroups.map((group, index) => [
      group.name,
      state.members.filter(member => memberClassification(member).group?.id === group.id).length,
      generationColors[index % generationColors.length]
    ]);
    const profiles = [["Female", female, "#d80011"], ["Male", male, "#0a3995"], ["Active", active, "#087a38"], ...groupProfiles];
    $("#demographics").innerHTML = profiles.map(([label, n, color]) => { const pct = Math.round(n / Math.max(state.members.length, 1) * 100); return `<div class="demo-row"><div><span>${label}</span><strong>${n} · ${pct}%</strong></div><div class="demo-track"><i style="width:${pct}%;--bar-color:${color}"></i></div></div>`; }).join("");
  }

  function renderNotifications() {
    const items = [
      ...state.members.map(item => ({ icon: "user-plus", color: "blue", title: "Member record added", text: fullName(item), date: item.created_at || item.joined_at })),
      ...state.transactions.map(item => ({ icon: "badge-check", color: "green", title: "Transaction recorded", text: `${item.description} · ${money.format(item.amount)}`, date: item.created_at || item.transaction_date })),
      ...state.attendance_records.map(item => ({ icon: "clipboard-check", color: "blue", title: "Attendance recorded", text: item.service_name, date: item.created_at || item.service_date }))
    ].filter(item => item.date).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3);
    $("#notificationsList").innerHTML = items.length ? items.map(item => `<div class="notification-item"><span class="notification-icon ${item.color}"><i data-lucide="${item.icon}"></i></span><div><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p><small>${dateFormat.format(new Date(item.date))}</small></div></div>`).join("") : `<div class="empty-state compact"><i data-lucide="bell-off"></i><p>No notifications.</p></div>`;
    $(".notification-dot")?.classList.toggle("hidden-dot", !items.length);
  }

  function renderAll() {
    renderDashboard();
    renderMembers();
    renderFinance();
    renderEvents();
    renderReports();
    renderNotifications();
    refreshIcons();
  }

  function formatTime(time) {
    if (!time) return "Time TBA";
    const [hour, minute] = time.split(":").map(Number);
    return new Date(2026, 0, 1, hour, minute).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  }

  function memberFields(member = {}) {
    return `<label>First name<input name="first_name" required value="${esc(member.first_name)}" placeholder="e.g. Ama" /></label>
      <label>Last name<input name="last_name" required value="${esc(member.last_name)}" placeholder="e.g. Mensah" /></label>
      <label>Date of birth<input name="date_of_birth" required type="date" max="${todayIso()}" value="${esc(member.date_of_birth)}" /><small class="field-note">Age is calculated automatically and is not stored.</small></label>
      <label>Gender<select name="gender" required>${options(["Female", "Male"], member.gender)}</select></label>
      <label>Phone (optional)<input name="phone" type="tel" value="${esc(member.phone)}" placeholder="024 000 0000" /></label>
      <label class="full">Email address<input name="email" type="email" value="${esc(member.email)}" placeholder="member@example.com" /></label>
      <label class="full">Actual fellowship / department (optional)<input name="group_name" value="${esc(member.group_name)}" placeholder="e.g. Choir or welfare team" /><small class="field-note">This records actual participation and is separate from the automatic age-based group.</small></label>
      <label>Role<select name="role">${options(["Member", "Leader", "Elder", "Deacon", "Teacher"], member.role || "Member")}</select></label>
      <label>Status<select name="status">${options(["Active", "Visitor", "Inactive"], member.status || "Active")}</select></label>
      <label>Date joined<input name="joined_at" type="date" value="${esc(member.joined_at || todayIso())}" /></label>`;
  }

  function memberGivingMarkup(memberId, from = "", to = "") {
    if (!hasPermission("finance.view")) return "";
    const allRecords = window.FinanceModule?.getMemberGiving(memberId) || [];
    const records = allRecords.filter(item => !from || item.collection_date >= from).filter(item => !to || item.collection_date <= to);
    const accounted = records.filter(item => !["Pending", "Voided"].includes(item.status));
    const totalFor = type => accounted.filter(item => item.collection_type === type).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const total = accounted.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const monthly = accounted.filter(item => item.collection_date?.startsWith(monthKey())).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const givingMoney = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", minimumFractionDigits: 2 });
    return `<section class="member-giving-section"><div class="member-giving-heading"><div><p class="eyebrow">PRIVATE FINANCIAL RECORD</p><h4>Giving / Financial History</h4><p>Visible only to users with finance access.</p></div>${hasPermission("finance.manage") ? `<div class="member-giving-actions"><button class="secondary-btn" type="button" data-record-member-giving="${memberId}" data-giving-type="Tithe"><i data-lucide="plus"></i> Tithe</button><button class="secondary-btn" type="button" data-record-member-giving="${memberId}" data-giving-type="Vote of Thanks (VTO)"><i data-lucide="plus"></i> VTO</button></div>` : ""}</div><div class="member-giving-summary"><div><span>Total Tithes</span><strong>${givingMoney.format(totalFor("Tithe"))}</strong></div><div><span>Total VTO</span><strong>${givingMoney.format(totalFor("Vote of Thanks (VTO)"))}</strong></div><div><span>Total Giving</span><strong>${givingMoney.format(total)}</strong></div><div><span>Transactions</span><strong>${accounted.length}</strong></div><div><span>This Month</span><strong>${givingMoney.format(monthly)}</strong></div></div><div class="member-giving-filters"><label>From<input type="date" data-member-giving-from value="${esc(from)}"></label><label>To<input type="date" data-member-giving-to value="${esc(to)}"></label></div><div class="table-scroll"><table class="member-giving-table"><thead><tr><th>Date</th><th>Occasion / Service</th><th>Type</th><th>Status</th><th>Amount</th></tr></thead><tbody>${records.length ? records.map(item => { const event = Array.isArray(item.events) ? item.events[0] : item.events; return `<tr><td>${esc(formatMemberDate(item.collection_date))}</td><td>${esc(item.service_name || event?.title || "Unspecified service")}</td><td>${esc(item.collection_type)}</td><td><span class="finance-status ${esc(item.status.toLowerCase())}">${esc(item.status)}</span></td><td>${givingMoney.format(Number(item.amount || 0))}</td></tr>`; }).join("") : `<tr><td colspan="5"><div class="member-giving-empty">No giving transactions match this date range.</div></td></tr>`}</tbody></table></div></section>`;
  }

  function renderMemberGivingSection() {
    const node = $(".member-giving-section"); if (!node || !state.viewingMemberId) return;
    const from = $("[data-member-giving-from]", node)?.value || ""; const to = $("[data-member-giving-to]", node)?.value || "";
    node.outerHTML = memberGivingMarkup(state.viewingMemberId, from, to);
    refreshIcons();
  }

  function openMemberProfile(member) {
    if (!member) return;
    state.viewingMemberId = member.id;
    const classification = memberClassification(member);
    const presentation = classificationPresentation(classification);
    $("#memberProfileAvatar").textContent = initials(member) || "MB";
    $("#memberProfileName").textContent = fullName(member) || "Unnamed member";
    $("#memberProfileMeta").textContent = `${member.role || "Member"} · ${member.status || "Unknown status"}`;
    $("#memberProfileBody").innerHTML = `<div class="member-profile-grid">
      <div class="member-profile-field"><span>Date of birth</span><strong>${esc(formatMemberDate(member.date_of_birth))}</strong></div>
      <div class="member-profile-field"><span>Current age</span><strong>${classification.age === null ? "Not available" : `${classification.age} years`}</strong></div>
      <div class="member-profile-field"><span>Gender</span><strong>${esc(member.gender || "Not specified")}</strong></div>
      <div class="member-profile-field"><span>Date joined</span><strong>${esc(formatMemberDate(member.joined_at))}</strong></div>
      <div class="member-profile-field classification"><span>Age-based group</span><strong>${esc(presentation.label)}</strong><small><i data-lucide="sparkles"></i>Automatically determined from date of birth and the church's active rules</small></div>
      <div class="member-profile-field"><span>Actual fellowship / department</span><strong>${esc(member.group_name || "None recorded")}</strong></div>
      <div class="member-profile-field"><span>Contact</span><strong>${esc(member.phone || member.email || "None recorded")}</strong></div>
    </div>${memberGivingMarkup(member.id)}`;
    $("#editMemberFromProfile").hidden = !hasPermission("members.manage");
    $("#memberProfileDialog").showModal();
    refreshIcons();
  }

  function transactionFields() {
    return `<label class="full">Description<input name="description" required placeholder="e.g. Sunday service offering" /></label><label>Type<select name="type">${options(["Income", "Expense"], "Income")}</select></label><label>Amount (GH₵)<input name="amount" required type="number" min="0" step="0.01" placeholder="0.00" /></label><label>Fund<select name="fund">${options(["General Fund", "Tithe", "Building Fund", "Mission", "Welfare", "Operations"], "General Fund")}</select></label><label>Date<input name="transaction_date" required type="date" value="${todayIso()}" /></label>`;
  }

  function eventFields() {
    return `<label class="full">Event title<input name="title" required placeholder="e.g. Prayer meeting" /></label><label>Date<input name="event_date" required type="date" value="${todayIso()}" /></label><label>Start time<input name="start_time" required type="time" /></label><label>Event type<select name="type">${options(["Worship", "Meeting", "Outreach", "Fellowship"], "Worship")}</select></label><label>Location<input name="location" required placeholder="Main Sanctuary" /></label><label class="full">Description<textarea name="description" placeholder="Add programme details..."></textarea></label>`;
  }

  function profileFields() {
    const profile = getAdminProfile();
    return `<label class="full">Display name<input name="display_name" required value="${esc(profile.name)}" placeholder="e.g. Ama Mensah" /></label><label>Access role<input value="${esc(profile.role)}" disabled /></label><label>Phone number<input name="phone" type="tel" value="${esc(profile.phone)}" placeholder="024 000 0000" /></label><label class="full">Account email<input value="${esc(profile.email || "Sign in to view account email")}" disabled /></label>`;
  }

  function options(values, selected) {
    return values.map(value => `<option ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("");
  }

  function openDialog(type, record = null) {
    state.dialogType = type;
    state.editingId = record?.id || null;
    const config = {
      member: [record ? "EDIT RECORD" : "NEW MEMBER", record ? "Edit member details" : "Add new member", memberFields(record || {})],
      transaction: ["NEW TRANSACTION", "Record a transaction", transactionFields()],
      event: ["NEW PROGRAMME", "Create an event", eventFields()],
      profile: ["ADMINISTRATOR ACCOUNT", "Edit your profile", profileFields()]
    }[type];
    $("#dialogEyebrow").textContent = config[0];
    $("#dialogTitle").textContent = config[1];
    $("#dialogFields").innerHTML = config[2];
    $("#dialogSubmit").textContent = record ? "Save changes" : "Save record";
    $("#entryDialog").showModal();
    refreshIcons();
    setTimeout(() => $("#dialogFields input")?.focus(), 50);
  }

  async function saveRecord(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (state.dialogType === "member") {
        const ageResult = window.GenerationalGroups.calculateAge(values.date_of_birth);
        if (ageResult.code === "missing-date") throw new Error("Date of birth is required.");
        if (ageResult.code === "invalid-date") throw new Error("Enter a valid date of birth.");
        if (ageResult.code === "future-date") throw new Error("Date of birth cannot be in the future.");
        if (state.editingId) {
          const record = { ...values, id: state.editingId };
          await persistUpdate("members", record);
          const i = state.members.findIndex(item => item.id === state.editingId);
          state.members[i] = { ...state.members[i], ...record };
          toast("Member details updated.");
        } else {
          const record = { ...values, id: uid(), created_at: new Date().toISOString() };
          const saved = await persistInsert("members", record);
          state.members.unshift(saved);
          toast(`${fullName(record)} was added.`);
        }
      } else if (state.dialogType === "transaction") {
        const record = { ...values, amount: Number(values.amount), id: uid(), created_at: new Date().toISOString() };
        const saved = await persistInsert("transactions", record);
        state.transactions.unshift(saved);
        toast("Transaction recorded.");
      } else if (state.dialogType === "event") {
        const record = { ...values, id: uid(), created_at: new Date().toISOString() };
        const saved = await persistInsert("events", record);
        state.events.push(saved);
        toast("Event added to the programme.");
      } else if (state.dialogType === "profile") {
        const profile = { display_name: values.display_name, phone: values.phone };
        if (state.dataMode === "supabase" && state.client) {
          const { error: profileError } = await state.client.rpc("update_own_profile", { new_display_name: profile.display_name, new_phone: profile.phone });
          if (profileError) throw profileError;
          const { data, error } = await state.client.auth.updateUser({ data: profile });
          if (error) throw error;
          state.user = data.user;
          state.userProfile = { ...state.userProfile, ...profile };
        }
        localStorage.setItem("pcg_admin_profile", JSON.stringify(profile));
        updateProfileUI();
        toast("Profile details updated.");
      }
      const tableByDialog = { member: "members", transaction: "transactions", event: "events" };
      if (state.dataMode !== "supabase" && tableByDialog[state.dialogType]) storeDemoData(tableByDialog[state.dialogType]);
      $("#entryDialog").close();
      renderAll();
    } catch (error) {
      toast(error.message || "Unable to save the record.", "error");
    }
  }

  async function persistInsert(table, record) {
    if (state.dataMode !== "supabase" || !state.client) return record;
    const payload = { ...record };
    if (String(payload.id).includes("-")) delete payload.id;
    const { data, error } = await state.client.from(table).insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function persistUpdate(table, record) {
    if (state.dataMode !== "supabase" || !state.client) return;
    const { id, ...payload } = record;
    const { error } = await state.client.from(table).update(payload).eq("id", id);
    if (error) throw error;
  }

  async function removeRecord(table, id) {
    const labels = { members: "member", transactions: "transaction", events: "event" };
    if (!confirm(`Remove this ${labels[table]}? This cannot be undone.`)) return;
    try {
      if (state.dataMode === "supabase" && state.client) {
        const { error } = await state.client.from(table).delete().eq("id", id);
        if (error) throw error;
      }
      state[table] = state[table].filter(item => item.id !== id);
      if (state.dataMode !== "supabase") storeDemoData(table);
      renderAll();
      toast(`${labels[table][0].toUpperCase() + labels[table].slice(1)} removed.`);
    } catch (error) {
      toast(error.message || "Unable to remove this record.", "error");
    }
  }

  function exportCsv(filename, rows) {
    if (!rows.length) return toast("There is no data to export.", "error");
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(","), ...rows.map(row => keys.map(key => `"${String(row[key] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    toast("CSV export prepared.");
  }

  function redirectToSignin(reason = "") {
    const url = new URL("signin.html", window.location.href);
    if (reason) url.searchParams.set("reason", reason);
    location.replace(url.href);
  }

  async function initializeSupabase(showFeedback = false) {
    const saved = JSON.parse(localStorage.getItem("pcg_supabase") || "null");
    const config = saved || window.PCG_SUPABASE || {};
    if (!config.url || !(config.anonKey || config.key) || !window.supabase) {
      state.dataMode = "configured";
      updateConnectionUI();
      if (showFeedback) toast("Add a project URL and anon key first.", "error");
      else redirectToSignin();
      return false;
    }
    try {
      const client = window.supabase.createClient(config.url, config.anonKey || config.key);
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      state.client = client;
      state.user = sessionData.session?.user || null;
      if (!state.user) {
        state.dataMode = "configured";
        updateConnectionUI();
        if (showFeedback) toast("Connection saved. Sign in to continue.");
        else redirectToSignin();
        return true;
      }

      const { data: userProfile, error: profileError } = await client
        .from("user_profiles")
        .select("id,email,display_name,phone,status,role_id,app_roles(id,name,permissions)")
        .eq("id", state.user.id)
        .single();
      if (profileError) throw profileError;
      if (userProfile.status !== "active") {
        await client.auth.signOut();
        redirectToSignin("inactive");
        return false;
      }
      const assignedRole = Array.isArray(userProfile.app_roles) ? userProfile.app_roles[0] : userProfile.app_roles;
      state.userProfile = userProfile;
      state.permissions = assignedRole?.permissions || [];

      const liveTables = [
        ["members", "created_at", "members.view"],
        ["transactions", "transaction_date", "finance.view"],
        ["events", "event_date", "events.view"],
        ["attendance_records", "service_date", "attendance.view"]
      ].filter(([, , permission]) => hasPermission(permission));
      const results = await Promise.all(liveTables.map(([table, orderBy]) => client.from(table).select("*").order(orderBy, { ascending: false })));
      const failed = results.find(result => result.error);
      if (failed) throw failed.error;
      state.members = [];
      state.transactions = [];
      state.events = [];
      state.attendance_records = [];
      liveTables.forEach(([table], index) => { state[table] = results[index].data || []; });
      state.dataMode = "supabase";
      applyPermissions();
      updateConnectionUI();
      if (!state.generationalGroupsInitialized && window.GenerationalGroups) {
        await window.GenerationalGroups.initialize({
          client,
          permissions: state.permissions,
          onChange: () => renderAll()
        });
        state.generationalGroupsInitialized = true;
      }
      if (!state.attendanceInitialized && window.AttendanceModule) {
        await window.AttendanceModule.initialize({
          client,
          userId: state.user.id,
          permissions: state.permissions,
          records: state.attendance_records,
          onChange: records => {
            state.attendance_records = records;
            renderDashboard();
            refreshIcons();
          }
        });
        state.attendanceInitialized = true;
      }
      if (!state.financeInitialized && window.FinanceModule) {
        await window.FinanceModule.initialize({
          client,
          userId: state.user.id,
          permissions: state.permissions,
          members: state.members,
          events: state.events,
          legacyTransactions: state.transactions
        });
        state.financeInitialized = true;
      }
      renderAll();
      if (!state.userManagementInitialized && window.UserManagement) {
        window.UserManagement.initialize({ client, userId: state.user.id, permissions: state.permissions });
        state.userManagementInitialized = true;
      }
      if (showFeedback) toast("Connected to Supabase successfully.");
      return true;
    } catch (error) {
      state.dataMode = "configured";
      updateConnectionUI();
      if (showFeedback) toast(`Connection failed: ${error.message}`, "error");
      else {
        console.error("Authentication initialization failed", error);
        await state.client?.auth.signOut();
        redirectToSignin("session");
      }
      return false;
    }
  }

  function updateConnectionUI() {
    const connected = state.dataMode === "supabase";
    const configured = state.dataMode === "configured";
    const profile = getAdminProfile();
    $("#connectionBadge").className = `status-pill ${connected ? "active" : configured ? "visitor" : "neutral"}`;
    $("#connectionBadge").textContent = connected ? "Connected" : configured ? "Sign in required" : "Not connected";
    $(".connection-overview").classList.toggle("connected", connected);
    $("#connectionTitle").textContent = connected ? "Church records are synchronized" : configured ? "Database connection is ready" : "Data connection needs attention";
    $("#connectionMessage").textContent = connected ? "Changes are being saved securely to the live database." : configured ? "Sign in below to access live church records." : "Open Developer connection settings to configure the database.";
    $("#authHint").textContent = connected ? "Signed in securely" : configured ? "Enter your account credentials" : "Connection setup required";
    $("#authCredentials").hidden = connected;
    $("#signedInAccount").hidden = !connected;
    $("#signedInName").textContent = profile.name;
    $("#signedInEmail").textContent = profile.email || "Administrator";
    $("#settingsAvatar").textContent = profile.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "CA";
    $("#signInBtn").hidden = connected;
    $("#signOutBtn").hidden = !connected;
    updateProfileUI();
  }

  async function signIn(event) {
    event.preventDefault();
    if (!state.client) return toast("Save your Supabase project details first.", "error");
    const { email, password } = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!email || !password) return toast("Enter the administrator email and password.", "error");
    const { error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) return toast(error.message, "error");
    event.currentTarget.reset();
    await initializeSupabase(false);
    toast("Signed in. Live church records are loaded.");
  }

  async function signOut() {
    if (state.client) await state.client.auth.signOut();
    state.user = null;
    state.client = null;
    state.dataMode = "configured";
    redirectToSignin();
  }

  function bindEvents() {
    document.addEventListener("click", event => {
      const pageTarget = event.target.closest("[data-page]");
      if (pageTarget) navigate(pageTarget.dataset.page);
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "add-member") openDialog("member");
      if (action === "add-transaction") {
        navigate("finance");
        window.FinanceModule?.openCollection();
      }
      if (action === "add-event") openDialog("event");
      if (action === "add-attendance") {
        navigate("attendance");
        window.AttendanceModule?.openTakeAttendance();
      }
      if (action === "add-attendance-summary") {
        navigate("attendance");
        window.AttendanceModule?.openTakeAttendance();
      }
      const viewId = event.target.closest("[data-view-member]")?.dataset.viewMember;
      if (viewId) openMemberProfile(state.members.find(member => member.id === viewId));
      const editId = event.target.closest("[data-edit-member]")?.dataset.editMember;
      if (editId) openDialog("member", state.members.find(member => member.id === editId));
      const memberId = event.target.closest("[data-delete-member]")?.dataset.deleteMember;
      if (memberId) removeRecord("members", memberId);
      const transactionId = event.target.closest("[data-delete-transaction]")?.dataset.deleteTransaction;
      if (transactionId) removeRecord("transactions", transactionId);
      const givingButton = event.target.closest("[data-record-member-giving]");
      if (givingButton) {
        const givingMemberId = givingButton.dataset.recordMemberGiving; const givingType = givingButton.dataset.givingType || "Tithe";
        $("#memberProfileDialog").close(); navigate("finance"); window.FinanceModule?.openMemberGiving(givingMemberId, givingType);
      }
    });
    document.addEventListener("input", event => { if (event.target.matches("[data-member-giving-from],[data-member-giving-to]")) renderMemberGivingSection(); });
    $("#memberSearch").addEventListener("input", () => { renderMembers(); refreshIcons(); });
    $("#memberStatusFilter").addEventListener("change", () => { renderMembers(); refreshIcons(); });
    $("#eventTypeFilter").addEventListener("change", () => { renderEvents(); refreshIcons(); });
    $("#entryForm").addEventListener("submit", saveRecord);
    $$('[data-close-dialog]').forEach(btn => btn.addEventListener("click", () => $("#entryDialog").close()));
    $$('[data-close-member-profile]').forEach(btn => btn.addEventListener("click", () => $("#memberProfileDialog").close()));
    $("#editMemberFromProfile").addEventListener("click", () => {
      const member = state.members.find(item => item.id === state.viewingMemberId);
      $("#memberProfileDialog").close();
      if (member) openDialog("member", member);
    });
    $("#quickAddBtn").addEventListener("click", () => {
      if (state.page === "attendance") return window.AttendanceModule?.openTakeAttendance();
      if (state.page === "finance") return window.FinanceModule?.openCollection();
      openDialog(state.page === "finance" ? "transaction" : state.page === "events" ? "event" : "member");
    });
    $("#exportMembers").addEventListener("click", () => exportCsv("resurrection-members.csv", state.members.map(member => {
      const classification = memberClassification(member);
      return {
        ...member,
        current_age: classification.age ?? "",
        age_based_group: classification.group?.name || classificationPresentation(classification).label,
        actual_fellowship_or_department: member.group_name || ""
      };
    })));
    $("#exportFinance")?.addEventListener("click", () => exportCsv("resurrection-transactions.csv", state.transactions));
    $("#printReport").addEventListener("click", () => window.print());
    $("#supportBtn").addEventListener("click", () => toast("Support: contact your church system administrator."));
    $("#notificationBtn").addEventListener("click", event => { event.stopPropagation(); window.ProfileController?.close(); $("#notificationPanel").hidden = !$("#notificationPanel").hidden; });
    $("#notificationPanel").addEventListener("click", event => event.stopPropagation());
    document.addEventListener("click", () => { $("#notificationPanel").hidden = true; });
    $("#markRead").addEventListener("click", () => { $(".notification-dot")?.remove(); $("#notificationPanel").hidden = true; toast("Notifications marked as read."); });
    $("#globalSearch").addEventListener("keydown", event => { if (event.key === "Enter" && event.currentTarget.value.trim()) { navigate("members"); $("#memberSearch").value = event.currentTarget.value; renderMembers(); refreshIcons(); } });
    document.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#globalSearch").focus(); } });
    window.addEventListener("popstate", () => navigate(location.hash.slice(1) || "dashboard", false));
    window.addEventListener("pcg:profile-edit", () => openDialog("profile"));
    window.addEventListener("pcg:profile-settings", () => navigate("settings"));
    window.addEventListener("pcg:profile-signout", signOut);
    $("#churchSettingsForm").addEventListener("submit", event => { event.preventDefault(); localStorage.setItem("pcg_church", JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))); toast("Congregation details saved."); });
    $("#testConnection").addEventListener("click", async () => { const values = Object.fromEntries(new FormData($("#supabaseForm")).entries()); localStorage.setItem("pcg_supabase", JSON.stringify({ url: values.url, anonKey: values.key })); await initializeSupabase(true); });
    $("#supabaseForm").addEventListener("submit", async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); localStorage.setItem("pcg_supabase", JSON.stringify({ url: values.url, anonKey: values.key })); await initializeSupabase(true); });
    $("#authForm").addEventListener("submit", signIn);
    $("#signOutBtn").addEventListener("click", signOut);
  }

  async function init() {
    removeLegacyDemoData();
    const now = new Date();
    $("#todayLabel").textContent = now.toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
    const savedConfig = JSON.parse(localStorage.getItem("pcg_supabase") || "null");
    if (savedConfig) { $("#supabaseForm [name=url]").value = savedConfig.url || ""; $("#supabaseForm [name=key]").value = savedConfig.anonKey || ""; }
    const church = JSON.parse(localStorage.getItem("pcg_church") || "null");
    if (church) Object.entries(church).forEach(([key, value]) => { const field = $(`#churchSettingsForm [name=${key}]`); if (field) field.value = value; });
    bindEvents();
    refreshIcons();
    const connected = await initializeSupabase(false);
    if (!connected || !state.user) return;
    const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
    const firstName = getAdminProfile().name.split(/\s+/)[0];
    $("#page-dashboard h2").textContent = `${greeting}, ${firstName}.`;
    window.setInterval(() => {
      const currentDate = todayIso();
      if (currentDate === lastClassificationDate) return;
      lastClassificationDate = currentDate;
      renderAll();
    }, 60000);
    const requestedPage = location.hash.slice(1) || "dashboard";
    navigate($("#page-" + requestedPage) ? requestedPage : "dashboard", false);
    $("#appLoading").classList.add("ready");
  }

  window.PCGApp = { toast, hasPermission };
  document.addEventListener("DOMContentLoaded", init);
})();
