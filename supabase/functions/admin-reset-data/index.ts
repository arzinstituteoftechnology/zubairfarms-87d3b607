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
  "shop_recoveries",
  "shop_ledger_entries",
  "supplier_ledger_entries",
  "customers",
  "shops",
  "farms",
  "trucks",
  "activity_logs",
];

// Optional/cache tables used by some deployments. They are skipped when absent.
const OPTIONAL_BUSINESS_TABLES = [
  "products",
  "inventory",
  "daily_recovery",
  "dashboard_cached_stats",
  "dashboard_cache",
  "reports_cached_data",
  "reports_cache",
  "notifications",
];

// Tables whose rows can also be reached via shop_id / farm_id of this tenant.
// Used for the orphan sweep so RESTRICT FKs on shops/farms can't block deletion.
const SHOP_CHILD_TABLES = new Set([
  "supplies", "deliveries", "shop_recoveries", "shop_ledger_entries",
]);
const FARM_CHILD_TABLES = new Set([
  "purchases", "farm_payments", "expenses", "deliveries", "supplier_ledger_entries",
]);
const CUSTOMER_CHILD_TABLES = new Set([
  "pos_sales", "customer_payments",
]);
const TRUCK_CHILD_TABLES = new Set([
  "deliveries",
]);

// Tables that are PROTECTED in a business reset — they survive.
// (tenants, tenant_users, subscriptions, subscription_plans, user_roles,
//  profiles, system_settings, settings, auth.users)

