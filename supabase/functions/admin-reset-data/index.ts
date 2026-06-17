import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tables that hold business records — safe to wipe on a "business reset".
// Order matters: children before parents to respect foreign keys.
const BUSINESS_TABLES = [
  "pos_sale_items",
  "pos_sales",
  "customer_payments",
  "farm_payments",
  "payments",
  "deliveries",
  "supplies",
  "purchases",
  "expenses",
  "customers",
  "shops",
  "farms",
  "trucks",
  "activity_logs",
];

// Tables that are PROTECTED in a business reset — they survive.
// (tenants, tenant_users, subscriptions, subscription_plans, user_roles,
//  profiles, system_settings, settings, auth.users)

type Body =
  | { action: "business_reset"; confirm: string; tenant_id?: string | null }
  | { action: "full_client_reset"; confirm: string; tenant_id: string }
  | { action: "factory_reset"; confirm: string }
  | { action: "backup"; tenant_id?: string | null }
  | { action: "restore"; backup: Record<string, any[]>; confirm: string };

const CONFIRM_PHRASE = "I understand this will permanently delete data";
const SHORT_CONFIRM = "RESET";
const isConfirmed = (s: string) => s === CONFIRM_PHRASE || s === SHORT_CONFIRM;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return json({ error: "Not authenticated" }, 401);
    }

    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — super admin only" }, 403);

    const body = (await req.json()) as Body;

    // ---------- BACKUP ----------
    if (body.action === "backup") {
      const backup = await buildBackup(admin, body.tenant_id ?? null, /*includeTenancy*/ true);
      return json({ ok: true, backup, generated_at: new Date().toISOString() });
    }

    // ---------- BUSINESS RESET ----------
    if (body.action === "business_reset") {
      if (!isConfirmed(body.confirm)) return json({ error: "Type RESET to confirm" }, 400);

      // Take a safety backup first (business tables only).
      const backup = await buildBackup(admin, body.tenant_id ?? null, /*includeTenancy*/ false);

      const counts: Record<string, number> = {};
      for (const table of BUSINESS_TABLES) {
        const q = admin.from(table).delete();
        const filtered = body.tenant_id ? q.eq("tenant_id", body.tenant_id) : q.not("id", "is", null);
        const { error, count } = await filtered.select("*", { count: "exact", head: true });
        if (error) {
          // Table may not exist — skip silently
          counts[table] = -1;
          continue;
        }
        counts[table] = count ?? 0;
      }

      return json({
        ok: true,
        mode: "business_reset",
        tenant_id: body.tenant_id ?? null,
        deleted_counts: counts,
        backup,
        message: "Business data cleared. Super admin, tenants, users and subscriptions were preserved.",
      });
    }

    // ---------- FULL CLIENT RESET (per-tenant: wipe business + settings, keep org/owner/subscription) ----------
    if (body.action === "full_client_reset") {
      if (!isConfirmed(body.confirm)) return json({ error: "Type RESET to confirm" }, 400);
      if (!body.tenant_id) return json({ error: "tenant_id required" }, 400);

      const backup = await buildBackup(admin, body.tenant_id, /*includeTenancy*/ false);
      const counts: Record<string, number> = {};
      const tables = [...BUSINESS_TABLES, "settings"];
      for (const table of tables) {
        const { error, count } = await admin.from(table).delete({ count: "exact" }).eq("tenant_id", body.tenant_id);
        counts[table] = error ? -1 : (count ?? 0);
      }

      await admin.from("activity_logs").insert({
        actor_user_id: user.id,
        tenant_id: body.tenant_id,
        action: "full_client_reset",
        entity: "tenant",
        entity_id: body.tenant_id,
        metadata: { deleted_counts: counts },
      });

      return json({
        ok: true,
        mode: "full_client_reset",
        tenant_id: body.tenant_id,
        deleted_counts: counts,
        backup,
        message: "Full client reset complete. Owner account, organization and subscription preserved.",
      });
    }

    // ---------- FACTORY RESET (super admin only, wipes everything except super admins) ----------
    if (body.action === "factory_reset") {
      if (!isConfirmed(body.confirm)) return json({ error: "Type RESET to confirm" }, 400);

      const backup = await buildBackup(admin, null, /*includeTenancy*/ true);

      // 1. business tables
      for (const table of BUSINESS_TABLES) {
        await admin.from(table).delete().not("id", "is", null);
      }
      // 2. tenant-scoped tables
      await admin.from("subscriptions").delete().not("id", "is", null);
      await admin.from("tenant_users").delete().not("tenant_id", "is", null);
      await admin.from("tenants").delete().not("id", "is", null);

      // 3. auth users — delete everyone EXCEPT current super admins
      const { data: superRows } = await admin.from("user_roles").select("user_id").eq("role", "super_admin");
      const protectedIds = new Set((superRows ?? []).map((r) => r.user_id));
      let page = 1;
      const deleted: string[] = [];
      while (true) {
        const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error || !list?.users?.length) break;
        for (const u of list.users) {
          if (protectedIds.has(u.id)) continue;
          await admin.auth.admin.deleteUser(u.id).catch(() => {});
          deleted.push(u.id);
        }
        if (list.users.length < 200) break;
        page += 1;
      }
      // 4. orphan user_roles
      await admin.from("user_roles").delete().not("user_id", "in", `(${[...protectedIds].map((id) => `"${id}"`).join(",") || "''"})`);

      return json({
        ok: true,
        mode: "factory_reset",
        deleted_auth_users: deleted.length,
        preserved_super_admins: [...protectedIds],
        backup,
        message: "Factory reset complete. Super admin accounts were preserved.",
      });
    }

    // ---------- RESTORE ----------
    if (body.action === "restore") {
      if (!isConfirmed(body.confirm)) return json({ error: "Type RESET to confirm" }, 400);
      const results: Record<string, { inserted: number; error?: string }> = {};
      // Insert in reverse dependency order: parents first.
      const restoreOrder = [...BUSINESS_TABLES].reverse();
      for (const table of restoreOrder) {
        const rows = body.backup?.[table];
        if (!rows?.length) continue;
        const { error, count } = await admin.from(table).upsert(rows, { onConflict: "id", count: "exact" });
        results[table] = { inserted: count ?? rows.length, error: error?.message };
      }
      return json({ ok: true, mode: "restore", results });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

async function buildBackup(admin: any, tenantId: string | null, includeTenancy: boolean) {
  const out: Record<string, any[]> = {};
  const tables = includeTenancy
    ? [...BUSINESS_TABLES, "tenants", "tenant_users", "subscriptions", "subscription_plans", "user_roles", "profiles", "system_settings", "settings"]
    : BUSINESS_TABLES;
  for (const t of tables) {
    try {
      const q = admin.from(t).select("*");
      const { data } = tenantId && BUSINESS_TABLES.includes(t)
        ? await q.eq("tenant_id", tenantId)
        : await q;
      if (data) out[t] = data;
    } catch { /* table may not exist */ }
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}