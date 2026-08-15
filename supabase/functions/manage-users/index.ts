import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is incomplete." }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is no longer valid." }, 401);

    const { data: caller, error: callerError } = await admin
      .from("user_profiles")
      .select("id,status,app_roles(name,permissions)")
      .eq("id", authData.user.id)
      .single();
    const callerRole = Array.isArray(caller?.app_roles) ? caller?.app_roles[0] : caller?.app_roles;
    const callerPermissions: string[] = callerRole?.permissions || [];
    if (callerError || caller?.status !== "active" || !callerPermissions.includes("users.manage")) {
      return json({ error: "You do not have permission to manage users." }, 403);
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

    if (action === "create") {
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      const displayName = String(payload.display_name || "").trim();
      const phone = String(payload.phone || "").trim();
      const roleId = String(payload.role_id || "");
      if (!email || !displayName || !roleId || password.length < 8) {
        return json({ error: "Name, email, role, and a password of at least 8 characters are required." }, 400);
      }

      const { data: targetRole, error: roleError } = await admin
        .from("app_roles")
        .select("id,name,permissions")
        .eq("id", roleId)
        .single();
      if (roleError || !targetRole) return json({ error: "The selected role does not exist." }, 400);
      if (targetRole.permissions.includes("roles.manage") && !callerPermissions.includes("roles.manage")) {
        return json({ error: "Only a Super Administrator can assign that role." }, 403);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, phone },
      });
      if (createError || !created.user) return json({ error: createError?.message || "Unable to create the user." }, 400);

      const { error: profileError } = await admin.from("user_profiles").upsert({
        id: created.user.id,
        email,
        display_name: displayName,
        phone,
        role_id: roleId,
        status: "active",
        updated_at: new Date().toISOString(),
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: profileError.message }, 400);
      }
      return json({ user: { id: created.user.id, email, display_name: displayName } }, 201);
    }

    if (action === "update") {
      const userId = String(payload.user_id || "");
      const roleId = String(payload.role_id || "");
      const status = payload.status === "inactive" ? "inactive" : "active";
      const displayName = String(payload.display_name || "").trim();
      const phone = String(payload.phone || "").trim();
      if (!userId || !roleId || !displayName) return json({ error: "User, name, and role are required." }, 400);

      const { target: existingTarget, isPrivileged } = await protectPrivilegedTarget(userId);

      const { data: targetRole, error: roleError } = await admin
        .from("app_roles")
        .select("permissions")
        .eq("id", roleId)
        .single();
      if (roleError || !targetRole) return json({ error: "The selected role does not exist." }, 400);
      if (targetRole.permissions.includes("roles.manage") && !callerPermissions.includes("roles.manage")) {
        return json({ error: "Only a Super Administrator can assign that role." }, 403);
      }
      if (userId === authData.user.id && status === "inactive") {
        return json({ error: "You cannot deactivate your own account." }, 400);
      }
      if (isPrivileged && existingTarget.status === "active" && (status === "inactive" || !targetRole.permissions.includes("roles.manage"))) {
        const { data: activeProfiles, error: activeProfilesError } = await admin
          .from("user_profiles")
          .select("id,app_roles(permissions)")
          .eq("status", "active");
        if (activeProfilesError) return json({ error: activeProfilesError.message }, 400);
        const privilegedCount = (activeProfiles || []).filter((profile) => {
          const profileRole = Array.isArray(profile.app_roles) ? profile.app_roles[0] : profile.app_roles;
          return (profileRole?.permissions || []).includes("roles.manage");
        }).length;
        if (privilegedCount <= 1) return json({ error: "At least one active Super Administrator must remain." }, 400);
      }

      const { error: profileError } = await admin.from("user_profiles").update({
        display_name: displayName,
        phone,
        role_id: roleId,
        status,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      if (profileError) return json({ error: profileError.message }, 400);
      return json({ success: true });
    }

    if (action === "password") {
      const userId = String(payload.user_id || "");
      const password = String(payload.password || "");
      if (!userId || password.length < 8) return json({ error: "Use a password of at least 8 characters." }, 400);
      await protectPrivilegedTarget(userId);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Unknown user-management action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
