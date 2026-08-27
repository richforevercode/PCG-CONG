(function () {
  "use strict";

  const form = document.getElementById("memberSigninForm");
  const alertBox = document.getElementById("memberSigninAlert");
  const button = document.getElementById("memberSigninButton");
  const passwordInput = document.getElementById("memberSigninPassword");
  const config = window.PCG_SUPABASE || {};
  const publicKey = config.anonKey || config.key;
  const client = config.url && publicKey && window.supabase ? window.supabase.createClient(config.url, publicKey) : null;
  const portalUrl = () => new URL("member-portal.html", location.href).href;
  const adminUrl = () => new URL("index.html", location.href).href;

  function icons() { window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } }); }
  function showError(message) { alertBox.querySelector("span").textContent = message; alertBox.hidden = false; icons(); }
  function roleOf(profile) { return Array.isArray(profile?.app_roles) ? profile.app_roles[0] : profile?.app_roles; }

  async function routeAuthenticatedUser(userId) {
    const { data, error } = await client.from("user_profiles").select("status,member_id,app_roles(name)").eq("id", userId).single();
    if (error) throw new Error("Your account profile is not ready. Ask a church administrator to check it.");
    if (data.status !== "active") throw new Error("This account is inactive. Contact a church administrator.");
    if (roleOf(data)?.name !== "Member") { location.replace(adminUrl()); return; }
    if (!data.member_id) throw new Error("This Member account is not linked to a church member record. Ask an administrator to link it.");
    location.replace(portalUrl());
  }

  async function initialize() {
    icons();
    const reason = new URLSearchParams(location.search).get("reason");
    if (reason === "inactive") showError("This account is inactive. Contact a church administrator.");
    if (reason === "session") showError("Your session ended. Please sign in again.");
    if (reason === "link") showError("Your account must be linked to your church member record before you can use the portal.");
    if (!client) return showError("The Supabase connection has not been configured.");
    const { data } = await client.auth.getSession();
    if (data.session?.user) {
      try { await routeAuthenticatedUser(data.session.user.id); }
      catch (error) { await client.auth.signOut(); showError(error.message); }
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault(); alertBox.hidden = true;
    if (!client) return showError("The Supabase connection has not been configured.");
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true; button.querySelector("span").textContent = "Signing in…";
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: values.email.trim(), password: values.password });
      if (error) throw error;
      await routeAuthenticatedUser(data.user.id);
    } catch (error) {
      await client.auth.signOut();
      showError(/invalid login credentials/i.test(error.message) ? "The email or password is incorrect." : error.message);
      button.disabled = false; button.querySelector("span").textContent = "Sign in to Member Portal";
    }
  });

  document.getElementById("memberTogglePassword").addEventListener("click", event => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    event.currentTarget.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    event.currentTarget.innerHTML = `<i data-lucide="${showing ? "eye" : "eye-off"}"></i>`;
    icons(); passwordInput.focus();
  });

  initialize();
})();
