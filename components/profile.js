(function () {
  "use strict";

  const mount = document.getElementById("profileMount");
  if (!mount) return;

  mount.innerHTML = `
    <button class="profile-trigger" id="profileBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="profilePanel">
      <span class="profile-avatar" id="profileAvatar">CA</span>
      <span class="profile-copy"><strong id="profileName">Church Admin</strong><small id="profileRole">Administrator</small></span>
      <i class="profile-chevron" data-lucide="chevron-down"></i>
    </button>`;

  document.body.insertAdjacentHTML("beforeend", `
    <div class="profile-panel" id="profilePanel" role="menu" hidden>
      <div class="profile-panel-head">
        <span class="profile-avatar profile-avatar-large" id="profileMenuAvatar">CA</span>
        <div><strong id="profileMenuName">Church Admin</strong><span id="profileMenuEmail">Not signed in</span></div>
      </div>
      <div class="profile-context">
        <span><i data-lucide="landmark"></i> Resurrection Congregation</span>
      </div>
      <div class="profile-menu-items">
        <button type="button" role="menuitem" data-profile-action="edit"><i data-lucide="user-round-pen"></i><span><strong>Edit profile</strong><small>Name, role and contact</small></span><i data-lucide="chevron-right"></i></button>
        <button type="button" role="menuitem" data-profile-action="settings"><i data-lucide="settings"></i><span><strong>System settings</strong><small>Church and database setup</small></span><i data-lucide="chevron-right"></i></button>
      </div>
      <button class="profile-signout" id="profileSignOut" type="button" role="menuitem"><i data-lucide="log-out"></i> Sign out</button>
    </div>`);

  const trigger = document.getElementById("profileBtn");
  const panel = document.getElementById("profilePanel");

  function close(options = {}) {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("open");
    if (options.restoreFocus) trigger.focus();
  }

  function open() {
    const notifications = document.getElementById("notificationPanel");
    if (notifications) notifications.hidden = true;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    trigger.classList.add("open");
    requestAnimationFrame(() => panel.querySelector("[role=menuitem]")?.focus());
  }

  function toggle() {
    panel.hidden ? open() : close();
  }

  function initials(name, email) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return String(email || "CA").slice(0, 2).toUpperCase();
  }

  function render(profile = {}) {
    const name = profile.name || "Church Admin";
    const role = profile.role || "Administrator";
    const email = profile.email || "Not signed in";
    const letters = initials(name, email);
    document.getElementById("profileAvatar").textContent = letters;
    document.getElementById("profileMenuAvatar").textContent = letters;
    document.getElementById("profileName").textContent = name;
    document.getElementById("profileRole").textContent = role;
    document.getElementById("profileMenuName").textContent = name;
    document.getElementById("profileMenuEmail").textContent = email;
    trigger.classList.toggle("live", profile.mode === "supabase");
    document.getElementById("profileSignOut").hidden = profile.mode !== "supabase";
  }

  trigger.addEventListener("click", event => { event.stopPropagation(); toggle(); });
  panel.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", () => close());
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden) close({ restoreFocus: true }); });
  panel.addEventListener("click", event => {
    const action = event.target.closest("[data-profile-action]")?.dataset.profileAction;
    if (!action) return;
    close();
    window.dispatchEvent(new CustomEvent(`pcg:profile-${action}`));
  });
  document.getElementById("profileSignOut").addEventListener("click", () => {
    close();
    window.dispatchEvent(new CustomEvent("pcg:profile-signout"));
  });

  render();
  window.ProfileController = { render, open, close };
})();
