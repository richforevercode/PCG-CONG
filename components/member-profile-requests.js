(function () {
  "use strict";
  const state = { client: null, permissions: [], requests: [], bound: false };
  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const fullName = member => `${member?.first_name || ""} ${member?.last_name || ""}`.trim() || "Unknown member";
  const formatDate = value => value ? new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";

  function render() {
    const root = $("#memberProfileRequestsRoot");
    if (!root) return;
    const pending = state.requests.filter(item => item.status === "Pending");
    root.innerHTML = `<article class="card member-request-card"><div class="card-heading"><div><p class="eyebrow">MEMBER PORTAL</p><h3>Profile correction requests</h3><p>Review protected-field changes submitted by linked members.</p></div><span class="status-pill ${pending.length ? "meeting" : "neutral"}">${pending.length} pending</span></div>
      ${state.requests.length ? `<div class="member-request-list">${state.requests.map(item => `<div class="member-request-item"><div><div class="member-request-meta"><strong>${esc(fullName(item.members))}</strong><span>${esc(item.members?.membership_number || "No membership number")}</span><span>${esc(formatDate(item.created_at))}</span></div><p>${esc(item.requested_changes?.requested_change || "Profile correction requested")}</p>${item.reason ? `<small>Reason: ${esc(item.reason)}</small>` : ""}${item.review_notes ? `<small>Review note: ${esc(item.review_notes)}</small>` : ""}</div><div class="member-request-actions"><span class="status-pill ${item.status === "Approved" ? "active" : item.status === "Declined" ? "inactive" : "neutral"}">${esc(item.status)}</span>${item.status === "Pending" ? `<button class="secondary-btn" data-review-member-request="${item.id}" data-review-status="Declined">Decline</button><button class="primary-btn" data-review-member-request="${item.id}" data-review-status="Approved">Approve</button>` : ""}</div></div>`).join("")}</div>` : '<div class="empty-state"><i data-lucide="file-check-2"></i><br>No member profile requests have been submitted.</div>'}
    </article>`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  }

  async function load() {
    const { data, error } = await state.client.from("member_profile_update_requests").select("id,member_id,requested_changes,reason,status,review_notes,created_at,reviewed_at,members(first_name,last_name,membership_number)").order("created_at", { ascending: false });
    if (error) throw error;
    state.requests = data || [];
    render();
  }

  async function review(id, status) {
    const guidance = status === "Approved" ? "Add an optional note. Approval records the decision; update the official member record separately if needed." : "Add an optional reason for declining this request.";
    const notes = window.prompt(guidance, "") ;
    if (notes === null) return;
    const { error } = await state.client.from("member_profile_update_requests").update({ status, review_notes: notes.trim() }).eq("id", id);
    if (error) return window.alert(error.message || "Unable to review this request.");
    await load();
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-review-member-request]");
      if (button) review(button.dataset.reviewMemberRequest, button.dataset.reviewStatus);
    });
  }

  async function initialize({ client, permissions }) {
    state.client = client;
    state.permissions = permissions || [];
    if (!state.permissions.includes("members.manage")) return;
    bind();
    await load();
  }

  window.MemberProfileRequests = { initialize, render };
})();
