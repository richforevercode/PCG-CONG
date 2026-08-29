import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  ...configuredOrigins,
]);

const corsHeaders = (origin: string | null) => ({
  ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const strongPassword = (password: string) => password.length >= 12
  && password.length <= 128
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password);

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
  if (Number(request.headers.get("Content-Length") || 0) > 32_768) return json({ error: "Request body is too large." }, 413, origin);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required." }, 401, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete." }, 500, origin);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is no longer valid." }, 401, origin);
    const audit = async (action: string, entityId: string, metadata: Record<string, unknown> = {}) => {
      const { error } = await admin.from("security_audit_log").insert({
        actor_id: authData.user.id,
        action,
        entity_type: "user_account",
        entity_id: entityId,
        metadata,
      });
      if (error) console.error("Security audit write failed", { action, entityId, error: error.message });
    };

    const { data: caller, error: callerError } = await admin
      .from("user_profiles")
      .select("id,status,app_roles(name,permissions)")
      .eq("id", authData.user.id)
      .single();
    const callerRole = Array.isArray(caller?.app_roles) ? caller?.app_roles[0] : caller?.app_roles;
    const callerPermissions: string[] = callerRole?.permissions || [];
    if (callerError || caller?.status !== "active" || !callerPermissions.includes("users.manage")) {
      return json({ error: "You do not have permission to manage users." }, 403, origin);
    }

    const payload = await request.json();
    const action = String(payload.action || "");

    const protectPrivilegedTarget = async (userId: string) => {
      const { data: target, error } = await admin
        .from("user_profiles")
        .select("status,app_roles(permissions)")
        .eq("id", userId)
        .single();
      if (error || !target) throw new Error("The selected administrator does not exist.");
      const targetRole = Array.isArray(target.app_roles) ? target.app_roles[0] : target.app_roles;
      const isPrivileged = (targetRole?.permissions || []).includes("roles.manage");
      if (isPrivileged && !callerPermissions.includes("roles.manage")) {
        throw new Error("Only a Super Administrator can change this account.");
      }
      return { target, isPrivileged };
    };

    const resolveMemberLink = async (roleName: string, rawMemberId: unknown, excludingUserId = "") => {
      const memberId = String(rawMemberId || "");
      if (roleName !== "Member") return null;
      if (!memberId) throw new Error("Select the existing church member for this Member Portal account.");
      const { data: member, error: memberError } = await admin
        .from("members")
        .select("id,status,first_name,last_name")
        .eq("id", memberId)
        .single();
      if (memberError || !member) throw new Error("The selected church member does not exist.");
      if (member.status !== "Active") throw new Error("Only an active church member can receive Member Portal access.");
      let linkedQuery = admin.from("user_profiles").select("id").eq("member_id", memberId);
      if (excludingUserId) linkedQuery = linkedQuery.neq("id", excludingUserId);
      const { data: linkedProfiles, error: linkedError } = await linkedQuery;
      if (linkedError) throw new Error(linkedError.message);
      if (linkedProfiles?.length) throw new Error("That church member already has a Member Portal account.");
      return memberId;
    };

    if (action === "create") {
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      const displayName = String(payload.display_name || "").trim();
      const phone = String(payload.phone || "").trim();
      const roleId = String(payload.role_id || "");
      if (!email || email.length > 254 || !displayName || displayName.length > 160 || phone.length > 50 || !roleId || !strongPassword(password)) {
        return json({ error: "A valid-length name, email, role, and a 12–128 character password with uppercase, lowercase, a number, and a symbol are required." }, 400, origin);
      }

      const { data: targetRole, error: roleError } = await admin
        .from("app_roles")
        .select("id,name,permissions")
        .eq("id", roleId)
        .single();
      if (roleError || !targetRole) return json({ error: "The selected role does not exist." }, 400, origin);
      if (targetRole.permissions.includes("roles.manage") && !callerPermissions.includes("roles.manage")) {
        return json({ error: "Only a Super Administrator can assign that role." }, 403, origin);
      }
      let memberId: string | null;
      try { memberId = await resolveMemberLink(targetRole.name, payload.member_id); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to link the member." }, 400, origin); }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, phone },
      });
      if (createError || !created.user) return json({ error: createError?.message || "Unable to create the user." }, 400, origin);

      const { error: profileError } = await admin.from("user_profiles").upsert({
        id: created.user.id,
        email,
        display_name: displayName,
        phone,
        role_id: roleId,
        member_id: memberId,
        status: "active",
        updated_at: new Date().toISOString(),
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: profileError.message }, 400, origin);
      }
      await audit("user.created", created.user.id, { email, display_name: displayName, role_id: roleId, member_id: memberId });
      return json({ user: { id: created.user.id, email, display_name: displayName } }, 201, origin);
    }

    if (action === "update") {
      const userId = String(payload.user_id || "");
      const roleId = String(payload.role_id || "");
      const status = payload.status === "inactive" ? "inactive" : "active";
      const displayName = String(payload.display_name || "").trim();
      const phone = String(payload.phone || "").trim();
      if (!userId || !roleId || !displayName || displayName.length > 160 || phone.length > 50) return json({ error: "A valid-length user, name, phone, and role are required." }, 400, origin);

      const { target: existingTarget, isPrivileged } = await protectPrivilegedTarget(userId);

      const { data: targetRole, error: roleError } = await admin
        .from("app_roles")
        .select("name,permissions")
        .eq("id", roleId)
        .single();
      if (roleError || !targetRole) return json({ error: "The selected role does not exist." }, 400, origin);
      if (targetRole.permissions.includes("roles.manage") && !callerPermissions.includes("roles.manage")) {
        return json({ error: "Only a Super Administrator can assign that role." }, 403, origin);
      }
      let memberId: string | null;
      try { memberId = await resolveMemberLink(targetRole.name, payload.member_id, userId); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to link the member." }, 400, origin); }
      if (userId === authData.user.id && status === "inactive") {
        return json({ error: "You cannot deactivate your own account." }, 400, origin);
      }
      if (isPrivileged && existingTarget.status === "active" && (status === "inactive" || !targetRole.permissions.includes("roles.manage"))) {
        const { data: activeProfiles, error: activeProfilesError } = await admin
          .from("user_profiles")
          .select("id,app_roles(permissions)")
          .eq("status", "active");
        if (activeProfilesError) return json({ error: activeProfilesError.message }, 400, origin);
        const privilegedCount = (activeProfiles || []).filter((profile) => {
          const profileRole = Array.isArray(profile.app_roles) ? profile.app_roles[0] : profile.app_roles;
          return (profileRole?.permissions || []).includes("roles.manage");
        }).length;
        if (privilegedCount <= 1) return json({ error: "At least one active Super Administrator must remain." }, 400, origin);
      }

      const { error: profileError } = await admin.from("user_profiles").update({
        display_name: displayName,
        phone,
        role_id: roleId,
        member_id: memberId,
        status,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      if (profileError) return json({ error: profileError.message }, 400, origin);
      await audit("user.updated", userId, { display_name: displayName, role_id: roleId, member_id: memberId, status });
      return json({ success: true }, 200, origin);
    }

    if (action === "delete") {
      const userId = String(payload.user_id || "");
      if (!userId) return json({ error: "A user is required." }, 400, origin);
      if (!callerPermissions.includes("roles.manage")) {
        return json({ error: "Only a Super Administrator can delete users." }, 403, origin);
      }
      if (userId === authData.user.id) {
        return json({ error: "You cannot delete your own account." }, 400, origin);
      }

      const { target, isPrivileged } = await protectPrivilegedTarget(userId);
      if (isPrivileged && target.status === "active") {
        const { data: activeProfiles, error: activeProfilesError } = await admin
          .from("user_profiles")
          .select("id,app_roles(permissions)")
          .eq("status", "active");
        if (activeProfilesError) return json({ error: activeProfilesError.message }, 400, origin);
        const privilegedCount = (activeProfiles || []).filter((profile) => {
          const profileRole = Array.isArray(profile.app_roles) ? profile.app_roles[0] : profile.app_roles;
          return (profileRole?.permissions || []).includes("roles.manage");
        }).length;
        if (privilegedCount <= 1) return json({ error: "At least one active Super Administrator must remain." }, 400, origin);
      }

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400, origin);
      await audit("user.deleted", userId);
      return json({ success: true }, 200, origin);
    }

    if (action === "password") {
      const userId = String(payload.user_id || "");
      const password = String(payload.password || "");
      if (!userId || !strongPassword(password)) return json({ error: "Use 12–128 characters with uppercase, lowercase, a number, and a symbol." }, 400, origin);
      await protectPrivilegedTarget(userId);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400, origin);
      await audit("password.admin_reset", userId);
      return json({ success: true }, 200, origin);
    }

    return json({ error: "Unknown user-management action." }, 400, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500, origin);
  }
});
