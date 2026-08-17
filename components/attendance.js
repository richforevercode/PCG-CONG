(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const state = {
    client: null,
    userId: null,
    permissions: [],
    members: [],
    events: [],
    records: [],
    draft: new Map(),
    page: 1,
    loading: false,
    initialized: false,
    eventsBound: false,
    onChange: null
  };

  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  const fullName = member => `${member?.first_name || ""} ${member?.last_name || ""}`.trim() || "Unknown member";
  const initials = member => `${member?.first_name?.[0] || ""}${member?.last_name?.[0] || ""}`.toUpperCase() || "MB";
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const dateFormatter = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const shortDateFormatter = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short" });
  const timeFormatter = new Intl.DateTimeFormat("en-GH", { hour: "numeric", minute: "2-digit" });

  function dateFromIso(value) {
    return new Date(`${value}T00:00:00`);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = dateFromIso(value);
    return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
  }

  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
  }

  function relation(record, key) {
    const value = record?.[key];
    return Array.isArray(value) ? value[0] : value;
  }

  function memberForRecord(record) {
    return relation(record, "members") || state.members.find(member => member.id === record.member_id) || null;
  }

  function eventForRecord(record) {
    return relation(record, "events") || state.events.find(event => event.id === record.event_id) || null;
  }

  function metricCard(label, value, note, icon, accent) {
    return `<article class="metric-card" style="--accent:${accent}"><div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div><div class="metric-icon"><i data-lucide="${icon}"></i></div></article>`;
  }

  function activeRoster() {
    return state.members
      .filter(member => member.status !== "Inactive")
      .slice()
      .sort((left, right) => fullName(left).localeCompare(fullName(right), "en-GH", { sensitivity: "base" }));
  }

  function eventLabel(event) {
    return `${event.title} · ${formatDate(event.event_date)}`;
  }

  function populateEventOptions() {
    const events = state.events.slice().sort((left, right) =>
      String(right.event_date).localeCompare(String(left.event_date))
      || String(left.title).localeCompare(String(right.title))
    );

    const takeSelect = $("#takeAttendanceEvent");
    if (takeSelect) {
      const selected = takeSelect.value;
      takeSelect.innerHTML = `<option value="">Select a service or event</option>${events.map(event => `<option value="${event.id}">${esc(eventLabel(event))}</option>`).join("")}`;
      if (events.some(event => event.id === selected)) takeSelect.value = selected;
    }

    const filter = $("#attendanceEventFilter");
    if (filter) {
      const selected = filter.value || "all";
      const recordEvents = state.records.map(record => ({ id: record.event_id, ...(eventForRecord(record) || {}) }));
      const unique = new Map();
      [...events, ...recordEvents].forEach(event => {
        if (event.id) unique.set(event.id, event);
      });
      filter.innerHTML = `<option value="all">All services/events</option>${Array.from(unique.values()).map(event => `<option value="${event.id}">${esc(event.title || "Deleted event")}</option>`).join("")}`;
      filter.value = unique.has(selected) ? selected : "all";
    }
  }

  function summarizeRecords(records, events = state.events) {
    const groups = new Map();
    records.forEach(record => {
      const key = `${record.attendance_date}|${record.event_id}`;
      const relatedEvent = relation(record, "events") || events.find(event => event.id === record.event_id);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          date: record.attendance_date,
          eventId: record.event_id,
          title: relatedEvent?.title || "Service or event",
          present: 0,
          menPresent: 0,
          womenPresent: 0,
          genderUnspecifiedPresent: 0,
          absent: 0,
          excused: 0,
          total: 0
        });
      }
      const group = groups.get(key);
      group.total += 1;
      if (record.status === "Present") {
        group.present += 1;
        const member = memberForRecord(record);
        if (member?.gender === "Male") group.menPresent += 1;
        else if (member?.gender === "Female") group.womenPresent += 1;
        else group.genderUnspecifiedPresent += 1;
      }
      if (record.status === "Absent") group.absent += 1;
      if (record.status === "Excused") group.excused += 1;
    });
    return Array.from(groups.values()).sort((left, right) =>
      String(right.date).localeCompare(String(left.date))
      || left.title.localeCompare(right.title)
    );
  }

  function sessionGroups() {
    return summarizeRecords(state.records);
  }

  function attendanceRate(group) {
    return group.total ? Math.round(group.present / group.total * 100) : 0;
  }

  function renderMetrics() {
    const container = $("#attendanceMetrics");
    if (!container) return;
    const todayRecords = state.records.filter(record => record.attendance_date === todayIso());
    const present = todayRecords.filter(record => record.status === "Present").length;
    const menPresent = todayRecords.filter(record => record.status === "Present" && memberForRecord(record)?.gender === "Male").length;
    const womenPresent = todayRecords.filter(record => record.status === "Present" && memberForRecord(record)?.gender === "Female").length;
    const absent = todayRecords.filter(record => record.status === "Absent").length;
    const excused = todayRecords.filter(record => record.status === "Excused").length;
    const rate = todayRecords.length ? Math.round(present / todayRecords.length * 100) : 0;
    container.innerHTML = [
      metricCard("Today's attendance", todayRecords.length, `${excused} excused`, "calendar-check", "#0a3995"),
      metricCard("Present", present, "Marked present today", "user-check", "#087a38"),
      metricCard("Men present", menPresent, "Men who attended today", "person-standing", "#0a3995"),
      metricCard("Women present", womenPresent, "Women who attended today", "person-standing", "#b54708"),
      metricCard("Absent", absent, "Marked absent today", "user-x", "#d80011"),
      metricCard("Attendance rate", `${rate}%`, todayRecords.length ? `${present} of ${todayRecords.length} attended` : "No attendance taken today", "percent", "#b54708")
    ].join("");
  }

  function renderTrend() {
    const container = $("#attendanceTrendChart");
    const changeBadge = $("#attendanceTrendChange");
    if (!container || !changeBadge) return;
    const sessions = sessionGroups().slice(0, 8).reverse();

    if (!sessions.length) {
      container.innerHTML = `<div class="empty-state compact"><i data-lucide="chart-no-axes-combined"></i><p>No member attendance has been recorded yet.</p></div>`;
      changeBadge.className = "attendance-trend-change neutral";
      changeBadge.innerHTML = `<i data-lucide="minus"></i> No comparison`;
      return;
    }

    const width = 760;
    const height = 250;
    const left = 42;
    const right = 22;
    const top = 25;
    const bottom = 48;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const highestAttendance = Math.max(...sessions.map(session => session.present), 1);
    const maximum = Math.max(4, Math.ceil(highestAttendance / 4) * 4);
    const points = sessions.map((session, index) => ({
      ...session,
      x: sessions.length === 1 ? left + plotWidth / 2 : left + index / (sessions.length - 1) * plotWidth,
      y: top + (maximum - session.present) / maximum * plotHeight
    }));
    const ticks = Array.from({ length: 5 }, (_, index) => Math.round(maximum * (4 - index) / 4));
    const grid = ticks.map((tick, index) => {
      const y = top + index / 4 * plotHeight;
      return `<line class="attendance-chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="attendance-chart-axis-label" x="${left - 9}" y="${y + 3}" text-anchor="end">${tick}</text>`;
    }).join("");
    const segments = points.slice(1).map((point, index) => {
      const previous = points[index];
      const direction = point.present > previous.present ? "increase" : point.present < previous.present ? "decrease" : "unchanged";
      return `<line class="attendance-trend-segment ${direction}" x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}"/>`;
    }).join("");
    const dots = points.map(point => `<g><circle class="attendance-chart-dot" cx="${point.x}" cy="${point.y}" r="5"><title>${esc(point.title)}: ${point.present} present</title></circle><text class="attendance-chart-value" x="${point.x}" y="${point.y - 11}" text-anchor="middle">${point.present}</text><text class="attendance-chart-date" x="${point.x}" y="${height - 20}" text-anchor="middle">${esc(shortDateFormatter.format(dateFromIso(point.date)))}</text></g>`).join("");
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Present attendance across the latest ${sessions.length} services. Green segments indicate an increase and red segments indicate a decrease.">${grid}${segments}${dots}</svg>`;

    if (sessions.length < 2) {
      changeBadge.className = "attendance-trend-change neutral";
      changeBadge.innerHTML = `<i data-lucide="minus"></i> First service recorded`;
      return;
    }

    const latest = sessions[sessions.length - 1].present;
    const previous = sessions[sessions.length - 2].present;
    const difference = latest - previous;
    const percentage = previous ? Math.round(Math.abs(difference) / previous * 100) : difference ? 100 : 0;
    const direction = difference > 0 ? "increase" : difference < 0 ? "decrease" : "neutral";
    const icon = difference > 0 ? "trending-up" : difference < 0 ? "trending-down" : "minus";
    const wording = difference > 0 ? `+${difference}` : String(difference);
    changeBadge.className = `attendance-trend-change ${direction}`;
    changeBadge.innerHTML = `<i data-lucide="${icon}"></i> ${wording} (${percentage}%) vs previous`;
  }

  function renderSessionSummary() {
    const container = $("#attendanceSessionSummary");
    if (!container) return;
    const sessions = sessionGroups().slice(0, 5);
    container.innerHTML = sessions.length ? `<div class="attendance-session-list">${sessions.map(session => `<div class="attendance-session-row"><div><strong>${esc(session.title)}</strong><small>${esc(formatDate(session.date))} · ${session.present} present · ${session.menPresent} men · ${session.womenPresent} women · ${session.absent} absent · ${session.excused} excused</small></div><div class="attendance-session-end"><div class="attendance-session-rate"><strong>${attendanceRate(session)}%</strong><span>rate</span></div>${can("attendance.manage") ? `<button class="icon-btn" type="button" data-edit-attendance-session="${session.eventId}" data-attendance-date="${session.date}" aria-label="Edit attendance for ${esc(session.title)}"><i data-lucide="pencil"></i></button>` : ""}</div></div>`).join("")}</div>` : `<div class="empty-state compact"><i data-lucide="clipboard-list"></i><p>No service attendance summaries yet.</p></div>`;
  }

  function renderReport() {
    const container = $("#attendanceReportSummary");
    if (!container) return;
    const sessions = sessionGroups().slice(0, 8);
    container.innerHTML = sessions.length ? `<div class="attendance-report-grid">${sessions.map(session => `<div class="attendance-report-item"><div><div><strong>${esc(session.title)}</strong><small>${esc(formatDate(session.date))}</small></div><span class="attendance-report-rate">${attendanceRate(session)}%</span></div><div class="attendance-report-counts"><span>${session.present} present</span><span>${session.menPresent} men</span><span>${session.womenPresent} women</span><span>${session.absent} absent</span><span>${session.excused} excused</span></div></div>`).join("")}</div>` : `<div class="empty-state compact"><i data-lucide="chart-no-axes-column"></i><p>Attendance reports will appear after attendance is taken.</p></div>`;
  }

  function filteredRecords() {
    const query = $("#attendanceSearch")?.value.trim().toLowerCase() || "";
    const date = $("#attendanceDateFilter")?.value || "";
    const eventId = $("#attendanceEventFilter")?.value || "all";
    const status = $("#attendanceStatusFilter")?.value || "all";
    return state.records.filter(record => {
      const member = memberForRecord(record);
      const event = eventForRecord(record);
      const haystack = `${fullName(member)} ${event?.title || ""} ${record.recorded_by_name || ""}`.toLowerCase();
      return (!query || haystack.includes(query))
        && (!date || record.attendance_date === date)
        && (eventId === "all" || record.event_id === eventId)
        && (status === "all" || record.status === status);
    });
  }

  function renderTable() {
    const table = $("#attendanceRecordsTable");
    if (!table) return;
    const records = filteredRecords();
    const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRecords = records.slice(start, start + PAGE_SIZE);
    table.innerHTML = pageRecords.length ? pageRecords.map(record => {
      const member = memberForRecord(record);
      const event = eventForRecord(record);
      return `<tr><td><div class="attendance-member-cell"><span class="avatar">${esc(initials(member))}</span><div><strong>${esc(fullName(member))}</strong><small>${esc(member?.gender || "Gender not specified")}</small></div></div></td><td>${esc(formatDate(record.attendance_date))}</td><td>${esc(event?.title || "Service or event")}</td><td><span class="status-pill ${record.status.toLowerCase()}">${esc(record.status)}</span></td><td>${esc(record.recorded_by_name || "Administrator")}</td><td>${esc(formatTime(record.updated_at || record.created_at))}</td><td>${can("attendance.manage") ? `<div class="row-actions"><button class="icon-btn delete" type="button" data-delete-attendance="${record.id}" aria-label="Delete attendance record for ${esc(fullName(member))}"><i data-lucide="trash-2"></i></button></div>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty-state"><i data-lucide="clipboard-x"></i><p>No attendance records match the selected filters.</p></div></td></tr>`;

    const count = $("#attendanceTableCount");
    if (count) count.textContent = records.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, records.length)} of ${records.length} attendance records` : "No attendance records";
    $("#attendancePageNumber").textContent = state.page;
    $("#attendancePreviousPage").disabled = state.page <= 1;
    $("#attendanceNextPage").disabled = state.page >= totalPages;
  }

  function renderAll() {
    renderMetrics();
    renderTrend();
    renderSessionSummary();
    renderTable();
    renderReport();
    refreshIcons();
  }

  function renderLoading() {
    const loader = `<div class="attendance-loading"><i data-lucide="loader-circle"></i> Loading attendance records…</div>`;
    if ($("#attendanceMetrics")) $("#attendanceMetrics").innerHTML = ["Today's attendance", "Present", "Men present", "Women present", "Absent", "Attendance rate"].map(label => metricCard(label, "—", "Loading…", "loader-circle", "#98a2b3")).join("");
    if ($("#attendanceTrendChart")) $("#attendanceTrendChart").innerHTML = loader;
    if ($("#attendanceSessionSummary")) $("#attendanceSessionSummary").innerHTML = loader;
    if ($("#attendanceRecordsTable")) $("#attendanceRecordsTable").innerHTML = `<tr><td colspan="7">${loader}</td></tr>`;
    if ($("#attendanceReportSummary")) $("#attendanceReportSummary").innerHTML = loader;
    refreshIcons();
  }

  function renderLoadError(message) {
    const error = `<div class="empty-state compact"><i data-lucide="circle-alert"></i><p>${esc(message)}</p></div>`;
    if ($("#attendanceMetrics")) $("#attendanceMetrics").innerHTML = ["Today's attendance", "Present", "Men present", "Women present", "Absent", "Attendance rate"].map(label => metricCard(label, "—", "Unavailable", "circle-alert", "#d80011")).join("");
    if ($("#attendanceTrendChart")) $("#attendanceTrendChart").innerHTML = error;
    if ($("#attendanceSessionSummary")) $("#attendanceSessionSummary").innerHTML = error;
    if ($("#attendanceRecordsTable")) $("#attendanceRecordsTable").innerHTML = `<tr><td colspan="7">${error}</td></tr>`;
    if ($("#attendanceReportSummary")) $("#attendanceReportSummary").innerHTML = error;
    refreshIcons();
  }

  async function load() {
    if (!state.client || !can("attendance.view")) return;
    state.loading = true;
    renderLoading();
    const { data, error } = await state.client
      .from("member_attendance_records")
      .select("id,member_id,event_id,attendance_date,status,recorded_by,recorded_by_name,created_at,updated_at,members(first_name,last_name,gender,status),events(title,event_date,type)")
      .order("attendance_date", { ascending: false })
      .order("updated_at", { ascending: false });
    state.loading = false;
    if (error) {
      console.error("Unable to load member attendance", error);
      renderLoadError("Unable to load member attendance. Confirm the latest Supabase migration has been applied.");
      return;
    }
    state.records = data || [];
    populateEventOptions();
    renderAll();
    if (typeof state.onChange === "function") state.onChange(state.records.slice());
  }

  function showFormError(message) {
    const error = $("#attendanceFormError");
    error.textContent = message;
    error.hidden = false;
  }

  function clearFormError() {
    const error = $("#attendanceFormError");
    error.hidden = true;
    error.textContent = "";
  }

  function renderRosterSummary() {
    const roster = activeRoster();
    const counts = { Present: 0, Absent: 0, Excused: 0 };
    let menPresent = 0;
    let womenPresent = 0;
    roster.forEach(member => {
      const status = state.draft.get(member.id);
      if (status) counts[status] += 1;
      if (status === "Present" && member.gender === "Male") menPresent += 1;
      if (status === "Present" && member.gender === "Female") womenPresent += 1;
    });
    const unmarked = roster.length - state.draft.size;
    $("#attendanceRosterSummary").innerHTML = `<span>${roster.length} people</span><span class="present">${counts.Present} present</span><span class="men-present">${menPresent} men</span><span class="women-present">${womenPresent} women</span><span class="absent">${counts.Absent} absent</span><span class="excused">${counts.Excused} excused</span><span>${unmarked} unmarked</span>`;
    const saveButton = $("#saveAttendanceBtn");
    if (saveButton && saveButton.dataset.saving !== "true") {
      saveButton.disabled = !roster.length
        || unmarked > 0
        || !$("#takeAttendanceEvent").value
        || !$("#takeAttendanceDate").value;
    }
  }

  function renderRoster() {
    const container = $("#attendanceRoster");
    if (!container) return;
    const query = $("#attendanceMemberSearch")?.value.trim().toLowerCase() || "";
    const roster = activeRoster();
    const filtered = roster.filter(member => !query || `${fullName(member)} ${member.phone || ""} ${member.email || ""}`.toLowerCase().includes(query));
    container.innerHTML = filtered.length ? filtered.map(member => {
      const selected = state.draft.get(member.id) || "";
      return `<div class="attendance-roster-member"><div class="attendance-roster-identity"><span class="avatar">${esc(initials(member))}</span><div><strong>${esc(fullName(member))}</strong><small>${esc(member.gender || "Gender not specified")} · ${esc(member.status || "Member")}</small></div></div><div class="attendance-status-options" role="group" aria-label="Attendance status for ${esc(fullName(member))}">${["Present", "Absent", "Excused"].map(status => `<label class="attendance-status-option ${status.toLowerCase()}"><input type="radio" name="attendance-${member.id}" value="${status}" data-attendance-member="${member.id}" ${selected === status ? "checked" : ""}/><span>${status}</span></label>`).join("")}</div></div>`;
    }).join("") : `<div class="empty-state compact"><i data-lucide="user-round-search"></i><p>${roster.length ? "No members match your search." : "No active members are available for attendance."}</p></div>`;
    renderRosterSummary();
    refreshIcons();
  }

  function loadDraftForSession() {
    state.draft.clear();
    const eventId = $("#takeAttendanceEvent").value;
    const date = $("#takeAttendanceDate").value;
    if (eventId && date) {
      state.records.filter(record => record.event_id === eventId && record.attendance_date === date).forEach(record => {
        state.draft.set(record.member_id, record.status);
      });
    }
    clearFormError();
    renderRoster();
  }

  function openTakeAttendance(options = {}) {
    if (!can("attendance.manage")) return notify("You do not have permission to take attendance.", "error");
    if (!state.events.length) return notify("Create a service or event before taking attendance.", "error");
    if (!activeRoster().length) return notify("Add active members before taking attendance.", "error");
    populateEventOptions();
    const form = $("#takeAttendanceForm");
    form.reset();
    $("#takeAttendanceDate").value = options.date || todayIso();
    $("#takeAttendanceDate").max = todayIso();
    $("#attendanceMemberSearch").value = "";
    $("#takeAttendanceEvent").value = options.eventId || "";
    state.draft.clear();
    if (options.eventId && options.date) loadDraftForSession();
    clearFormError();
    if (!options.eventId || !options.date) renderRoster();
    $("#takeAttendanceDialog").showModal();
    refreshIcons();
  }

  function markAll(status) {
    activeRoster().forEach(member => state.draft.set(member.id, status));
    clearFormError();
    renderRoster();
  }

  async function save(event) {
    event.preventDefault();
    clearFormError();
    const eventId = $("#takeAttendanceEvent").value;
    const date = $("#takeAttendanceDate").value;
    const roster = activeRoster();
    if (!eventId) return showFormError("Select a service or event.");
    if (!date) return showFormError("Select an attendance date.");
    if (date > todayIso()) return showFormError("Attendance cannot be recorded for a future date.");
    if (!roster.length) return showFormError("There are no active members to record.");
    const missing = roster.filter(member => !state.draft.has(member.id));
    if (missing.length) return showFormError(`Mark attendance for all members. ${missing.length} ${missing.length === 1 ? "person is" : "people are"} still unmarked.`);

    const payload = roster.map(member => ({
      member_id: member.id,
      event_id: eventId,
      attendance_date: date,
      status: state.draft.get(member.id)
    }));
    const button = $("#saveAttendanceBtn");
    button.dataset.saving = "true";
    button.disabled = true;
    button.innerHTML = `<i data-lucide="loader-circle"></i> Saving attendance…`;
    refreshIcons();
    try {
      const { error } = await state.client
        .from("member_attendance_records")
        .upsert(payload, { onConflict: "member_id,event_id,attendance_date" });
      if (error) throw error;
      $("#takeAttendanceDialog").close();
      await load();
      notify(`Attendance saved for ${payload.length} ${payload.length === 1 ? "member" : "members"}.`);
    } catch (error) {
      showFormError(error.message || "Unable to save attendance.");
    } finally {
      delete button.dataset.saving;
      button.innerHTML = `<i data-lucide="save"></i> Save attendance`;
      renderRosterSummary();
      refreshIcons();
    }
  }

  async function remove(recordId) {
    if (!can("attendance.manage")) return notify("You do not have permission to remove attendance.", "error");
    const record = state.records.find(item => item.id === recordId);
    const member = memberForRecord(record);
    if (!record || !confirm(`Remove the attendance record for ${fullName(member)}? This cannot be undone.`)) return;
    const { error } = await state.client.from("member_attendance_records").delete().eq("id", recordId);
    if (error) return notify(error.message || "Unable to remove attendance.", "error");
    state.records = state.records.filter(item => item.id !== recordId);
    populateEventOptions();
    renderAll();
    if (typeof state.onChange === "function") state.onChange(state.records.slice());
    notify("Attendance record removed.");
  }

  function clearFilters() {
    $("#attendanceSearch").value = "";
    $("#attendanceDateFilter").value = "";
    $("#attendanceEventFilter").value = "all";
    $("#attendanceStatusFilter").value = "all";
    state.page = 1;
    renderTable();
    refreshIcons();
  }

  function bindEvents() {
    if (state.eventsBound) return;
    state.eventsBound = true;
    $("#takeAttendanceBtn")?.addEventListener("click", openTakeAttendance);
    $("#takeAttendanceForm")?.addEventListener("submit", save);
    document.querySelectorAll("[data-close-take-attendance]").forEach(button => button.addEventListener("click", () => $("#takeAttendanceDialog").close()));
    $("#takeAttendanceEvent")?.addEventListener("change", event => {
      const selectedEvent = state.events.find(item => item.id === event.currentTarget.value);
      if (selectedEvent?.event_date && selectedEvent.event_date <= todayIso()) $("#takeAttendanceDate").value = selectedEvent.event_date;
      loadDraftForSession();
    });
    $("#takeAttendanceDate")?.addEventListener("change", loadDraftForSession);
    $("#attendanceMemberSearch")?.addEventListener("input", renderRoster);
    $("#attendanceRoster")?.addEventListener("change", event => {
      const memberId = event.target.dataset.attendanceMember;
      if (!memberId) return;
      state.draft.set(memberId, event.target.value);
      clearFormError();
      renderRosterSummary();
    });
    $("#markAllPresent")?.addEventListener("click", () => markAll("Present"));
    $("#markAllAbsent")?.addEventListener("click", () => markAll("Absent"));
    $("#attendanceSearch")?.addEventListener("input", () => { state.page = 1; renderTable(); refreshIcons(); });
    $("#attendanceDateFilter")?.addEventListener("change", () => { state.page = 1; renderTable(); refreshIcons(); });
    $("#attendanceEventFilter")?.addEventListener("change", () => { state.page = 1; renderTable(); refreshIcons(); });
    $("#attendanceStatusFilter")?.addEventListener("change", () => { state.page = 1; renderTable(); refreshIcons(); });
    $("#clearAttendanceFilters")?.addEventListener("click", clearFilters);
    $("#attendancePreviousPage")?.addEventListener("click", () => { if (state.page > 1) { state.page -= 1; renderTable(); refreshIcons(); } });
    $("#attendanceNextPage")?.addEventListener("click", () => { const pages = Math.max(1, Math.ceil(filteredRecords().length / PAGE_SIZE)); if (state.page < pages) { state.page += 1; renderTable(); refreshIcons(); } });
    document.addEventListener("click", event => {
      const editSession = event.target.closest("[data-edit-attendance-session]");
      if (editSession) openTakeAttendance({ eventId: editSession.dataset.editAttendanceSession, date: editSession.dataset.attendanceDate });
      const recordId = event.target.closest("[data-delete-attendance]")?.dataset.deleteAttendance;
      if (recordId) remove(recordId);
    });
  }

  function syncReferenceData(members, events) {
    state.members = Array.isArray(members) ? members : [];
    state.events = Array.isArray(events) ? events : [];
    if (!state.initialized) return;
    populateEventOptions();
    if ($("#takeAttendanceDialog")?.open) renderRoster();
  }

  async function initialize(context) {
    state.client = context.client;
    state.userId = context.userId;
    state.permissions = context.permissions || [];
    state.members = context.members || [];
    state.events = context.events || [];
    state.onChange = context.onChange || null;
    state.initialized = true;
    bindEvents();
    populateEventOptions();
    const reportCard = $("#attendanceReportSummary")?.closest(".attendance-report-card");
    if (reportCard) reportCard.hidden = !can("attendance.view");
    if (can("attendance.view")) await load();
  }

  window.AttendanceModule = {
    initialize,
    load,
    openTakeAttendance,
    syncReferenceData,
    summarizeRecords,
    getRecords: () => state.records.slice()
  };
})();
