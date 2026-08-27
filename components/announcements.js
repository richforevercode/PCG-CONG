(function () {
  "use strict";

  const state = { client: null, userId: null, permissions: [], items: [], initialized: false, bound: false };
  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const can = permission => state.permissions.includes(permission);
  const dateTime = value => value ? new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not published";

  function audienceLabel(item) {
    return item.audience_type === "All" ? "All members" : `${item.audience_type}: ${item.audience_group}`;
  }

  function render() {
    const root = $("#announcementsModuleRoot");
    if (!root) return;
    const filter = $("#announcementStatusFilter")?.value || "all";
    const items = state.items.filter(item => filter === "all" || item.status === filter);
    root.innerHTML = `<div class="page-heading">
      <div><p class="breadcrumb">Home <i data-lucide="chevron-right"></i> Communications</p><h2>Announcements</h2><p>Publish congregation-wide or targeted notices to the secure Member Portal.</p></div>
      ${can("announcements.manage") ? '<button class="primary-btn" data-add-announcement><i data-lucide="megaphone"></i> New announcement</button>' : ""}
    </div>
    <article class="card table-card announcement-admin-card">
      <div class="table-toolbar"><div><strong>${state.items.length} announcement${state.items.length === 1 ? "" : "s"}</strong><small class="announcement-toolbar-note">Drafts remain invisible to members.</small></div>
        <select id="announcementStatusFilter" aria-label="Filter announcements"><option value="all">All statuses</option>${["Draft", "Published", "Archived"].map(status => `<option ${filter === status ? "selected" : ""}>${status}</option>`).join("")}</select>
      </div>
      <div class="announcement-admin-list">${items.length ? items.map(item => `<article class="announcement-admin-item">
        <div class="announcement-admin-copy"><div class="announcement-admin-meta"><span class="status-pill ${item.status === "Published" ? "active" : item.status === "Archived" ? "inactive" : "neutral"}">${esc(item.status)}</span><span class="announcement-priority ${item.priority.toLowerCase()}">${esc(item.priority)}</span><span>${esc(audienceLabel(item))}</span></div>
          <h3>${esc(item.title)}</h3><p>${esc(item.content)}</p><small>${item.status === "Published" ? `Published ${esc(dateTime(item.published_at))}` : `Updated ${esc(dateTime(item.updated_at))}`}</small>
        </div>
        ${can("announcements.manage") ? `<div class="row-actions"><button class="icon-btn" data-edit-announcement="${item.id}" aria-label="Edit ${esc(item.title)}"><i data-lucide="pencil"></i></button><button class="icon-btn delete" data-delete-announcement="${item.id}" aria-label="Delete ${esc(item.title)}"><i data-lucide="trash-2"></i></button></div>` : ""}
      </article>`).join("") : '<div class="empty-state"><i data-lucide="megaphone-off"></i><br>No announcements match this filter.</div>'}</div>
    </article>`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  }

  function open(item = null) {
    const form = $("#announcementForm");
    form.reset();
    form.elements.announcement_id.value = item?.id || "";
    form.elements.title.value = item?.title || "";
    form.elements.content.value = item?.content || "";
    form.elements.priority.value = item?.priority || "Normal";
    form.elements.audience_type.value = item?.audience_type || "All";
    form.elements.audience_group.value = item?.audience_group || "";
    form.elements.attachment_url.value = item?.attachment_url || "";
    form.elements.status.value = item?.status || "Draft";
    $("#announcementDialogTitle").textContent = item ? "Edit announcement" : "Create announcement";
    $("#saveAnnouncementBtn").textContent = item ? "Save changes" : "Create announcement";
    updateAudienceField();
    $("#announcementDialog").showModal();
    setTimeout(() => form.elements.title.focus(), 50);
  }

  function updateAudienceField() {
    const form = $("#announcementForm");
    const targeted = form.elements.audience_type.value !== "All";
    const field = $("#announcementAudienceGroupField");
    field.hidden = !targeted;
    form.elements.audience_group.required = targeted;
    if (!targeted) form.elements.audience_group.value = "";
  }

  async function load() {
    const { data, error } = await state.client.from("announcements").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    state.items = data || [];
    render();
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const id = values.announcement_id;
    delete values.announcement_id;
    if (values.audience_type !== "All" && !values.audience_group.trim()) return window.alert("Enter the target fellowship or generational group.");
    if (values.audience_type === "All") values.audience_group = null;
    const button = $("#saveAnnouncementBtn");
    button.disabled = true;
    try {
      const query = id ? state.client.from("announcements").update(values).eq("id", id) : state.client.from("announcements").insert(values);
      const { error } = await query;
      if (error) throw error;
      $("#announcementDialog").close();
      await load();
    } catch (error) {
      window.alert(error.message || "Unable to save the announcement.");
    } finally {
      button.disabled = false;
    }
  }

  async function remove(id) {
    const item = state.items.find(record => record.id === id);
    if (!item || !window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    const { error } = await state.client.from("announcements").delete().eq("id", id);
    if (error) return window.alert(error.message || "Unable to delete the announcement.");
    await load();
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    document.addEventListener("click", event => {
      if (event.target.closest("[data-add-announcement]")) open();
      const editId = event.target.closest("[data-edit-announcement]")?.dataset.editAnnouncement;
      if (editId) open(state.items.find(item => item.id === editId));
      const deleteId = event.target.closest("[data-delete-announcement]")?.dataset.deleteAnnouncement;
      if (deleteId) remove(deleteId);
    });
    document.addEventListener("change", event => {
      if (event.target.id === "announcementStatusFilter") render();
      if (event.target.matches('#announcementForm [name="audience_type"]')) updateAudienceField();
    });
    $("#announcementForm")?.addEventListener("submit", save);
    document.querySelectorAll("[data-close-announcement-dialog]").forEach(button => button.addEventListener("click", () => $("#announcementDialog").close()));
  }

  async function initialize({ client, userId, permissions }) {
    state.client = client;
    state.userId = userId;
    state.permissions = permissions || [];
    bind();
    await load();
    state.initialized = true;
  }

  window.AnnouncementsModule = { initialize, render };
})();
