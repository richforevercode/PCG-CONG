(function () {
  "use strict";

  const form = document.getElementById("signinForm");
  const alertBox = document.getElementById("signinAlert");
  const button = document.getElementById("signinButton");
  const passwordInput = document.getElementById("signinPassword");
  const togglePassword = document.getElementById("togglePassword");
  const config = window.PCG_SUPABASE || {};
  const client = config.url && config.anonKey && window.supabase
    ? window.supabase.createClient(config.url, config.anonKey)
    : null;

  const showError = message => {
    alertBox.querySelector("span").textContent = message;
    alertBox.hidden = false;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  };

  const dashboardUrl = () => new URL("index.html", window.location.href).href;
  const memberPortalUrl = () => new URL("member-portal.html", window.location.href).href;
  const roleOf = profile => Array.isArray(profile?.app_roles) ? profile.app_roles[0] : profile?.app_roles;

  async function verifyAccess(userId) {
    const { data, error } = await client
      .from("user_profiles")
      .select("status,member_id,app_roles(name,permissions)")
      .eq("id", userId)
      .single();
    if (error) throw new Error("Your administrator profile is not ready. Ask the Super Administrator to check your account.");
    if (data.status !== "active") throw new Error("This account is inactive. Contact a Super Administrator for access.");
    return data;
  }

  function routeFor(profile) {
    const role = roleOf(profile);
    if (role?.name === "Member") {
      if (!profile.member_id) throw new Error("This Member account is not linked to a church member record. Ask an administrator to link it.");
      return memberPortalUrl();
    }
    return dashboardUrl();
  }

  function completeAccess(profile) {
    location.replace(routeFor(profile));
  }

  async function initialize() {
    document.getElementById("signinYear").textContent = new Date().getFullYear();
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    const reason = new URLSearchParams(location.search).get("reason");
    if (reason === "inactive") showError("This account is inactive. Contact a Super Administrator for access.");
    if (reason === "session") showError("Your session ended. Please sign in again.");
    if (!client) return showError("The Supabase connection has not been configured.");
    const { data } = await client.auth.getSession();
    if (data.session?.user) {
      try {
        const profile = await verifyAccess(data.session.user.id);
        completeAccess(profile);
      } catch (_) {
        await client.auth.signOut();
      }
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    alertBox.hidden = true;
    if (!client) return showError("The Supabase connection has not been configured.");
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    button.querySelector("span").textContent = "Signing in...";
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: values.email.trim(), password: values.password });
      if (error) throw error;
      const profile = await verifyAccess(data.user.id);
      completeAccess(profile);
    } catch (error) {
      await client.auth.signOut();
      const message = /invalid login credentials/i.test(error.message)
        ? "The email or password is incorrect. Please try again."
        : error.message;
      showError(message);
      button.disabled = false;
      button.querySelector("span").textContent = "Sign in to dashboard";
    }
  });

  togglePassword.addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    togglePassword.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    togglePassword.innerHTML = `<i data-lucide="${showing ? "eye" : "eye-off"}"></i>`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    passwordInput.focus();
  });

  initialize();
})();