type Body =
  | { action: "business_reset"; confirm: string; tenant_id: string }
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
      if (!body.tenant_id) return json({ error: "tenant_id is required — global resets are not allowed" }, 400);
      return await resetTenant(admin, user, body.tenant_id, /*includeSettings*/ false, "business_reset");
    }

    // ---------- FULL CLIENT RESET (per-tenant: wipe business + settings, keep org/owner/subscription) ----------
    if (body.action === "full_client_reset") {
      if (!isConfirmed(body.confirm)) return json({ error: "Type RESET to confirm" }, 400);
      if (!body.tenant_id) return json({ error: "tenant_id required" }, 400);
      return await resetTenant(admin, user, body.tenant_id, /*includeSettings*/ true, "full_client_reset");
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

async function resetTenant(
  admin: any,
  actor: { id: string; email?: string | null },
  tenantId: string,
  includeSettings: boolean,
  mode: "business_reset" | "full_client_reset",
) {
  // Verify tenant exists — never operate on a missing/foreign tenant.
  const { data: tenant, error: tErr } = await admin
    .from("tenants").select("id, company_name, email").eq("id", tenantId).maybeSingle();
  if (tErr) return json({ error: tErr.message }, 500);
  if (!tenant) return json({ error: "Tenant not found" }, 404);

  // Safety backup (this tenant only, business tables only).
  const backup = await buildBackup(admin, tenantId, /*includeTenancy*/ false);

  // Collect this tenant's shop_ids / farm_ids up-front so we can also sweep
  // any orphan child rows (rows whose tenant_id is NULL but whose shop_id/farm_id
  // belongs to this tenant). Without this sweep, RESTRICT foreign keys on
  // supplies.shop_id and purchases.farm_id can block shops/farms deletion.
  const { data: shopRows } = await admin.from("shops").select("id").eq("tenant_id", tenantId);
  const { data: farmRows } = await admin.from("farms").select("id").eq("tenant_id", tenantId);
  const { data: customerRows } = await admin.from("customers").select("id").eq("tenant_id", tenantId);
  const { data: truckRows } = await admin.from("trucks").select("id").eq("tenant_id", tenantId);
  const { data: purchaseRows } = await admin.from("purchases").select("id").eq("tenant_id", tenantId);
  const { data: posSaleRows } = await admin.from("pos_sales").select("id").eq("tenant_id", tenantId);
  const shopIds = (shopRows ?? []).map((r: any) => r.id);
  const farmIds = (farmRows ?? []).map((r: any) => r.id);
  const customerIds = (customerRows ?? []).map((r: any) => r.id);
  const truckIds = (truckRows ?? []).map((r: any) => r.id);
  const purchaseIds = (purchaseRows ?? []).map((r: any) => r.id);
  const posSaleIds = (posSaleRows ?? []).map((r: any) => r.id);

  const tables = includeSettings
    ? [...BUSINESS_TABLES, ...OPTIONAL_BUSINESS_TABLES, "settings"]
    : [...BUSINESS_TABLES, ...OPTIONAL_BUSINESS_TABLES];
  const deleted_counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  let total = 0;

  const isMissingTable = (error: any) => {
    const msg = String(error?.message ?? "").toLowerCase();
    return error?.code === "42P01" || msg.includes("could not find the table") || msg.includes("does not exist");
  };

  const addDeleted = (table: string, count: number | null | undefined) => {
    const n = Math.max(0, Number(count ?? 0));
    deleted_counts[table] = (deleted_counts[table] ?? 0) + n;
    total += n;
  };

  const rememberError = (table: string, scope: string, error: any, optional = false) => {
    if (optional && isMissingTable(error)) return;
    const message = error?.message ?? String(error);
    console.error(`[reset] ${table} (${scope}): ${message}`);
    errors[`${table}.${scope}`] = message;
    deleted_counts[table] = deleted_counts[table] ?? 0;
  };

  const deleteWhereEq = async (table: string, column: string, value: string, optional = false) => {
    const { count, error: countError } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, value);
    if (countError) {
      rememberError(table, `${column}_count`, countError, optional);
      return;
    }
    if (!count) {
      deleted_counts[table] = deleted_counts[table] ?? 0;
      return;
    }
    const { error } = await admin.from(table).delete().eq(column, value);
    if (error) rememberError(table, column, error, optional);
    else addDeleted(table, count);
  };

  const deleteWhereIn = async (table: string, column: string, values: string[], optional = false) => {
    if (!values.length) return;
    const { count, error: countError } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .in(column, values);
    if (countError) {
      rememberError(table, `${column}_count`, countError, optional);
      return;
    }
    if (!count) return;
    const { error } = await admin.from(table).delete().in(column, values);
    if (error) rememberError(table, `${column}_sweep`, error, optional);
    else addDeleted(table, count);
  };

  for (const table of tables) {
    const optional = OPTIONAL_BUSINESS_TABLES.includes(table);

    // EVERY delete is strictly scoped to this tenant_id first. No global wipes possible.
    await deleteWhereEq(table, "tenant_id", tenantId, optional);

    // Orphan sweep: catch rows that reference this tenant's shop/farm but
    // somehow lost their own tenant_id. Strictly limited to this tenant's IDs.
    if (posSaleIds.length && table === "pos_sale_items") {
      await deleteWhereIn(table, "sale_id", posSaleIds);
    }
    if (purchaseIds.length && table === "supplies") {
      await deleteWhereIn(table, "purchase_id", purchaseIds);
    }
    if (customerIds.length && CUSTOMER_CHILD_TABLES.has(table)) {
      await deleteWhereIn(table, "customer_id", customerIds);
    }
    if (truckIds.length && TRUCK_CHILD_TABLES.has(table)) {
      await deleteWhereIn(table, "truck_id", truckIds);
    }
    if (shopIds.length && SHOP_CHILD_TABLES.has(table)) {
      await deleteWhereIn(table, "shop_id", shopIds);
    }
    if (farmIds.length && FARM_CHILD_TABLES.has(table)) {
      await deleteWhereIn(table, "farm_id", farmIds);
    }
  }

  console.log(`[reset] tenant=${tenantId} mode=${mode} total=${total}`, deleted_counts, errors);

  // Detailed audit log — tenant-scoped, never affects other tenants.
  await admin.from("activity_logs").insert({
    actor_user_id: actor.id,
    tenant_id: tenantId,
    action: mode,
    entity: "tenant",
    entity_id: tenantId,
    metadata: {
      mode,
      tenant_id: tenantId,
      tenant_name: tenant.company_name,
      tenant_email: tenant.email,
      actor_user_id: actor.id,
      actor_email: actor.email ?? null,
      reset_at: new Date().toISOString(),
      deleted_counts,
      total_rows_deleted: total,
      errors: Object.keys(errors).length ? errors : undefined,
    },
  }).then(() => {}, () => {});

  return json({
    ok: true,
    mode,
    tenant_id: tenantId,
    tenant_name: tenant.company_name,
    deleted_counts,
    total_rows_deleted: total,
    errors: Object.keys(errors).length ? errors : undefined,
    backup,
    message: `Tenant data reset completed successfully. ${total} record(s) removed across ${Object.keys(deleted_counts).length} table(s). Owner account, subscription, plan and organization profile preserved.`,
  });
}