(function () {
  "use strict";

  const permissionGroups = [
    { name: "General", items: [
      ["dashboard.view", "View dashboard", "See congregation summaries and recent activity."],
      ["reports.view", "View reports", "Open membership and financial reports."]
    ]},
    { name: "Church records", items: [
      ["members.view", "View membership", "Read member records and contact details."],
      ["members.manage", "Manage membership", "Add, edit, and remove member records."],
      ["events.view", "View events", "See programmes and calendar entries."],
      ["events.manage", "Manage events", "Create and update church programmes."],
      ["attendance.view", "View attendance", "See service attendance records."],
      ["attendance.manage", "Manage attendance", "Record and update service attendance."]
    ]},
    { name: "Finance", items: [
      ["finance.view", "View finance", "Read transactions, balances, and giving reports."],
      ["finance.manage", "Manage finance", "Create and remove financial transactions."]
    ]},
    { name: "Administration", items: [
      ["settings.manage", "Manage settings", "Update congregation and connection settings."],
      ["users.manage", "Manage users", "Create accounts and allocate ordinary roles."],
      ["roles.manage", "Manage roles", "Create roles and assign Super Administrator access."]
    ]}
  ];

  const state = { client: null, userId: null, permissions: [], users: [], roles: [] };
  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const initials = name => String(name || "User").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const roleFor = user => Array.isArray(user.app_roles) ? user.app_roles[0] : user.app_roles;

  function roleOptions(selected = "") {
    return state.roles
      .filter(role => can("roles.manage") || !role.permissions.includes("roles.manage"))
      .map(role => `<option value="${role.id}" ${role.id === selected ? "selected" : ""}>${esc(role.name)}</option>`)
      .join("");
  }

  function renderMetrics() {
    const active = state.users.filter(user => user.status === "active").length;
    $("#userMetrics").innerHTML = [
      [state.users.length, "Administrator accounts", "users", "#0a3995"],
      [active, "Active access", "badge-check", "#087a38"],
      [state.roles.length, "Available roles", "shield-check", "#b54708"]
    ].map(([value, label, icon, color]) => `<article class="user-metric"><span class="user-metric-icon" style="--metric-color:${color}"><i data-lucide="${icon}"></i></span><div><strong>${value}</strong><span>${label}</span></div></article>`).join("");
  }

  function renderFilters() {
    const currentValue = $("#userRoleFilter").value || "all";
    $("#userRoleFilter").innerHTML = `<option value="all">All roles</option>${state.roles.map(role => `<option value="${role.id}" ${currentValue === role.id ? "selected" : ""}>${esc(role.name)}</option>`).join("")}`;
  }

  function renderUsers() {
    const query = $("#userSearch").value.trim().toLowerCase();
    const roleId = $("#userRoleFilter").value;
    const status = $("#userStatusFilter").value;
    const users = state.users.filter(user => {
      const role = roleFor(user);
      return (!query || `${user.display_name} ${user.email} ${role?.name || ""}`.toLowerCase().includes(query))
        && (roleId === "all" || user.role_id === roleId)
        && (status === "all" || user.status === status);
    });
    $("#usersTable").innerHTML = users.length ? users.map(user => {
      const role = roleFor(user);
      const isCurrent = user.id === state.userId;
      const manageable = can("roles.manage") || !role?.permissions?.includes("roles.manage");
      const deleteAction = can("roles.manage") && !isCurrent ? `<button class="icon-btn delete" data-delete-user="${user.id}" aria-label="Delete ${esc(user.display_name)}"><i data-lucide="trash-2"></i></button>` : "";
      const actions = manageable ? `<div class="row-actions"><button class="icon-btn" data-edit-user="${user.id}" aria-label="Edit ${esc(user.display_name)}"><i data-lucide="pencil"></i></button><button class="icon-btn" data-password-user="${user.id}" aria-label="Set password for ${esc(user.display_name)}"><i data-lucide="key-round"></i></button>${deleteAction}</div>` : `<span class="protected-account" title="Protected Super Administrator"><i data-lucide="lock-keyhole"></i></span>`;
      return `<tr><td><div class="member-cell"><span class="user-avatar">${esc(initials(user.display_name))}</span><div><strong>${esc(user.display_name || "Unnamed user")}${isCurrent ? '<span class="current-user-label">You</span>' : ""}</strong><small>${esc(user.email)}</small></div></div></td><td><span class="role-name">${esc(role?.name || "No role")}</span></td><td><span class="status-pill ${user.status}">${user.status === "active" ? "Active" : "Inactive"}</span></td><td>${new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(user.created_at))}</td><td>${actions}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="users-empty"><i data-lucide="user-round-search"></i><strong>No administrators found</strong><span>Try changing the search or filter.</span></td></tr>`;
    $("#userTableCount").textContent = `Showing ${users.length} of ${state.users.length} administrator${state.users.length === 1 ? "" : "s"}`;
    refreshIcons();
  }

  function renderRoles() {
    $("#rolesList").innerHTML = state.roles.map(role => {
      const userCount = state.users.filter(user => user.role_id === role.id).length;
      const actions = role.is_system || !can("roles.manage")
        ? `<span class="role-system">${role.is_system ? "System" : "Custom"}</span>`
        : `<div class="role-actions"><button class="icon-btn" data-edit-role="${role.id}" aria-label="Edit ${esc(role.name)}"><i data-lucide="pencil"></i></button><button class="icon-btn delete" data-delete-role="${role.id}" aria-label="Delete ${esc(role.name)}"><i data-lucide="trash-2"></i></button></div>`;
      return `<div class="role-item"><span class="role-icon"><i data-lucide="shield"></i></span><div><strong>${esc(role.name)}</strong><small>${userCount} user${userCount === 1 ? "" : "s"} · ${role.permissions.length} permissions</small></div>${actions}</div>`;
    }).join("");
    refreshIcons();
  }

  function render() {
    renderMetrics();
    renderFilters();
    renderUsers();
    renderRoles();
  }

  async function load() {
    if (!state.client || !can("users.manage")) return;
    const [usersResult, rolesResult] = await Promise.all([
      state.client.from("user_profiles").select("id,email,display_name,phone,status,created_at,role_id,app_roles(id,name,permissions)").order("created_at", { ascending: true }),
      state.client.from("app_roles").select("id,name,description,permissions,is_system,created_at").order("is_system", { ascending: false }).order("name")
    ]);
    if (usersResult.error || rolesResult.error) {
      notify(usersResult.error?.message || rolesResult.error?.message || "Unable to load users.", "error");
      return;
    }
    state.users = usersResult.data || [];
    state.roles = rolesResult.data || [];
    render();
  }

  async function invoke(body) {
    const { data, error } = await state.client.functions.invoke("manage-users", { body });
    if (error) {
      let message = error.message;
      try {
        const context = await error.context?.json();
        message = context?.error || message;
      } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function openUserDialog(user = null) {
    const form = $("#userForm");
    form.reset();
    form.elements.user_id.value = user?.id || "";
    form.elements.display_name.value = user?.display_name || "";
    form.elements.email.value = user?.email || "";
    form.elements.phone.value = user?.phone || "";
    form.elements.role_id.innerHTML = roleOptions(user?.role_id || "");
    form.elements.status.value = user?.status || "active";
    form.elements.email.disabled = Boolean(user);
    form.elements.password.required = !user;
    form.elements.password.type = "password";
    $(".create-password-field").hidden = Boolean(user);
    $(".edit-status-field").hidden = !user;
    form.elements.status.querySelector('[value="inactive"]').disabled = user?.id === state.userId;
    $("#userDialogEyebrow").textContent = user ? "ACCOUNT ACCESS" : "NEW ACCOUNT";
    $("#userDialogTitle").textContent = user ? "Edit administrator" : "Add administrator";
    $("#saveUserBtn").textContent = user ? "Save changes" : "Create account";
    $("#userDialog").showModal();
    setTimeout(() => form.elements.display_name.focus(), 50);
  }

  function permissionMarkup(selected = []) {
    return permissionGroups.map(group => `<section class="permission-group"><strong>${esc(group.name)}</strong><div class="permission-list">${group.items.map(([value, label, note]) => `<label class="permission-option"><input type="checkbox" name="permissions" value="${value}" ${selected.includes(value) ? "checked" : ""} /><span><strong>${esc(label)}</strong><small>${esc(note)}</small></span></label>`).join("")}</div></section>`).join("");
  }

  function openRoleDialog(role = null) {
    if (!can("roles.manage")) return notify("Only a Super Administrator can manage roles.", "error");
    const form = $("#roleForm");
    form.reset();
    form.elements.role_id.value = role?.id || "";
    form.elements.name.value = role?.name || "";
    form.elements.description.value = role?.description || "";
    $("#permissionOptions").innerHTML = permissionMarkup(role?.permissions || []);
    $("#roleDialogTitle").textContent = role ? "Edit role" : "Create role";
    $("#roleDialog").showModal();
    setTimeout(() => form.elements.name.focus(), 50);
  }

  async function saveUser(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const editing = Boolean(values.user_id);
    const button = $("#saveUserBtn");
    button.disabled = true;
    try {
      await invoke({ action: editing ? "update" : "create", ...values });
      $("#userDialog").close();
      notify(editing ? "Administrator access updated." : "Administrator account created.");
      await load();
    } catch (error) {
      notify(error.message || "Unable to save the administrator.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function saveRole(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const formData = new FormData(event.currentTarget);
    const roleId = formData.get("role_id");
    const payload = { name: formData.get("name").trim(), description: formData.get("description").trim(), permissions: formData.getAll("permissions"), is_system: false, updated_at: new Date().toISOString() };
    if (!payload.permissions.length) return notify("Select at least one permission for this role.", "error");
    const query = roleId ? state.client.from("app_roles").update(payload).eq("id", roleId) : state.client.from("app_roles").insert(payload);
    const { error } = await query;
    if (error) return notify(error.message, "error");
    $("#roleDialog").close();
    notify(roleId ? "Role updated." : "Role created.");
    await load();
  }

  async function deleteRole(roleId) {
    const role = state.roles.find(item => item.id === roleId);
    if (!role || role.is_system || !confirm(`Delete the ${role.name} role?`)) return;
    const { error } = await state.client.from("app_roles").delete().eq("id", roleId);
    if (error) return notify(error.code === "23503" ? "Move users out of this role before deleting it." : error.message, "error");
    notify("Role deleted.");
    await load();
  }

  async function deleteUser(userId) {
    const user = state.users.find(item => item.id === userId);
    if (!user || !can("roles.manage")) return;
    if (user.id === state.userId) return notify("You cannot delete your own account.", "error");
    if (!confirm(`Permanently delete ${user.display_name || user.email}? This will remove their sign-in access and cannot be undone.`)) return;
    try {
      await invoke({ action: "delete", user_id: user.id });
      notify("Administrator account deleted.");
      await load();
    } catch (error) {
      notify(error.message || "Unable to delete the administrator.", "error");
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await invoke({ action: "password", ...values });
      $("#passwordDialog").close();
      notify("Temporary password updated.");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function bindEvents() {
    $("#addUserBtn").addEventListener("click", () => openUserDialog());
    $("#addRoleBtn").addEventListener("click", () => openRoleDialog());
    $("#userSearch").addEventListener("input", renderUsers);
    $("#userRoleFilter").addEventListener("change", renderUsers);
    $("#userStatusFilter").addEventListener("change", renderUsers);
    $("#userForm").addEventListener("submit", saveUser);
    $("#roleForm").addEventListener("submit", saveRole);
    $("#passwordForm").addEventListener("submit", savePassword);
    $("#generatePassword").addEventListener("click", () => {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
      const bytes = crypto.getRandomValues(new Uint8Array(14));
      const password = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
      const input = $("#userForm [name=password]");
      input.type = "text";
      input.value = password;
      input.focus();
    });
    document.addEventListener("click", event => {
      const editUserId = event.target.closest("[data-edit-user]")?.dataset.editUser;
      if (editUserId) openUserDialog(state.users.find(user => user.id === editUserId));
      const passwordUserId = event.target.closest("[data-password-user]")?.dataset.passwordUser;
      if (passwordUserId) {
        $("#passwordForm").reset();
        $("#passwordForm [name=user_id]").value = passwordUserId;
        $("#passwordDialog").showModal();
      }
      const deleteUserId = event.target.closest("[data-delete-user]")?.dataset.deleteUser;
      if (deleteUserId) deleteUser(deleteUserId);
      const editRoleId = event.target.closest("[data-edit-role]")?.dataset.editRole;
      if (editRoleId) openRoleDialog(state.roles.find(role => role.id === editRoleId));
      const deleteRoleId = event.target.closest("[data-delete-role]")?.dataset.deleteRole;
      if (deleteRoleId) deleteRole(deleteRoleId);
    });
    document.querySelectorAll("[data-close-user-dialog]").forEach(button => button.addEventListener("click", () => $("#userDialog").close()));
    document.querySelectorAll("[data-close-role-dialog]").forEach(button => button.addEventListener("click", () => $("#roleDialog").close()));
    document.querySelectorAll("[data-close-password-dialog]").forEach(button => button.addEventListener("click", () => $("#passwordDialog").close()));
  }

  function initialize(context) {
    state.client = context.client;
    state.userId = context.userId;
    state.permissions = context.permissions || [];
    bindEvents();
    if (can("users.manage")) load();
  }

  window.UserManagement = { initialize, load };
})();
