(function () {
  "use strict";

  const EVENT_TYPES = [
    "Baptism", "Confirmation", "Marriage", "Child Dedication",
    "Reception into Membership", "Transfer In", "Transfer Out", "Funeral / Memorial"
  ];
  const EVENT_META = {
    Baptism: ["droplets", "#0a58ca"],
    Confirmation: ["badge-check", "#6941c6"],
    Marriage: ["heart", "#c11574"],
    "Child Dedication": ["baby", "#b54708"],
    "Reception into Membership": ["user-round-check", "#087a38"],
    "Transfer In": ["log-in", "#067647"],
    "Transfer Out": ["log-out", "#475467"],
    "Funeral / Memorial": ["flower-2", "#344054"]
  };
  const REGISTER_PREFIX = { Baptism: "BAP", Confirmation: "CON", Marriage: "MAR", "Child Dedication": "DED", "Reception into Membership": "REC", "Transfer In": "TRI", "Transfer Out": "TRO", "Funeral / Memorial": "FUN" };
  const state = { client: null, userId: null, permissions: [], members: [], records: [], selectedId: null, search: "", type: "all", year: "all", status: "Recorded", bound: false };
  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const memberName = member => `${member?.first_name || ""} ${member?.last_name || ""}`.trim() || "Unnamed member";
  const memberFor = record => state.members.find(member => member.id === record?.member_id);
  const selectedRecord = () => state.records.find(record => record.id === state.selectedId);
  const dateLabel = value => {
    if (!value) return "Not recorded";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "long", year: "numeric" }).format(date);
  };
  const shortDate = value => {
    if (!value) return "Not recorded";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" }).format(date);
  };

  function filteredRecords() {
    const query = state.search.trim().toLowerCase();
    return state.records.filter(record => {
      const member = memberFor(record);
      const searchable = [record.person_name, record.related_person_name, record.event_type, record.register_number, record.certificate_number, record.officiant, record.location, memberName(member)].join(" ").toLowerCase();
      return (!query || searchable.includes(query))
        && (state.type === "all" || record.event_type === state.type)
        && (state.year === "all" || record.event_date?.slice(0, 4) === state.year)
        && (state.status === "all" || record.status === state.status);
    }).sort((left, right) => `${right.event_date}${right.created_at}`.localeCompare(`${left.event_date}${left.created_at}`));
  }

  function optionMarkup(values, selected) {
    return values.map(value => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("");
  }

  function metricMarkup() {
    const recorded = state.records.filter(record => record.status === "Recorded");
    const currentYear = todayIso().slice(0, 4);
    const metrics = [
      [recorded.length, "Active register entries", "book-open-check", "#0a3995"],
      [recorded.filter(record => record.event_type === "Baptism").length, "Baptisms", "droplets", "#0a58ca"],
      [recorded.filter(record => record.event_type === "Confirmation").length, "Confirmations", "badge-check", "#6941c6"],
      [recorded.filter(record => record.event_date?.startsWith(currentYear)).length, `Events in ${currentYear}`, "calendar-check-2", "#087a38"]
    ];
    return `<div class="life-register-metrics">${metrics.map(([value, label, icon, color]) => `<article style="--register-tone:${color}"><span><i data-lucide="${icon}"></i></span><div><strong>${value}</strong><small>${esc(label)}</small></div></article>`).join("")}</div>`;
  }

  function recordItemMarkup(record) {
    const [icon, color] = EVENT_META[record.event_type] || ["book-open", "#475467"];
    return `<button class="life-record-item ${record.id === state.selectedId ? "selected" : ""} ${record.status === "Voided" ? "voided" : ""}" type="button" data-select-life-record="${record.id}">
      <span class="life-record-icon" style="--event-tone:${color}"><i data-lucide="${icon}"></i></span>
      <span class="life-record-copy"><strong>${esc(record.person_name)}</strong><small>${esc(record.event_type)} &middot; ${esc(record.register_number)}</small><b>${esc(shortDate(record.event_date))}${record.officiant ? ` &middot; ${esc(record.officiant)}` : ""}</b></span>
      <span class="life-record-status ${record.status.toLowerCase()}">${esc(record.status)}</span>
    </button>`;
  }

  function detailField(label, value) {
    if (!value) return "";
    return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function detailMarkup(record) {
    if (!record) return `<div class="life-detail-empty"><i data-lucide="book-open-check"></i><strong>Select a register entry</strong><span>Its official details and linked membership record will appear here.</span></div>`;
    const [icon, color] = EVENT_META[record.event_type] || ["book-open", "#475467"];
    const member = memberFor(record);
    return `<div class="life-detail-heading"><span class="life-detail-icon" style="--event-tone:${color}"><i data-lucide="${icon}"></i></span><div><p>OFFICIAL REGISTER ENTRY</p><h3>${esc(record.person_name)}</h3><span>${esc(record.event_type)} &middot; ${esc(dateLabel(record.event_date))}</span></div><span class="life-record-status ${record.status.toLowerCase()}">${esc(record.status)}</span></div>
      ${record.status === "Voided" ? `<div class="life-void-banner"><i data-lucide="circle-slash-2"></i><div><strong>This record is voided</strong><span>${esc(record.void_reason)}</span></div></div>` : ""}
      <div class="life-register-reference"><div><span>Register number</span><strong>${esc(record.register_number)}</strong></div><div><span>Certificate number</span><strong>${esc(record.certificate_number || "Not issued")}</strong></div></div>
      <div class="life-detail-grid">
        ${detailField("Event date", dateLabel(record.event_date))}
        ${detailField("Date of birth", dateLabel(record.date_of_birth))}
        ${detailField("Baptism type", record.baptism_type)}
        ${detailField("Spouse", record.related_person_name)}
        ${detailField("Parents / guardians", record.parents_guardians)}
        ${detailField("Sponsors / witnesses", record.sponsors_witnesses)}
        ${detailField("Previous congregation", record.previous_congregation)}
        ${detailField("Destination congregation", record.destination_congregation)}
        ${detailField("Officiant", record.officiant || "Not recorded")}
        ${detailField("Location", record.location || "Not recorded")}
        ${detailField("Linked member", member ? `${memberName(member)} (${member.status})` : "No membership record linked")}
      </div>
      ${record.notes ? `<div class="life-detail-notes"><span>Register notes</span><p>${esc(record.notes)}</p></div>` : ""}
      <div class="life-detail-audit"><i data-lucide="shield-check"></i><span>Permanent record created ${esc(dateLabel(record.created_at?.slice(0, 10)))}. Corrections retain the original audit timestamps.</span></div>
      <div class="life-detail-actions"><button class="secondary-btn" type="button" data-print-life-record="${record.id}"><i data-lucide="printer"></i> Print</button>${can("registers.manage") ? record.status === "Recorded" ? `<button class="secondary-btn" type="button" data-edit-life-record="${record.id}"><i data-lucide="pencil"></i> Edit record</button><button class="secondary-btn danger-outline" type="button" data-void-life-record="${record.id}"><i data-lucide="circle-slash-2"></i> Void record</button>` : `<button class="secondary-btn" type="button" data-restore-life-record="${record.id}"><i data-lucide="rotate-ccw"></i> Restore before correcting</button>` : ""}</div>`;
  }

  function render() {
    const root = $("#lifeEventRegistersRoot");
    if (!root) return;
    const records = filteredRecords();
    if (!records.some(record => record.id === state.selectedId)) state.selectedId = records[0]?.id || null;
    const years = [...new Set(state.records.map(record => record.event_date?.slice(0, 4)).filter(Boolean))].sort().reverse();
    root.innerHTML = `<div class="page-heading life-register-heading"><div><p class="breadcrumb">Home <i data-lucide="chevron-right"></i> Church Records</p><h2>Baptism &amp; Life Events</h2><p>Maintain permanent, searchable sacramental and congregational registers.</p></div>${can("registers.manage") ? '<button class="primary-btn" type="button" data-add-life-record><i data-lucide="book-plus"></i> New register entry</button>' : ""}</div>
      ${metricMarkup()}
      <div class="life-register-toolbar"><label><i data-lucide="search"></i><input id="lifeRegisterSearch" type="search" value="${esc(state.search)}" placeholder="Search name, register number, certificate, or officiant..." /></label><select id="lifeRegisterTypeFilter" aria-label="Filter event type"><option value="all">All life events</option>${optionMarkup(EVENT_TYPES, state.type)}</select><select id="lifeRegisterYearFilter" aria-label="Filter year"><option value="all">All years</option>${optionMarkup(years, state.year)}</select><select id="lifeRegisterStatusFilter" aria-label="Filter status"><option value="Recorded" ${state.status === "Recorded" ? "selected" : ""}>Recorded</option><option value="Voided" ${state.status === "Voided" ? "selected" : ""}>Voided</option><option value="all" ${state.status === "all" ? "selected" : ""}>All statuses</option></select><button class="secondary-btn" type="button" data-export-life-register><i data-lucide="download"></i> Export</button></div>
      <div class="life-register-layout"><article class="card life-list-panel"><div class="life-panel-heading"><strong>${records.length} entr${records.length === 1 ? "y" : "ies"}</strong><span>matching the current register filters</span></div><div class="life-record-list">${records.length ? records.map(recordItemMarkup).join("") : '<div class="life-list-empty"><i data-lucide="book-dashed"></i><strong>No register entries found</strong><span>Adjust the filters or add the first life event record.</span></div>'}</div></article><article class="card life-detail-panel">${detailMarkup(selectedRecord())}</article></div>`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  }

  async function load() {
    const { data, error } = await state.client.from("church_life_events").select("*").order("event_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    state.records = data || [];
    if (!state.selectedId) state.selectedId = state.records.find(record => record.status === "Recorded")?.id || state.records[0]?.id || null;
    render();
  }

  function syncConditionalFields() {
    const form = $("#lifeEventForm");
    if (!form) return;
    const type = form.elements.event_type.value;
    form.querySelectorAll("[data-life-events]").forEach(field => {
      const visible = field.dataset.lifeEvents.split("|").includes(type);
      field.hidden = !visible;
      const control = field.querySelector("input,select,textarea");
      if (control) control.required = visible && field.hasAttribute("data-life-required");
    });
  }

  function syncRegisterSuggestion() {
    const form = $("#lifeEventForm");
    if (!form || form.elements.record_id.value) return;
    const input = form.elements.register_number;
    if (input.value && input.value !== input.dataset.suggested) return;
    const prefix = REGISTER_PREFIX[form.elements.event_type.value] || "EVT";
    const year = form.elements.event_date.value?.slice(0, 4) || todayIso().slice(0, 4);
    const expression = new RegExp(`^${prefix}-${year}-(\\d+)$`, "i");
    const next = state.records.reduce((maximum, record) => {
      const match = record.register_number.match(expression);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;
    input.dataset.suggested = `${prefix}-${year}-${String(next).padStart(3, "0")}`;
    input.value = input.dataset.suggested;
  }

  function openRecord(memberId = "", item = null, preferredType = "Baptism") {
    if (!can("registers.manage")) return notify("You do not have permission to manage church registers.", "error");
    const form = $("#lifeEventForm");
    form.reset();
    form.elements.record_id.value = item?.id || "";
    form.elements.member_id.innerHTML = `<option value="">Not linked / person outside directory</option>${state.members.slice().sort((a, b) => memberName(a).localeCompare(memberName(b))).map(member => `<option value="${member.id}">${esc(memberName(member))} &middot; ${esc(member.status)}</option>`).join("")}`;
    form.elements.member_id.value = item?.member_id || memberId;
    const member = state.members.find(candidate => candidate.id === (item?.member_id || memberId));
    form.elements.person_name.value = item?.person_name || (member ? memberName(member) : "");
    form.elements.event_type.value = item?.event_type || preferredType;
    form.elements.event_date.value = item?.event_date || todayIso();
    form.elements.date_of_birth.value = item?.date_of_birth || member?.date_of_birth || "";
    form.elements.location.value = item?.location || "Resurrection Congregation";
    form.elements.officiant.value = item?.officiant || "";
    form.elements.register_number.value = item?.register_number || "";
    form.elements.certificate_number.value = item?.certificate_number || "";
    form.elements.baptism_type.value = item?.baptism_type || "Infant";
    form.elements.related_person_name.value = item?.related_person_name || "";
    form.elements.parents_guardians.value = item?.parents_guardians || "";
    form.elements.sponsors_witnesses.value = item?.sponsors_witnesses || "";
    form.elements.previous_congregation.value = item?.previous_congregation || "";
    form.elements.destination_congregation.value = item?.destination_congregation || "";
    form.elements.notes.value = item?.notes || "";
    $("#lifeEventDialogTitle").textContent = item ? "Edit register entry" : "New register entry";
    $("#saveLifeEvent").textContent = item ? "Save corrections" : "Record life event";
    syncConditionalFields();
    syncRegisterSuggestion();
    $("#lifeEventDialog").showModal();
    setTimeout(() => (form.elements.member_id.value ? form.elements.event_type : form.elements.person_name).focus(), 50);
  }

  async function saveRecord(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.date_of_birth && values.event_date < values.date_of_birth) return notify("The event date cannot be before the person's date of birth.", "error");
    const baptism = values.event_type === "Baptism";
    const marriage = values.event_type === "Marriage";
    const parentEvent = ["Baptism", "Child Dedication"].includes(values.event_type);
    const witnessEvent = ["Baptism", "Confirmation", "Marriage"].includes(values.event_type);
    const payload = {
      member_id: values.member_id || null,
      person_name: values.person_name.trim(), event_type: values.event_type, event_date: values.event_date,
      date_of_birth: values.date_of_birth || null, location: values.location.trim(), officiant: values.officiant.trim(),
      register_number: values.register_number.trim(), certificate_number: values.certificate_number.trim(),
      baptism_type: baptism ? values.baptism_type : null,
      related_person_name: marriage ? values.related_person_name.trim() : "",
      parents_guardians: parentEvent ? values.parents_guardians.trim() : "",
      sponsors_witnesses: witnessEvent ? values.sponsors_witnesses.trim() : "",
      previous_congregation: ["Reception into Membership", "Transfer In"].includes(values.event_type) ? values.previous_congregation.trim() : "",
      destination_congregation: values.event_type === "Transfer Out" ? values.destination_congregation.trim() : "",
      notes: values.notes.trim()
    };
    const id = values.record_id;
    const button = $("#saveLifeEvent");
    button.disabled = true;
    try {
      const query = id ? state.client.from("church_life_events").update(payload).eq("id", id) : state.client.from("church_life_events").insert(payload).select("id").single();
      const { data, error } = await query;
      if (error) throw error;
      state.selectedId = id || data?.id || null;
      $("#lifeEventDialog").close();
      await load();
      notify(id ? "Register entry corrected." : "Life event added to the register.");
    } catch (error) {
      const duplicate = error.code === "23505" ? "That register or certificate number is already in use." : error.message;
      notify(duplicate || "Unable to save the register entry.", "error");
    } finally { button.disabled = false; }
  }

  async function changeStatus(id, status) {
    const payload = status === "Voided" ? { status, void_reason: window.prompt("Why is this register entry being voided? The record will be retained.", "")?.trim() || "" } : { status, void_reason: "" };
    if (status === "Voided" && !payload.void_reason) return;
    const { error } = await state.client.from("church_life_events").update(payload).eq("id", id);
    if (error) return notify(error.message || "Unable to update the register entry.", "error");
    state.selectedId = id;
    await load();
    notify(status === "Voided" ? "Register entry voided and retained for audit." : "Register entry restored.");
  }

  function exportRegister() {
    const rows = filteredRecords();
    if (!rows.length) return notify("There are no register entries to export.", "error");
    const columns = ["register_number", "certificate_number", "event_type", "person_name", "related_person_name", "event_date", "date_of_birth", "baptism_type", "parents_guardians", "sponsors_witnesses", "officiant", "location", "previous_congregation", "destination_congregation", "status", "void_reason", "notes"];
    const safeCell = value => {
      let text = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [columns, ...rows.map(record => columns.map(column => record[column] ?? ""))].map(row => row.map(safeCell).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = `resurrection-life-events-${todayIso()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function printRecord(id) {
    state.selectedId = id;
    render();
    document.body.classList.add("life-register-printing");
    const cleanup = () => document.body.classList.remove("life-register-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    setTimeout(cleanup, 1000);
  }

  function memberHistoryMarkup(memberId) {
    if (!can("registers.view")) return "";
    const records = state.records.filter(record => record.member_id === memberId && record.status === "Recorded").sort((left, right) => right.event_date.localeCompare(left.event_date));
    return `<section class="member-life-summary"><div><p class="eyebrow">CHURCH REGISTER</p><h4>Baptism &amp; Life Events</h4><span>${records.length ? `${records.length} linked official record${records.length === 1 ? "" : "s"}` : "No life events linked yet"}</span></div><div class="member-life-events">${records.length ? records.slice(0, 4).map(record => `<span><i data-lucide="${EVENT_META[record.event_type]?.[0] || "book-open"}"></i><b>${esc(record.event_type)}</b><small>${esc(shortDate(record.event_date))}</small></span>`).join("") : '<span class="empty"><i data-lucide="book-dashed"></i><b>No register history</b></span>'}</div></section>`;
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    document.addEventListener("click", event => {
      if (event.target.closest("[data-add-life-record]")) openRecord();
      const select = event.target.closest("[data-select-life-record]")?.dataset.selectLifeRecord;
      if (select) { state.selectedId = select; render(); }
      const edit = event.target.closest("[data-edit-life-record]")?.dataset.editLifeRecord;
      if (edit) openRecord("", state.records.find(record => record.id === edit));
      const voidId = event.target.closest("[data-void-life-record]")?.dataset.voidLifeRecord;
      if (voidId) changeStatus(voidId, "Voided");
      const restoreId = event.target.closest("[data-restore-life-record]")?.dataset.restoreLifeRecord;
      if (restoreId) changeStatus(restoreId, "Recorded");
      const printId = event.target.closest("[data-print-life-record]")?.dataset.printLifeRecord;
      if (printId) printRecord(printId);
      if (event.target.closest("[data-export-life-register]")) exportRegister();
    });
    document.addEventListener("input", event => {
      if (event.target.id === "lifeRegisterSearch") {
        state.search = event.target.value; render();
        const input = $("#lifeRegisterSearch"); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length);
      }
    });
    document.addEventListener("change", event => {
      const filters = { lifeRegisterTypeFilter: "type", lifeRegisterYearFilter: "year", lifeRegisterStatusFilter: "status" };
      if (filters[event.target.id]) { state[filters[event.target.id]] = event.target.value; render(); }
      if (event.target.closest("#lifeEventForm") && event.target.name === "event_type") { syncConditionalFields(); syncRegisterSuggestion(); }
      if (event.target.closest("#lifeEventForm") && event.target.name === "event_date") syncRegisterSuggestion();
      if (event.target.closest("#lifeEventForm") && event.target.name === "member_id" && event.target.value) {
        const form = $("#lifeEventForm"); const member = state.members.find(candidate => candidate.id === event.target.value);
        if (member) { form.elements.person_name.value = memberName(member); form.elements.date_of_birth.value = member.date_of_birth || ""; }
      }
    });
    $("#lifeEventForm")?.addEventListener("submit", saveRecord);
    document.querySelectorAll("[data-close-life-event-dialog]").forEach(button => button.addEventListener("click", () => $("#lifeEventDialog")?.close()));
  }

  async function initialize({ client, userId, permissions, members }) {
    state.client = client; state.userId = userId; state.permissions = permissions || []; state.members = members || [];
    bind(); await load();
  }
  function syncMembers(members) { state.members = members || []; render(); }

  window.LifeEventRegisters = { initialize, render, syncMembers, openRecord, memberHistoryMarkup };
})();
