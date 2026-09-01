(function () {
  "use strict";

  const state = { client: null, userId: null, permissions: [], history: null, milestones: [], bound: false };
  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const defaultHistory = { id: 1, title: "Our Story", subtitle: "The journey of Resurrection Congregation", founding_date: "", founding_members: "", summary: "", story: "", hero_image_url: "", hero_image_caption: "", is_published: false };
  const year = value => Number(value || new Date().getFullYear());

  function imageUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:" ? parsed.href : "";
    } catch (_) {
      return "";
    }
  }

  function displayDate(value) {
    if (!value) return "Date not specified";
    return new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
  }

  function historyPreview(history) {
    const hero = imageUrl(history.hero_image_url);
    return `<article class="history-preview ${history.is_published ? "published" : "draft"}">
      ${hero ? `<figure class="history-preview-image"><img src="${esc(hero)}" alt="${esc(history.hero_image_caption || history.title)}" /><figcaption>${esc(history.hero_image_caption)}</figcaption></figure>` : `<div class="history-preview-mark"><img src="assets/pcg-crest.png" alt="" /><span>Resurrection Congregation</span></div>`}
      <div class="history-preview-copy"><div class="history-preview-status"><span class="status-pill ${history.is_published ? "active" : "neutral"}">${history.is_published ? "Published" : "Draft"}</span>${history.founding_date ? `<span>Established ${esc(displayDate(history.founding_date))}</span>` : ""}</div>
        <p class="eyebrow">CONGREGATION HERITAGE</p><h3>${esc(history.title || "Our Story")}</h3><strong>${esc(history.subtitle)}</strong><p>${esc(history.summary || "Add a concise introduction to the congregation's story.")}</p>
      </div>
    </article>`;
  }

  function historyForm(history) {
    if (!can("history.manage")) {
      return `<article class="card history-story-card"><div class="card-heading"><div><p class="eyebrow">HISTORICAL RECORD</p><h3>${esc(history.title)}</h3></div></div><div class="history-story-copy"><p>${esc(history.story || "No detailed history has been recorded yet.")}</p>${history.founding_members ? `<aside><strong>Founding members</strong><span>${esc(history.founding_members)}</span></aside>` : ""}</div></article>`;
    }
    return `<article class="card history-editor-card"><div class="card-heading"><div><p class="eyebrow">STORY &amp; IDENTITY</p><h3>History page details</h3><p>Draft changes stay hidden from members until this page is published.</p></div></div>
      <form id="churchHistoryForm" class="history-form">
        <label>Page title<input name="title" maxlength="120" required value="${esc(history.title)}" placeholder="Our Story" /></label>
        <label>Subtitle<input name="subtitle" maxlength="240" value="${esc(history.subtitle)}" placeholder="The journey of Resurrection Congregation" /></label>
        <label>Founding date<input name="founding_date" type="date" value="${esc(history.founding_date || "")}" /></label>
        <label class="full">Founding members<textarea name="founding_members" maxlength="2000" rows="3" placeholder="Record the known founding members or founding group.">${esc(history.founding_members)}</textarea></label>
        <label class="full">Short introduction<textarea name="summary" maxlength="2000" rows="4" placeholder="A concise overview displayed at the top of the history page.">${esc(history.summary)}</textarea></label>
        <label class="full">Full history<textarea name="story" maxlength="20000" rows="12" placeholder="Tell the congregation's story from its beginnings to the present day.">${esc(history.story)}</textarea></label>
        <label class="full">Hero photograph URL<input name="hero_image_url" type="url" maxlength="1000" value="${esc(history.hero_image_url)}" placeholder="https://..." /><small>Use a secure HTTPS image URL. Add milestone photographs separately below.</small></label>
        <label class="full">Hero photograph caption<input name="hero_image_caption" maxlength="240" value="${esc(history.hero_image_caption)}" placeholder="Describe the photograph, people, place, or approximate year." /></label>
        <label class="history-publish-toggle full"><input name="is_published" type="checkbox" ${history.is_published ? "checked" : ""} /><span><strong>Publish to the Member Portal</strong><small>Members will see this story and only milestones marked as published.</small></span></label>
        <div class="history-form-actions full"><button class="primary-btn" id="saveChurchHistory" type="submit"><i data-lucide="save"></i> Save history</button></div>
      </form>
    </article>`;
  }

  function milestoneMarkup(item) {
    const photo = imageUrl(item.image_url);
    return `<article class="history-milestone ${item.is_published ? "" : "is-draft"}">
      <div class="history-milestone-year"><strong>${esc(item.event_year)}</strong>${item.event_date ? `<span>${esc(displayDate(item.event_date))}</span>` : ""}</div>
      ${photo ? `<figure><img src="${esc(photo)}" alt="${esc(item.image_caption || item.title)}" /><figcaption>${esc(item.image_caption)}</figcaption></figure>` : ""}
      <div class="history-milestone-copy"><div><span class="status-pill ${item.is_published ? "active" : "neutral"}">${item.is_published ? "Published" : "Draft"}</span></div><h4>${esc(item.title)}</h4><p>${esc(item.description)}</p></div>
      ${can("history.manage") ? `<div class="row-actions"><button class="icon-btn" type="button" data-edit-history-milestone="${item.id}" aria-label="Edit ${esc(item.title)}"><i data-lucide="pencil"></i></button><button class="icon-btn delete" type="button" data-delete-history-milestone="${item.id}" aria-label="Delete ${esc(item.title)}"><i data-lucide="trash-2"></i></button></div>` : ""}
    </article>`;
  }

  function render() {
    const root = $("#churchHistoryModuleRoot");
    if (!root) return;
    const history = state.history || defaultHistory;
    root.innerHTML = `<div class="page-heading"><div><p class="breadcrumb">Home <i data-lucide="chevron-right"></i> Congregation</p><h2>Church History</h2><p>Preserve the story, people, photographs, and milestones that shaped Resurrection Congregation.</p></div>${can("history.manage") ? '<button class="primary-btn" type="button" data-add-history-milestone><i data-lucide="milestone"></i> Add milestone</button>' : ""}</div>
      ${historyPreview(history)}
      <div class="history-admin-layout">${historyForm(history)}
        <article class="card history-timeline-card"><div class="card-heading"><div><p class="eyebrow">MILESTONE TIMELINE</p><h3>Significant moments</h3><p>${state.milestones.length} milestone${state.milestones.length === 1 ? "" : "s"} recorded in chronological order.</p></div>${can("history.manage") ? '<button class="secondary-btn" type="button" data-add-history-milestone><i data-lucide="plus"></i> Add</button>' : ""}</div>
          <div class="history-milestone-list">${state.milestones.length ? state.milestones.map(milestoneMarkup).join("") : '<div class="empty-state"><i data-lucide="landmark"></i><br>No historical milestones have been recorded yet.</div>'}</div>
        </article>
      </div>`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    $("#churchHistoryForm")?.addEventListener("submit", saveHistory);
  }

  async function load() {
    const [historyResult, milestonesResult] = await Promise.all([
      state.client.from("church_history").select("*").eq("id", 1).maybeSingle(),
      state.client.from("church_history_milestones").select("*").order("display_order").order("event_year").order("event_date")
    ]);
    if (historyResult.error) throw historyResult.error;
    if (milestonesResult.error) throw milestonesResult.error;
    state.history = historyResult.data || null;
    state.milestones = milestonesResult.data || [];
    render();
  }

  async function saveHistory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.hero_image_url.trim() && !imageUrl(values.hero_image_url.trim())) return notify("Use a secure HTTPS URL for the hero photograph.", "error");
    const payload = { id: 1, title: values.title.trim(), subtitle: values.subtitle.trim(), founding_date: values.founding_date || null, founding_members: values.founding_members.trim(), summary: values.summary.trim(), story: values.story.trim(), hero_image_url: values.hero_image_url.trim(), hero_image_caption: values.hero_image_caption.trim(), is_published: form.elements.is_published.checked };
    const button = $("#saveChurchHistory");
    button.disabled = true;
    try {
      const { error } = await state.client.from("church_history").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      await load();
      notify(payload.is_published ? "Church history saved and published." : "Church history saved as a draft.");
    } catch (error) {
      notify(error.message || "Unable to save the church history.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function openMilestone(item = null) {
    const form = $("#historyMilestoneForm");
    form.reset();
    form.elements.milestone_id.value = item?.id || "";
    form.elements.event_year.value = item?.event_year || year();
    form.elements.event_date.value = item?.event_date || "";
    form.elements.title.value = item?.title || "";
    form.elements.description.value = item?.description || "";
    form.elements.image_url.value = item?.image_url || "";
    form.elements.image_caption.value = item?.image_caption || "";
    form.elements.display_order.value = item?.display_order ?? state.milestones.length;
    form.elements.is_published.checked = item?.is_published ?? true;
    $("#historyMilestoneDialogTitle").textContent = item ? "Edit historical milestone" : "Add historical milestone";
    $("#saveHistoryMilestone").textContent = item ? "Save changes" : "Add milestone";
    $("#historyMilestoneDialog").showModal();
    setTimeout(() => form.elements.title.focus(), 50);
  }

  async function saveMilestone(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const id = values.milestone_id;
    if (values.image_url.trim() && !imageUrl(values.image_url.trim())) return notify("Use a secure HTTPS URL for the milestone photograph.", "error");
    if (values.event_date && values.event_date.slice(0, 4) !== values.event_year) return notify("The milestone year must match the exact date.", "error");
    const payload = { event_year: Number(values.event_year), event_date: values.event_date || null, title: values.title.trim(), description: values.description.trim(), image_url: values.image_url.trim(), image_caption: values.image_caption.trim(), display_order: Number(values.display_order || 0), is_published: form.elements.is_published.checked };
    const button = $("#saveHistoryMilestone");
    button.disabled = true;
    try {
      const query = id ? state.client.from("church_history_milestones").update(payload).eq("id", id) : state.client.from("church_history_milestones").insert(payload);
      const { error } = await query;
      if (error) throw error;
      $("#historyMilestoneDialog").close();
      await load();
      notify(id ? "Historical milestone updated." : "Historical milestone added.");
    } catch (error) {
      notify(error.message || "Unable to save the milestone.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function removeMilestone(id) {
    const item = state.milestones.find(record => record.id === id);
    if (!item || !window.confirm(`Delete “${item.title}”? This historical entry cannot be recovered.`)) return;
    const { error } = await state.client.from("church_history_milestones").delete().eq("id", id);
    if (error) return notify(error.message || "Unable to delete the milestone.", "error");
    await load();
    notify("Historical milestone deleted.");
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    document.addEventListener("click", event => {
      if (event.target.closest("[data-add-history-milestone]")) openMilestone();
      const editId = event.target.closest("[data-edit-history-milestone]")?.dataset.editHistoryMilestone;
      if (editId) openMilestone(state.milestones.find(item => item.id === editId));
      const deleteId = event.target.closest("[data-delete-history-milestone]")?.dataset.deleteHistoryMilestone;
      if (deleteId) removeMilestone(deleteId);
    });
    $("#historyMilestoneForm")?.addEventListener("submit", saveMilestone);
    document.querySelectorAll("[data-close-history-milestone-dialog]").forEach(button => button.addEventListener("click", () => $("#historyMilestoneDialog").close()));
  }

  async function initialize({ client, userId, permissions }) {
    state.client = client;
    state.userId = userId;
    state.permissions = permissions || [];
    bind();
    await load();
  }

  window.ChurchHistoryModule = { initialize, render };
})();
