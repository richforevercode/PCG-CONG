(function () {
  "use strict";

  const form = document.getElementById("signinForm");
  const alertBox = document.getElementById("signinAlert");
  const button = document.getElementById("signinButton");
  const passwordInput = document.getElementById("signinPassword");
  const togglePassword = document.getElementById("togglePassword");
  const mfaPanel = document.getElementById("signinMfa");
  const mfaForm = document.getElementById("signinMfaForm");
  const mfaButton = document.getElementById("signinMfaButton");
  const mfaEnrollment = document.getElementById("signinMfaEnrollment");
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
  let pendingProfile = null;
  let pendingFactorId = "";
  let enrollingFactor = false;

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

  async function auditSecurityEvent(action) {
    try { await client.rpc("record_own_security_event", { event_action: action, event_metadata: {} }); }
    catch (_) {}
  }

  function showMfaPanel(enrolling) {
    form.hidden = true;
    mfaPanel.hidden = false;
    mfaEnrollment.hidden = !enrolling;
    document.getElementById("signinMfaTitle").textContent = enrolling ? "Secure your administrator account" : "Verify your identity";
    document.getElementById("signinMfaDescription").textContent = enrolling
      ? "Administrator access requires an authenticator app. Complete this one-time setup to continue."
      : "Enter the six-digit code from your authenticator app.";
    mfaForm.elements.code.value = "";
    setTimeout(() => mfaForm.elements.code.focus(), 50);
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  }

  async function requireAdministratorMfa(profile) {
    const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.currentLevel === "aal2") { location.replace(routeFor(profile)); return; }

    pendingProfile = profile;
    const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = (factors.totp || []).find(factor => factor.status === "verified");
    if (verified) {
      pendingFactorId = verified.id;
      enrollingFactor = false;
      showMfaPanel(false);
      return;
    }

    const abandonedTotpFactors = (factors.all || []).filter(
      factor => factor.factor_type === "totp" && factor.status !== "verified"
    );
    for (const factor of abandonedTotpFactors) {
      try { await client.auth.mfa.unenroll({ factorId: factor.id }); } catch (_) {}
    }
    const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Resurrection Admin" });
    if (enrollmentError) throw enrollmentError;
    pendingFactorId = enrollment.id;
    enrollingFactor = true;
    document.getElementById("signinMfaQr").src = enrollment.totp.qr_code;
    document.getElementById("signinMfaSecret").textContent = enrollment.totp.secret;
    showMfaPanel(true);
  }

  async function completeAccess(profile) {
    if (roleOf(profile)?.name === "Member") { location.replace(routeFor(profile)); return; }
    await requireAdministratorMfa(profile);
  }

  async function initialize() {
    document.getElementById("signinYear").textContent = new Date().getFullYear();
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
    const reason = new URLSearchParams(location.search).get("reason");
    if (reason === "inactive") showError("This account is inactive. Contact a Super Administrator for access.");
    if (reason === "session") showError("Your session ended. Please sign in again.");
    if (reason === "mfa") showError("Complete multi-factor authentication to open the administrator dashboard.");
    if (!client) return showError("The Supabase connection has not been configured.");
    const { data } = await client.auth.getSession();
    if (data.session?.user) {
      try {
        const profile = await verifyAccess(data.session.user.id);
        await completeAccess(profile);
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
      await completeAccess(profile);
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

  mfaForm.addEventListener("submit", async event => {
    event.preventDefault();
    alertBox.hidden = true;
    if (!pendingFactorId || !pendingProfile || !mfaForm.reportValidity()) return;
    mfaButton.disabled = true;
    try {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: pendingFactorId, code: mfaForm.elements.code.value.trim() });
      if (error) throw error;
      await auditSecurityEvent(enrollingFactor ? "mfa.enrolled" : "mfa.verified");
      location.replace(routeFor(pendingProfile));
    } catch (error) {
      showError(/invalid|expired|verification/i.test(error.message) ? "The security code is invalid or expired. Try the current code from your authenticator app." : error.message);
      mfaForm.elements.code.select();
    } finally {
      mfaButton.disabled = false;
    }
  });

  document.getElementById("signinMfaCancel").addEventListener("click", async () => {
    await client.auth.signOut();
    location.replace("signin.html");
  });

  initialize();
})();
