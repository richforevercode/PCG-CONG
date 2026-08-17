(function () {
  "use strict";

  const state = {
    client: null,
    permissions: [],
    groups: [],
    onChange: null,
    loadStatus: "idle",
    eventsBound: false
  };

  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const canManage = () => state.permissions.includes("settings.manage");
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });

  function sortedGroups(groups = state.groups) {
    return groups.slice().sort((left, right) =>
      Number(left.minimum_age) - Number(right.minimum_age)
      || String(left.gender).localeCompare(String(right.gender))
      || String(left.name).localeCompare(String(right.name))
    );
  }

  function calculateAge(dateOfBirth, today = new Date()) {
    if (!dateOfBirth) return { age: null, code: "missing-date" };

    const match = String(dateOfBirth).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return { age: null, code: "invalid-date" };

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year
      || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day
    ) return { age: null, code: "invalid-date" };

    const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (parsed > current) return { age: null, code: "future-date" };

    let age = current.getFullYear() - year;
    const birthdayHasPassed = current.getMonth() > month - 1
      || (current.getMonth() === month - 1 && current.getDate() >= day);
    if (!birthdayHasPassed) age -= 1;
    return { age, code: "ok" };
  }

  function classify(member, groups = state.groups, today = new Date()) {
    const ageResult = calculateAge(member?.date_of_birth, today);
    if (ageResult.code !== "ok") return { ...ageResult, group: null, matches: [] };
    if (groups === state.groups && state.loadStatus !== "ready") {
      return { ...ageResult, code: "rules-unavailable", group: null, matches: [] };
    }

    const matches = groups.filter(group => {
      if (group.status !== "Active") return false;
      const minimumAge = Number(group.minimum_age);
      const maximumAge = group.maximum_age === null || group.maximum_age === ""
        ? null
        : Number(group.maximum_age);
      const ageMatches = ageResult.age >= minimumAge
        && (maximumAge === null || ageResult.age <= maximumAge);
      const genderMatches = group.gender === "All" || group.gender === member?.gender;
      return ageMatches && genderMatches;
    });

    if (matches.length === 0) return { ...ageResult, code: "no-match", group: null, matches: [] };
    if (matches.length > 1) return { ...ageResult, code: "multiple-matches", group: null, matches };
    return { ...ageResult, code: "matched", group: matches[0], matches };
  }

  function formatAgeRange(group) {
    return group.maximum_age === null || group.maximum_age === ""
      ? `${group.minimum_age}+`
      : `${group.minimum_age}–${group.maximum_age}`;
  }

  function overlapError(candidate) {
    if (candidate.status !== "Active") return "";

    const conflict = state.groups.find(existing => {
      if (existing.id === candidate.id || existing.status !== "Active") return false;
      const candidateMaximum = candidate.maximum_age === null ? Infinity : candidate.maximum_age;
      const existingMaximum = existing.maximum_age === null ? Infinity : Number(existing.maximum_age);
      const agesOverlap = candidate.minimum_age <= existingMaximum
        && Number(existing.minimum_age) <= candidateMaximum;
      const gendersOverlap = candidate.gender === "All"
        || existing.gender === "All"
        || candidate.gender === existing.gender;
      return agesOverlap && gendersOverlap;
    });

    if (!conflict) return "";
    const overlapStart = Math.max(candidate.minimum_age, Number(conflict.minimum_age));
    const candidateMaximum = candidate.maximum_age === null ? Infinity : candidate.maximum_age;
    const conflictMaximum = conflict.maximum_age === null ? Infinity : Number(conflict.maximum_age);
    const overlapEnd = Math.min(candidateMaximum, conflictMaximum);
    const overlapLabel = overlapEnd === Infinity
      ? `age ${overlapStart} and above`
      : overlapStart === overlapEnd
        ? `age ${overlapStart}`
        : `ages ${overlapStart}–${overlapEnd}`;
    return `This rule conflicts with “${conflict.name}” at ${overlapLabel}. Age boundaries are inclusive.`;
  }

  function render() {
    const table = $("#generationalGroupsTable");
    if (!table) return;

    if (state.loadStatus === "idle" || state.loadStatus === "loading") {
      table.innerHTML = `<tr><td colspan="5"><div class="empty-state compact"><i data-lucide="loader-circle"></i><p>Loading generational group rules…</p></div></td></tr>`;
      const loadingCount = $("#generationalGroupsCount");
      if (loadingCount) loadingCount.textContent = "Loading group rules…";
      refreshIcons();
      return;
    }

    const groups = sortedGroups();
    table.innerHTML = groups.length ? groups.map(group => `
      <tr>
        <td data-label="Group"><div class="group-rule-name"><strong>${esc(group.name)}</strong>${group.description ? `<small>${esc(group.description)}</small>` : ""}</div></td>
        <td data-label="Age range"><strong>${esc(formatAgeRange(group))}</strong></td>
        <td data-label="Gender">${esc(group.gender)}</td>
        <td data-label="Status"><span class="status-pill ${group.status.toLowerCase()}">${esc(group.status)}</span></td>
        <td data-label="Actions">${canManage() ? `<div class="row-actions"><button class="icon-btn" data-edit-generational-group="${group.id}" aria-label="Edit ${esc(group.name)}"><i data-lucide="pencil"></i></button><button class="icon-btn delete" data-delete-generational-group="${group.id}" aria-label="Delete ${esc(group.name)}"><i data-lucide="trash-2"></i></button></div>` : ""}</td>
      </tr>
    `).join("") : `<tr><td colspan="5"><div class="empty-state"><i data-lucide="users-round"></i><p>No generational groups are configured.</p></div></td></tr>`;

    const count = $("#generationalGroupsCount");
    if (count) {
      const activeCount = groups.filter(group => group.status === "Active").length;
      count.textContent = `${groups.length} group${groups.length === 1 ? "" : "s"} · ${activeCount} active`;
    }
    const addButton = $("#addGenerationalGroupBtn");
    if (addButton) addButton.hidden = !canManage();
    refreshIcons();
  }

  function renderLoadError(message) {
    const table = $("#generationalGroupsTable");
    if (table) table.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i data-lucide="circle-alert"></i><p>${esc(message)}</p></div></td></tr>`;
    const count = $("#generationalGroupsCount");
    if (count) count.textContent = "Rules unavailable";
    refreshIcons();
  }

  function emitChange() {
    render();
    if (typeof state.onChange === "function") state.onChange(getGroups());
  }

  async function load() {
    if (!state.client) return;
    state.loadStatus = "loading";
    const { data, error } = await state.client
      .from("generational_groups")
      .select("id,name,minimum_age,maximum_age,gender,status,description,created_at,updated_at")
      .order("minimum_age", { ascending: true })
      .order("gender", { ascending: true });

    if (error) {
      state.loadStatus = "error";
      console.error("Unable to load generational groups", error);
      renderLoadError("Unable to load group rules. Confirm the latest database migration has been applied.");
      return;
    }

    state.groups = data || [];
    state.loadStatus = "ready";
    emitChange();
  }

  function openDialog(group = null) {
    if (!canManage()) return notify("You do not have permission to manage generational groups.", "error");
    const dialog = $("#generationalGroupDialog");
    const form = $("#generationalGroupForm");
    form.reset();
    form.elements.group_id.value = group?.id || "";
    form.elements.name.value = group?.name || "";
    form.elements.minimum_age.value = group?.minimum_age ?? 0;
    form.elements.maximum_age.value = group?.maximum_age ?? "";
    form.elements.gender.value = group?.gender || "All";
    form.elements.status.value = group?.status || "Active";
    form.elements.description.value = group?.description || "";
    $("#generationalGroupDialogTitle").textContent = group ? "Edit generational group" : "Create generational group";
    $("#saveGenerationalGroupBtn").textContent = group ? "Save changes" : "Create group";
    $("#generationalGroupFormError").hidden = true;
    dialog.showModal();
    setTimeout(() => form.elements.name.focus(), 50);
  }

  function showFormError(message) {
    const error = $("#generationalGroupFormError");
    error.textContent = message;
    error.hidden = false;
  }

  function friendlyDatabaseError(error) {
    if (error?.code === "23505") return "A generational group with this name already exists.";
    return error?.message || "Unable to save the generational group.";
  }

  async function save(event) {
    event.preventDefault();
    if (!canManage()) return showFormError("You do not have permission to manage generational groups.");

    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const minimumAge = Number(values.minimum_age);
    const maximumAge = values.maximum_age === "" ? null : Number(values.maximum_age);
    if (!values.name.trim()) return showFormError("Enter a group name.");
    if (!Number.isInteger(minimumAge) || minimumAge < 0) return showFormError("Minimum age must be a whole number of 0 or greater.");
    if (maximumAge !== null && (!Number.isInteger(maximumAge) || maximumAge < minimumAge)) {
      return showFormError("Maximum age must be a whole number greater than or equal to minimum age.");
    }

    const candidate = {
      id: values.group_id || undefined,
      name: values.name.trim(),
      minimum_age: minimumAge,
      maximum_age: maximumAge,
      gender: values.gender,
      status: values.status,
      description: values.description.trim()
    };
    const conflictMessage = overlapError(candidate);
    if (conflictMessage) return showFormError(conflictMessage);

    const saveButton = $("#saveGenerationalGroupBtn");
    saveButton.disabled = true;
    try {
      const payload = { ...candidate };
      delete payload.id;
      const query = candidate.id
        ? state.client.from("generational_groups").update(payload).eq("id", candidate.id)
        : state.client.from("generational_groups").insert(payload);
      const { data, error } = await query.select().single();
      if (error) throw error;

      const existingIndex = state.groups.findIndex(group => group.id === data.id);
      if (existingIndex >= 0) state.groups[existingIndex] = data;
      else state.groups.push(data);
      $("#generationalGroupDialog").close();
      emitChange();
      notify(candidate.id ? "Generational group updated." : "Generational group created.");
    } catch (error) {
      showFormError(friendlyDatabaseError(error));
    } finally {
      saveButton.disabled = false;
    }
  }

  async function remove(groupId) {
    if (!canManage()) return notify("You do not have permission to manage generational groups.", "error");
    const group = state.groups.find(item => item.id === groupId);
    if (!group) return;
    const warning = group.status === "Active"
      ? `Delete “${group.name}”? If it currently classifies members, deactivate it first.`
      : `Delete “${group.name}”? This cannot be undone.`;
    if (!confirm(warning)) return;

    const { error } = await state.client.from("generational_groups").delete().eq("id", groupId);
    if (error) return notify(friendlyDatabaseError(error), "error");
    state.groups = state.groups.filter(item => item.id !== groupId);
    emitChange();
    notify("Generational group deleted.");
  }

  function bindEvents() {
    if (state.eventsBound) return;
    state.eventsBound = true;
    $("#addGenerationalGroupBtn")?.addEventListener("click", () => openDialog());
    $("#generationalGroupForm")?.addEventListener("submit", save);
    document.querySelectorAll("[data-close-generational-group-dialog]").forEach(button => {
      button.addEventListener("click", () => $("#generationalGroupDialog").close());
    });
    document.addEventListener("click", event => {
      const editId = event.target.closest("[data-edit-generational-group]")?.dataset.editGenerationalGroup;
      if (editId) openDialog(state.groups.find(group => group.id === editId));
      const deleteId = event.target.closest("[data-delete-generational-group]")?.dataset.deleteGenerationalGroup;
      if (deleteId) remove(deleteId);
    });
  }

  function getGroups() {
    return sortedGroups().map(group => ({ ...group }));
  }

  function getStatus() {
    return state.loadStatus;
  }

  function initialize(context) {
    state.client = context.client;
    state.permissions = context.permissions || [];
    state.onChange = context.onChange || null;
    bindEvents();
    state.loadStatus = "loading";
    render();
    return load();
  }

  window.GenerationalGroups = {
    initialize,
    load,
    classify,
    calculateAge,
    formatAgeRange,
    getGroups,
    getStatus
  };
})();
