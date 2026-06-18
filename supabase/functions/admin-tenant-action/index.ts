import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action =
  | { action: "reset_password"; user_id: string; new_password: string }
  | { action: "delete_tenant"; tenant_id: string }
  | { action: "restore_tenant"; tenant_id: string }
  | { action: "purge_tenant"; tenant_id: string; confirm: string }
  | { action: "suspend_tenant"; tenant_id: string }
  | { action: "activate_tenant"; tenant_id: string }
  | { action: "sync_auth_users" }
  | { action: "diagnose_login"; email: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(url, service);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body: Action = await req.json();

    if (body.action === "reset_password") {
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.new_password });
      if (error) throw new Error(error.message);
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
      if (body.confirm !== "PURGE") return new Response(JSON.stringify({ error: "Type PURGE to confirm" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: t } = await admin.from("tenants").select("id, deleted_at, company_name").eq("id", body.tenant_id).maybeSingle();
      if (!t) return new Response(JSON.stringify({ error: "Tenant not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!t.deleted_at) return new Response(JSON.stringify({ error: "Archive the client first, then purge." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

      return new Response(JSON.stringify({ ok: true, deleted, removed_auth_users: removedAuth.length, protected_auth_users: protectedAuth.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else if (body.action === "_legacy_delete_tenant_disabled") {
      // Hard-delete path is permanently disabled — see incident report 2026-06-18.
      return new Response(JSON.stringify({ error: "Hard delete disabled. Use delete_tenant (archive) then purge_tenant." }), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
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
      return new Response(JSON.stringify(report), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      return new Response(JSON.stringify({ ok: true, healthy: ok, repaired }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});