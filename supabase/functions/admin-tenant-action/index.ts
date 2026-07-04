import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action =
  | { action: "reset_password"; user_id?: string; tenant_id?: string; tenant_email?: string; new_password: string }
  | { action: "delete_tenant"; tenant_id: string }
  | { action: "restore_tenant"; tenant_id: string }
  | { action: "purge_tenant"; tenant_id: string; confirm: string }
  | { action: "suspend_tenant"; tenant_id: string }
  | { action: "activate_tenant"; tenant_id: string }
  | { action: "sync_auth_users" }
  | { action: "diagnose_login"; email: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const requestId = crypto.randomUUID();

  const sanitizePayload = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return payload;
    const copy = { ...(payload as Record<string, unknown>) };
    if (typeof copy.new_password === "string") {
      copy.new_password = `[redacted:${copy.new_password.length}]`;
    }
    return copy;
  };

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !anon || !service) {
      console.error("admin-tenant-action missing environment", {
        request_id: requestId,
        has_url: !!url,
        has_anon_key: !!anon,
        has_service_role_key: !!service,
      });
      return json({ success: false, error: "Server configuration error: password reset service credentials are missing.", request_id: requestId }, 500);
    }

    let body: Action;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("admin-tenant-action invalid JSON", { request_id: requestId, error: parseError instanceof Error ? parseError.message : String(parseError) });
      return json({ success: false, error: "Invalid request payload", request_id: requestId }, 400);
    }

    console.log("admin-tenant-action request", {
      request_id: requestId,
      action: body.action,
      payload: sanitizePayload(body),
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (!user) {
      console.error("admin-tenant-action auth failed", {
        request_id: requestId,
        action: body.action,
        auth_error: authError?.message ?? "No authenticated user",
        auth_status: (authError as any)?.status ?? null,
      });
      return json({ success: false, error: "Super Admin session expired or invalid. Please sign in again.", details: authError?.message ?? "No authenticated user", request_id: requestId }, 401);
    }

    const admin = createClient(url, service);
    console.log("admin-tenant-action authenticated actor", { request_id: requestId, actor_user_id: user.id, actor_email: user.email ?? null });
    const { data: roleRow, error: roleError } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (roleError) {
      console.error("admin-tenant-action role lookup failed", { request_id: requestId, actor_user_id: user.id, error: roleError });
      return json({ success: false, error: `Super Admin role lookup failed: ${roleError.message}`, request_id: requestId }, 500);
    }
    if (!roleRow) {
      console.error("admin-tenant-action forbidden", { request_id: requestId, actor_user_id: user.id, actor_email: user.email ?? null });
      return json({ success: false, error: "Forbidden — super admin only", request_id: requestId }, 403);
    }

    if (body.action === "reset_password") {
      let userId = (body.user_id ?? "").trim();
      const tenantId = (body.tenant_id ?? "").trim();
      const tenantEmail = (body.tenant_email ?? "").trim().toLowerCase();
      const newPassword = body.new_password ?? "";
      console.log("reset_password requested", { request_id: requestId, actor_user_id: user.id, actor_email: user.email ?? null, tenant_id: tenantId || null, tenant_email: tenantEmail || null, target_user_id: userId || null, password_len: newPassword.length });
      if (!newPassword || newPassword.length < 6) {
        return json({ success: false, error: "Password must be at least 6 characters", request_id: requestId }, 400);
      }

      if (tenantId) {
        const { data: link, error: linkError } = await admin
          .from("tenant_users")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (linkError) {
          console.error("reset_password tenant link lookup failed", { request_id: requestId, tenant_id: tenantId, error: linkError });
          return json({ success: false, error: `Tenant user lookup failed: ${linkError.message}`, request_id: requestId }, 400);
        }
        if (link?.user_id) {
          if (userId && userId !== link.user_id) {
            console.error("reset_password target mismatch", { request_id: requestId, tenant_id: tenantId, requested_user_id: userId, linked_user_id: link.user_id });
            return json({ success: false, error: "Target user does not match the selected tenant.", request_id: requestId }, 400);
          }
          userId = link.user_id;
        }
      }

      if (!userId && tenantEmail) {
        const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        console.log("reset_password auth user email lookup", { request_id: requestId, tenant_email: tenantEmail, list_error: listError?.message ?? null, total_users_checked: list?.users?.length ?? 0 });
        if (listError) {
          console.error("reset_password listUsers failed", { request_id: requestId, error: listError });
          return json({ success: false, error: `Auth user lookup failed: ${listError.message}`, request_id: requestId }, 400);
        }
        const matched = list.users.find((u) => u.email?.toLowerCase() === tenantEmail);
        if (matched) userId = matched.id;
      }

      if (!userId) {
        console.error("reset_password no target user", { request_id: requestId, tenant_id: tenantId || null, tenant_email: tenantEmail || null });
        return json({ success: false, error: "No linked auth user found for this tenant. Run Sync Auth Users first.", request_id: requestId }, 404);
      }
      const { data: existing, error: getErr } = await admin.auth.admin.getUserById(userId);
      console.log("reset_password getUserById response", { request_id: requestId, target_user_id: userId, found: !!existing?.user, target_email: existing?.user?.email ?? null, error: getErr ? { message: getErr.message, status: (getErr as any).status ?? null, code: (getErr as any).code ?? null } : null });
      if (getErr || !existing?.user) {
        console.error("reset_password: target user not found", { request_id: requestId, target_user_id: userId, error: getErr });
        return json({ success: false, error: `Target auth user not found: ${getErr?.message ?? "unknown"}`, request_id: requestId }, 404);
      }
      const { data: upd, error: updErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      console.log("reset_password updateUserById response", { request_id: requestId, target_user_id: userId, target_email: upd?.user?.email ?? existing.user.email ?? null, success: !updErr, error: updErr ? { message: updErr.message, status: (updErr as any).status ?? null, code: (updErr as any).code ?? null } : null });
      if (updErr) {
        console.error("reset_password: updateUserById failed", { request_id: requestId, target_user_id: userId, error: updErr });
        return json({ success: false, error: updErr.message, request_id: requestId }, 400);
      }
      console.log("reset_password: success", { request_id: requestId, target_user_id: userId, target_email: upd?.user?.email });
      await admin.from("activity_logs").insert({
        actor_user_id: user.id, action: "tenant_password_reset", entity: "auth.users", entity_id: userId,
        tenant_id: tenantId || null,
        metadata: { target_email: upd?.user?.email ?? existing.user.email, request_id: requestId },
      }).then(() => {}, () => {});
      return json({ success: true, message: "Password updated successfully", request_id: requestId });
    } else if (body.action === "suspend_tenant") {
      await admin.from("tenants").update({ status: "suspended" }).eq("id", body.tenant_id);
    } else if (body.action === "activate_tenant") {
      await admin.from("tenants").update({ status: "active" }).eq("id", body.tenant_id);
    } else if (body.action === "delete_tenant") {
      // SOFT DELETE ONLY. Never touches auth.users, user_roles, subscriptions,
      // plans, payments or any business data. Reversible via restore_tenant.
      const { error } = await admin
        .from("tenants")
        .update({ deleted_at: new Date().toISOString(), status: "suspended" })
        .eq("id", body.tenant_id);
      if (error) throw new Error(error.message);
      await admin.from("activity_logs").insert({
        actor_user_id: user.id,
        tenant_id: body.tenant_id,
        action: "tenant_archived",
        entity: "tenant",
        entity_id: body.tenant_id,
        metadata: { soft_delete: true },
      });
    } else if (body.action === "restore_tenant") {
      const { error } = await admin
        .from("tenants")
        .update({ deleted_at: null, status: "active" })
        .eq("id", body.tenant_id);
      if (error) throw new Error(error.message);
      await admin.from("activity_logs").insert({
        actor_user_id: user.id, tenant_id: body.tenant_id,
        action: "tenant_restored", entity: "tenant", entity_id: body.tenant_id, metadata: {},
      });
    } else if (body.action === "purge_tenant") {
      // DESTRUCTIVE — requires explicit "PURGE" confirm + tenant must already be archived.
      if (body.confirm !== "PURGE") return json({ error: "Type PURGE to confirm" }, 400);
      const { data: t } = await admin.from("tenants").select("id, deleted_at, company_name").eq("id", body.tenant_id).maybeSingle();
      if (!t) return json({ error: "Tenant not found" }, 404);
      if (!t.deleted_at) return json({ error: "Archive the client first, then purge." }, 400);

      // 1. Find users linked to this tenant.
      const { data: tu } = await admin.from("tenant_users").select("user_id").eq("tenant_id", body.tenant_id);
      const userIds = (tu ?? []).map((r) => r.user_id);

      // 2. Build a protected-user set: anyone with super_admin role, or anyone linked to another tenant.
      const { data: superRows } = await admin.from("user_roles").select("user_id").eq("role", "super_admin");
      const superIds = new Set((superRows ?? []).map((r) => r.user_id));
      const { data: otherLinks } = userIds.length
        ? await admin.from("tenant_users").select("user_id, tenant_id").in("user_id", userIds).neq("tenant_id", body.tenant_id)
        : { data: [] as any[] };
      const otherTenantIds = new Set((otherLinks ?? []).map((r) => r.user_id));

      // 3. Delete business data scoped strictly to THIS tenant_id.
      const businessTables = [
        "pos_sale_items","pos_sales","customer_payments","farm_payments","payments",
        "deliveries","supplies","purchases","expenses","customers","shops","farms","trucks",
        "activity_logs","subscriptions","settings","shop_recoveries","shop_ledger_entries","supplier_ledger_entries",
      ];
      const deleted: Record<string, number> = {};
      for (const tbl of businessTables) {
        const { count } = await admin.from(tbl).delete({ count: "exact" }).eq("tenant_id", body.tenant_id);
        deleted[tbl] = count ?? 0;
      }

      // 4. Drop tenant_users links for this tenant only.
      await admin.from("tenant_users").delete().eq("tenant_id", body.tenant_id);

      // 5. Delete the tenant row.
      await admin.from("tenants").delete().eq("id", body.tenant_id);

      // 6. Delete auth users — ONLY if not super_admin AND not linked to any other tenant.
      const removedAuth: string[] = [];
      const protectedAuth: string[] = [];
      for (const uid of userIds) {
        if (superIds.has(uid) || otherTenantIds.has(uid)) {
          protectedAuth.push(uid);
          continue;
        }
        await admin.auth.admin.deleteUser(uid).catch(() => {});
        removedAuth.push(uid);
      }

      await admin.from("activity_logs").insert({
        actor_user_id: user.id, tenant_id: null,
        action: "tenant_purged", entity: "tenant", entity_id: body.tenant_id,
        metadata: { deleted, removed_auth_users: removedAuth, protected_auth_users: protectedAuth, company_name: t.company_name },
      }).then(() => {}, () => {});

      return json({ ok: true, deleted, removed_auth_users: removedAuth.length, protected_auth_users: protectedAuth.length });
    } else if (body.action === "_legacy_delete_tenant_disabled") {
      // Hard-delete path is permanently disabled — see incident report 2026-06-18.
      return json({ error: "Hard delete disabled. Use delete_tenant (archive) then purge_tenant." }, 410);
    } else if (body.action === "diagnose_login") {
      const email = body.email.trim().toLowerCase();
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const authUser = list.users.find((u) => u.email?.toLowerCase() === email);
      const { data: tenant } = await admin.from("tenants").select("id, email, company_name, status").ilike("email", email).maybeSingle();
      let tenantLink: any = null;
      if (authUser) {
        const { data } = await admin.from("tenant_users").select("tenant_id, tenant_role").eq("user_id", authUser.id).maybeSingle();
        tenantLink = data;
      }
      const report = {
        email,
        auth_user: authUser ? { id: authUser.id, email: authUser.email, email_confirmed_at: authUser.email_confirmed_at, last_sign_in_at: authUser.last_sign_in_at, banned_until: (authUser as any).banned_until ?? null } : null,
        tenant,
        tenant_link: tenantLink,
        likely_cause:
          !authUser ? "No auth.users row for this email — repair needed."
          : !tenant ? "Auth user exists but no tenant row — orphan auth account."
          : !tenantLink ? "Auth user and tenant exist but not linked in tenant_users."
          : tenant.status !== "active" ? `Tenant status is '${tenant.status}', not active.`
          : !authUser.email_confirmed_at ? "Email not confirmed."
          : "Everything is linked. 'Invalid login credentials' from Supabase Auth means the password being typed does not match. Use Reset Password to set a new one.",
      };
      console.log("diagnose_login:", JSON.stringify(report));
      return json(report);
    } else if (body.action === "sync_auth_users") {
      // Find tenants whose tenant_users.user_id doesn't exist in auth.users, recreate auth account.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const authById = new Map(list.users.map((u) => [u.id, u]));
      const authByEmail = new Map(list.users.map((u) => [u.email?.toLowerCase() ?? "", u]));
      const { data: tenants } = await admin.from("tenants").select("id, email, owner_name, status");
      const { data: links } = await admin.from("tenant_users").select("tenant_id, user_id, tenant_role");
      const linkByTenant = new Map((links ?? []).map((l) => [l.tenant_id, l]));
      const repaired: any[] = [];
      const ok: any[] = [];
      for (const t of tenants ?? []) {
        const link = linkByTenant.get(t.id);
        const email = t.email?.toLowerCase() ?? "";
        let authUser = link ? authById.get(link.user_id) : undefined;
        if (!authUser && email) authUser = authByEmail.get(email);
        if (authUser && link && link.user_id === authUser.id) {
          ok.push({ tenant_id: t.id, email, user_id: authUser.id });
          continue;
        }
        if (authUser && (!link || link.user_id !== authUser.id)) {
          // Re-link
          if (link) await admin.from("tenant_users").delete().eq("tenant_id", t.id);
          await admin.from("tenant_users").insert({ tenant_id: t.id, user_id: authUser.id, tenant_role: "admin" });
          repaired.push({ tenant_id: t.id, email, action: "relinked", user_id: authUser.id });
          continue;
        }
        // No auth user — create one with a temporary password the admin must reset
        const tempPassword = `Tmp-${crypto.randomUUID().slice(0, 12)}!`;
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: t.email, password: tempPassword, email_confirm: true,
          user_metadata: { full_name: t.owner_name },
        });
        if (cErr || !created?.user) { repaired.push({ tenant_id: t.id, email, action: "create_failed", error: cErr?.message }); continue; }
        if (link) await admin.from("tenant_users").delete().eq("tenant_id", t.id);
        await admin.from("tenant_users").insert({ tenant_id: t.id, user_id: created.user.id, tenant_role: "admin" });
        await admin.from("user_roles").insert({ user_id: created.user.id, role: "admin" }).then(() => {}, () => {});
        repaired.push({ tenant_id: t.id, email, action: "auth_created", user_id: created.user.id, temp_password: tempPassword });
      }
      console.log("sync_auth_users:", JSON.stringify({ ok_count: ok.length, repaired }));
      return json({ ok: true, healthy: ok, repaired });
    } else {
      return json({ error: "Unknown action" }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("admin-tenant-action fatal", { request_id: requestId, error: msg, stack: e instanceof Error ? e.stack : undefined });
    return json({ success: false, error: msg, request_id: requestId }, 500);
  }
});