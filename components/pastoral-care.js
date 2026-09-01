(function () {
  "use strict";

  const CASE_TYPES = ["Visitor Follow-up", "Inactive Member Follow-up", "Home Visitation", "Hospital Visit", "Prayer Request", "Counselling", "Bereavement", "Welfare Support", "General Pastoral Care", "Other"];
  const ACTIVITY_TYPES = ["Phone Call", "Home Visit", "Hospital Visit", "Church Meeting", "Prayer", "Message", "Referral", "Welfare Support", "Note", "Other"];
  const state = { client: null, userId: null, permissions: [], members: [], staff: [], cases: [], activities: [], selectedCaseId: null, search: "", status: "active", priority: "all", type: "all", assignee: "all", bound: false };
  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const memberFor = item => state.members.find(member => member.id === item?.member_id);
  const memberName = member => `${member?.first_name || ""} ${member?.last_name || ""}`.trim() || "Unknown member";
  const staffFor = id => state.staff.find(person => person.user_id === id);
  const staffName = id => staffFor(id)?.display_name || "Unassigned";
  const isActive = item => ["Open", "In Progress"].includes(item.status);
  const isOverdue = item => isActive(item) && item.next_follow_up_date && item.next_follow_up_date < todayIso();
  const selectedCase = () => state.cases.find(item => item.id === state.selectedCaseId) || null;
  const optionMarkup = (values, selected) => values.map(value => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("");

  function dateLabel(value, fallback = "Not scheduled") {
    if (!value) return fallback;
    return new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
  }

  function longDate(value) {
    if (!value) return "Not recorded";
    return new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
  }

  function statusTone(value) {
    return value === "Completed" ? "active" : value === "Closed" ? "inactive" : value === "In Progress" ? "meeting" : "neutral";
  }

  function priorityTone(value) {
    return value === "Urgent" ? "urgent" : value === "High" ? "high" : "normal";
  }

  function filteredCases() {
    const query = state.search.trim().toLowerCase();
    return state.cases.filter(item => {
      const member = memberFor(item);
      const searchable = `${memberName(member)} ${member?.phone || ""} ${item.summary} ${item.care_type} ${staffName(item.assigned_to)}`.toLowerCase();
      const statusMatch = state.status === "all" || (state.status === "active" ? isActive(item) : item.status === state.status);
      return (!query || searchable.includes(query))
        && statusMatch
        && (state.priority === "all" || item.priority === state.priority)
        && (state.type === "all" || item.care_type === state.type)
        && (state.assignee === "all" || (state.assignee === "unassigned" ? !item.assigned_to : item.assigned_to === state.assignee));
    }).sort((left, right) => {
      const priorityOrder = { Urgent: 0, High: 1, Normal: 2 };
      if (isOverdue(left) !== isOverdue(right)) return isOverdue(left) ? -1 : 1;
      if (priorityOrder[left.priority] !== priorityOrder[right.priority]) return priorityOrder[left.priority] - priorityOrder[right.priority];
      return String(left.next_follow_up_date || "9999").localeCompare(String(right.next_follow_up_date || "9999"));
    });
  }

  function metricsMarkup() {
    const active = state.cases.filter(isActive);
    const overdue = active.filter(isOverdue);
    const urgent = active.filter(item => item.priority === "Urgent");
    const completedMonth = state.cases.filter(item => item.status === "Completed" && item.completed_at?.slice(0, 7) === todayIso().slice(0, 7));
    return `<div class="pastoral-metrics">
      ${[[active.length,"Active cases","heart-handshake","#0a3995"],[overdue.length,"Overdue follow-ups","alarm-clock","#b42318"],[urgent.length,"Urgent care","circle-alert","#d80011"],[completedMonth.length,"Completed this month","badge-check","#087a38"]].map(([value,label,icon,color]) => `<article style="--pastoral-tone:${color}"><span><i data-lucide="${icon}"></i></span><div><strong>${value}</strong><small>${label}</small></div></article>`).join("")}
    </div>`;
  }

  function caseItemMarkup(item) {
    const member = memberFor(item);
    return `<button class="pastoral-case-item ${item.id === state.selectedCaseId ? "selected" : ""} ${isOverdue(item) ? "overdue" : ""}" type="button" data-select-pastoral-case="${item.id}">
      <span class="pastoral-case-avatar">${esc(`${member?.first_name?.[0] || ""}${member?.last_name?.[0] || ""}`.toUpperCase() || "PC")}</span>
      <span class="pastoral-case-copy"><strong>${esc(memberName(member))}</strong><small>${esc(item.care_type)} · ${esc(staffName(item.assigned_to))}</small><b>${esc(item.summary)}</b></span>
      <span class="pastoral-case-meta"><i class="pastoral-priority ${priorityTone(item.priority)}">${esc(item.priority)}</i><small class="${isOverdue(item) ? "overdue" : ""}">${isOverdue(item) ? "Overdue · " : ""}${esc(dateLabel(item.next_follow_up_date))}</small></span>
    </button>`;
  }

  function activityMarkup(item) {
    const recorder = staffFor(item.recorded_by);
    return `<article class="pastoral-activity ${item.is_confidential ? "confidential" : ""}"><span class="pastoral-activity-icon"><i data-lucide="${item.is_confidential ? "lock-keyhole" : item.activity_type.includes("Visit") ? "map-pin-check" : item.activity_type === "Phone Call" ? "phone-call" : item.activity_type === "Prayer" ? "heart" : "message-square-text"}"></i></span><div><div class="pastoral-activity-meta"><strong>${esc(item.activity_type)}</strong><time>${esc(longDate(item.activity_date))}</time>${item.is_confidential ? '<span><i data-lucide="lock-keyhole"></i> Confidential</span>' : ""}</div>${item.outcome ? `<h5>${esc(item.outcome)}</h5>` : ""}<p>${esc(item.notes || "No additional notes recorded.")}</p><small>Recorded by ${esc(recorder?.display_name || "Church staff")}${item.next_follow_up_date ? ` · Next follow-up ${esc(longDate(item.next_follow_up_date))}` : ""}</small></div>${can("pastoral.manage") ? `<div class="row-actions"><button class="icon-btn" type="button" data-edit-pastoral-activity="${item.id}" aria-label="Edit activity"><i data-lucide="pencil"></i></button><button class="icon-btn delete" type="button" data-delete-pastoral-activity="${item.id}" aria-label="Delete activity"><i data-lucide="trash-2"></i></button></div>` : ""}</article>`;
  }

  function detailMarkup(item) {
    if (!item) return `<div class="pastoral-detail-empty"><i data-lucide="heart-handshake"></i><strong>Select a pastoral care case</strong><span>Review its follow-up plan and activity timeline here.</span></div>`;
    const member = memberFor(item);
    const activities = state.activities.filter(activity => activity.case_id === item.id).sort((left, right) => `${right.activity_date}${right.created_at}`.localeCompare(`${left.activity_date}${left.created_at}`));
    return `<div class="pastoral-detail-heading"><div><p>PASTORAL CARE CASE</p><h3>${esc(memberName(member))}</h3><span>${esc(member?.phone || member?.email || member?.status || "No contact details")}</span></div><div class="pastoral-detail-badges"><span class="status-pill ${statusTone(item.status)}">${esc(item.status)}</span><i class="pastoral-priority ${priorityTone(item.priority)}">${esc(item.priority)}</i></div></div>
      <div class="pastoral-detail-summary"><strong>${esc(item.care_type)}</strong><p>${esc(item.summary)}</p></div>
      <div class="pastoral-detail-grid"><div><span>Assigned caregiver</span><strong>${esc(staffName(item.assigned_to))}</strong></div><div><span>Case opened</span><strong>${esc(longDate(item.opened_on))}</strong></div><div class="${isOverdue(item) ? "overdue" : ""}"><span>Next follow-up</span><strong>${esc(dateLabel(item.next_follow_up_date))}</strong></div><div><span>Activity entries</span><strong>${activities.length}</strong></div></div>
      ${can("pastoral.manage") ? `<div class="pastoral-detail-actions"><button class="secondary-btn" type="button" data-edit-pastoral-case="${item.id}"><i data-lucide="pencil"></i> Edit case</button>${isActive(item) ? `<button class="secondary-btn" type="button" data-complete-pastoral-case="${item.id}"><i data-lucide="circle-check-big"></i> Mark completed</button>` : ""}<button class="icon-btn delete" type="button" data-delete-pastoral-case="${item.id}" aria-label="Delete pastoral care case"><i data-lucide="trash-2"></i></button><button class="primary-btn" type="button" data-add-pastoral-activity="${item.id}"><i data-lucide="plus"></i> Record follow-up</button></div>` : ""}
      <div class="pastoral-timeline-heading"><div><p>CARE TIMELINE</p><h4>Follow-up activity</h4></div>${can("pastoral.confidential") ? '<span><i data-lucide="shield-check"></i> Confidential entries are protected</span>' : ""}</div>
      <div class="pastoral-activity-list">${activities.length ? activities.map(activityMarkup).join("") : '<div class="pastoral-activity-empty"><i data-lucide="notebook-pen"></i><span>No follow-up activity has been recorded.</span></div>'}</div>`;
  }

  function render() {
    const root = $("#pastoralCareModuleRoot");
    if (!root) return;
    const cases = filteredCases();
    if (state.selectedCaseId && !state.cases.some(item => item.id === state.selectedCaseId)) state.selectedCaseId = null;
    root.innerHTML = `<div class="page-heading pastoral-page-heading"><div><p class="breadcrumb">Home <i data-lucide="chevron-right"></i> Ministry</p><h2>Pastoral Care</h2><p>Coordinate compassionate, accountable follow-up for members and visitors.</p></div>${can("pastoral.manage") ? '<button class="primary-btn" type="button" data-add-pastoral-case><i data-lucide="heart-handshake"></i> New care case</button>' : ""}</div>
      ${metricsMarkup()}
      <div class="pastoral-toolbar"><label><i data-lucide="search"></i><input id="pastoralSearch" type="search" value="${esc(state.search)}" placeholder="Search member, case, or caregiver..." /></label><select id="pastoralStatusFilter" aria-label="Filter status"><option value="active" ${state.status === "active" ? "selected" : ""}>Active cases</option><option value="all" ${state.status === "all" ? "selected" : ""}>All statuses</option>${optionMarkup(["Open","In Progress","Completed","Closed"], state.status)}</select><select id="pastoralPriorityFilter" aria-label="Filter priority"><option value="all">All priorities</option>${optionMarkup(["Normal","High","Urgent"], state.priority)}</select><select id="pastoralTypeFilter" aria-label="Filter care type"><option value="all">All care types</option>${optionMarkup(CASE_TYPES, state.type)}</select><select id="pastoralAssigneeFilter" aria-label="Filter caregiver"><option value="all">All caregivers</option><option value="unassigned" ${state.assignee === "unassigned" ? "selected" : ""}>Unassigned</option>${state.staff.map(person => `<option value="${person.user_id}" ${state.assignee === person.user_id ? "selected" : ""}>${esc(person.display_name)}</option>`).join("")}</select></div>
      <div class="pastoral-layout"><article class="card pastoral-case-panel"><div class="pastoral-panel-heading"><div><strong>${cases.length} case${cases.length === 1 ? "" : "s"}</strong><span>${state.status === "active" ? "requiring attention" : "matching these filters"}</span></div></div><div class="pastoral-case-list">${cases.length ? cases.map(caseItemMarkup).join("") : '<div class="pastoral-list-empty"><i data-lucide="search-x"></i><strong>No cases found</strong><span>Adjust the filters or create a new pastoral care case.</span></div>'}</div></article><article class="card pastoral-detail-panel">${detailMarkup(selectedCase())}</article></div>`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  }

  async function load() {
    const [casesResult, activitiesResult, staffResult] = await Promise.all([
      state.client.from("pastoral_care_cases").select("*").order("updated_at", { ascending: false }),
      state.client.from("pastoral_care_activities").select("*").order("activity_date", { ascending: false }).order("created_at", { ascending: false }),
      state.client.rpc("list_pastoral_caregivers")
    ]);
    const failure = [casesResult, activitiesResult, staffResult].find(result => result.error);
    if (failure) throw failure.error;
    state.cases = casesResult.data || [];
    state.activities = activitiesResult.data || [];
    state.staff = staffResult.data || [];
    if (!state.selectedCaseId) state.selectedCaseId = state.cases.find(isActive)?.id || state.cases[0]?.id || null;
    render();
  }

  function openCase(memberId = "", item = null) {
    if (!can("pastoral.manage")) return notify("You do not have permission to manage pastoral care.", "error");
    const form = $("#pastoralCaseForm");
    form.reset();
    form.elements.case_id.value = item?.id || "";
    form.elements.member_id.innerHTML = `<option value="">Select member or visitor</option>${state.members.slice().sort((a,b) => memberName(a).localeCompare(memberName(b))).map(member => `<option value="${member.id}">${esc(memberName(member))} · ${esc(member.status)}</option>`).join("")}`;
    form.elements.member_id.value = item?.member_id || memberId;
    form.elements.care_type.value = item?.care_type || (state.members.find(member => member.id === memberId)?.status === "Visitor" ? "Visitor Follow-up" : "General Pastoral Care");
    form.elements.priority.value = item?.priority || "Normal";
    form.elements.status.value = item?.status || "Open";
    form.elements.assigned_to.innerHTML = `<option value="">Unassigned</option>${state.staff.map(person => `<option value="${person.user_id}">${esc(person.display_name)} · ${esc(person.role_name)}</option>`).join("")}`;
    form.elements.assigned_to.value = item?.assigned_to || state.userId;
    form.elements.opened_on.value = item?.opened_on || todayIso();
    form.elements.next_follow_up_date.value = item?.next_follow_up_date || "";
    form.elements.summary.value = item?.summary || "";
    $("#pastoralCaseDialogTitle").textContent = item ? "Edit pastoral care case" : "Open pastoral care case";
    $("#savePastoralCase").textContent = item ? "Save changes" : "Open care case";
    $("#pastoralCaseDialog").showModal();
    setTimeout(() => form.elements.member_id.focus(), 50);
  }

  function openActivity(caseId, item = null) {
    if (!can("pastoral.manage")) return;
    const form = $("#pastoralActivityForm");
    form.reset();
    form.elements.activity_id.value = item?.id || "";
    form.elements.case_id.value = item?.case_id || caseId;
    form.elements.activity_date.value = item?.activity_date || todayIso();
    form.elements.activity_type.value = item?.activity_type || "Phone Call";
    form.elements.outcome.value = item?.outcome || "";
    form.elements.notes.value = item?.notes || "";
    form.elements.next_follow_up_date.value = item?.next_follow_up_date || "";
    form.elements.is_confidential.checked = item?.is_confidential || false;
    $("#pastoralConfidentialField").hidden = !can("pastoral.confidential");
    $("#pastoralActivityDialogTitle").textContent = item ? "Edit follow-up activity" : "Record follow-up activity";
    $("#savePastoralActivity").textContent = item ? "Save changes" : "Record activity";
    $("#pastoralActivityDialog").showModal();
    setTimeout(() => form.elements.activity_type.focus(), 50);
  }

  async function saveCase(event) {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries()); const id = values.case_id;
    if (!values.summary.trim()) return notify("Enter a short non-confidential care summary.", "error");
    if (values.next_follow_up_date && values.next_follow_up_date < values.opened_on) return notify("The next follow-up cannot be before the case opening date.", "error");
    const payload = { member_id: values.member_id, care_type: values.care_type, priority: values.priority, status: values.status, assigned_to: values.assigned_to || null, opened_on: values.opened_on, next_follow_up_date: values.next_follow_up_date || null, summary: values.summary.trim() };
    const button = $("#savePastoralCase"); button.disabled = true;
    try { const query = id ? state.client.from("pastoral_care_cases").update(payload).eq("id", id) : state.client.from("pastoral_care_cases").insert(payload); const { error } = await query; if (error) throw error; $("#pastoralCaseDialog").close(); await load(); notify(id ? "Pastoral care case updated." : "Pastoral care case opened."); }
    catch (error) { notify(error.message || "Unable to save the pastoral care case.", "error"); }
    finally { button.disabled = false; }
  }

  async function saveActivity(event) {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries()); const id = values.activity_id;
    if (!values.outcome.trim() && !values.notes.trim()) return notify("Record an outcome or follow-up note.", "error");
    if (values.next_follow_up_date && values.next_follow_up_date < values.activity_date) return notify("The next follow-up cannot be before this activity date.", "error");
    const payload = { case_id: values.case_id, activity_date: values.activity_date, activity_type: values.activity_type, outcome: values.outcome.trim(), notes: values.notes.trim(), next_follow_up_date: values.next_follow_up_date || null, is_confidential: can("pastoral.confidential") && form.elements.is_confidential.checked };
    const button = $("#savePastoralActivity"); button.disabled = true;
    try { const query = id ? state.client.from("pastoral_care_activities").update(payload).eq("id", id) : state.client.from("pastoral_care_activities").insert(payload); const { error } = await query; if (error) throw error; state.selectedCaseId = payload.case_id; $("#pastoralActivityDialog").close(); await load(); notify(id ? "Follow-up activity updated." : "Follow-up activity recorded."); }
    catch (error) { notify(error.message || "Unable to save the follow-up activity.", "error"); }
    finally { button.disabled = false; }
  }

  async function updateCase(id, payload, message) {
    const { error } = await state.client.from("pastoral_care_cases").update(payload).eq("id", id);
    if (error) return notify(error.message, "error");
    await load(); notify(message);
  }

  async function removeRecord(table, id, label) {
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    const { error } = await state.client.from(table).delete().eq("id", id);
    if (error) return notify(error.message, "error");
    if (table === "pastoral_care_cases" && state.selectedCaseId === id) state.selectedCaseId = null;
    await load(); notify(`${label[0].toUpperCase() + label.slice(1)} deleted.`);
  }

  function memberCaseMarkup(memberId) {
    if (!can("pastoral.view")) return "";
    const cases = state.cases.filter(item => item.member_id === memberId);
    const active = cases.filter(isActive); const overdue = active.filter(isOverdue);
    return `<section class="member-pastoral-summary"><div><p class="eyebrow">PASTORAL CARE</p><h4>Care &amp; Follow-up</h4><span>Visible only to authorized pastoral-care users.</span></div><div><strong>${active.length}</strong><span>Active case${active.length === 1 ? "" : "s"}</span></div><div class="${overdue.length ? "overdue" : ""}"><strong>${overdue.length}</strong><span>Overdue follow-up${overdue.length === 1 ? "" : "s"}</span></div></section>`;
  }

  function bind() {
    if (state.bound) return; state.bound = true;
    document.addEventListener("click", event => {
      if (event.target.closest("[data-add-pastoral-case]")) openCase();
      const selected = event.target.closest("[data-select-pastoral-case]")?.dataset.selectPastoralCase; if (selected) { state.selectedCaseId = selected; render(); }
      const editCase = event.target.closest("[data-edit-pastoral-case]")?.dataset.editPastoralCase; if (editCase) openCase("", state.cases.find(item => item.id === editCase));
      const completeCase = event.target.closest("[data-complete-pastoral-case]")?.dataset.completePastoralCase; if (completeCase) updateCase(completeCase, { status: "Completed" }, "Pastoral care case completed.");
      const deleteCase = event.target.closest("[data-delete-pastoral-case]")?.dataset.deletePastoralCase; if (deleteCase) removeRecord("pastoral_care_cases", deleteCase, "pastoral care case");
      const addActivity = event.target.closest("[data-add-pastoral-activity]")?.dataset.addPastoralActivity; if (addActivity) openActivity(addActivity);
      const editActivity = event.target.closest("[data-edit-pastoral-activity]")?.dataset.editPastoralActivity; if (editActivity) openActivity("", state.activities.find(item => item.id === editActivity));
      const deleteActivity = event.target.closest("[data-delete-pastoral-activity]")?.dataset.deletePastoralActivity; if (deleteActivity) removeRecord("pastoral_care_activities", deleteActivity, "follow-up activity");
    });
    document.addEventListener("input", event => { if (event.target.id === "pastoralSearch") { state.search = event.target.value; render(); const input = $("#pastoralSearch"); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); } });
    document.addEventListener("change", event => { const filters = { pastoralStatusFilter: "status", pastoralPriorityFilter: "priority", pastoralTypeFilter: "type", pastoralAssigneeFilter: "assignee" }; if (filters[event.target.id]) { state[filters[event.target.id]] = event.target.value; render(); } });
    $("#pastoralCaseForm")?.addEventListener("submit", saveCase); $("#pastoralActivityForm")?.addEventListener("submit", saveActivity);
    document.querySelectorAll("[data-close-pastoral-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog")?.close()));
  }

  async function initialize({ client, userId, permissions, members }) { state.client = client; state.userId = userId; state.permissions = permissions || []; state.members = members || []; bind(); await load(); }
  function syncMembers(members) { state.members = members || []; render(); }

  window.PastoralCareModule = { initialize, render, syncMembers, openCase, memberCaseMarkup };
})();
