import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---- Table groupings ---------------------------------------------------------
// Transactional / daily-business records. Children before parents.
const TRANSACTION_TABLES = [
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
  // Stock closing & mortality — children (adjustments) before parents (closings).
  "stock_adjustments",
  "stock_closings",
];

// Master / setup data — kept on Business Reset, wiped on Factory Reset.
const MASTER_TABLES = [
  "customers",
  "shops",
  "farms",
  "trucks",
];

// Per-tenant configuration & lookup tables (business profile, unit / meat /
// payment / expense / adjustment-reason customization, per-user permission
// overrides). Kept on Business Reset so the client can carry on. Wiped on
// Factory Reset so the tenant returns to the seeded defaults — matches the
// "brand-new state" promise shown in the UI.
const SETTINGS_TABLES = [
  "business_profiles",
  "meat_types",
  "units",
  "payment_methods",
  "expense_categories",
  "stock_adjustment_reasons",
  "user_permission_overrides",
];

// Activity logs are retained by policy — they are immutable security/audit
// records protected by a BEFORE DELETE trigger (`trg_activity_logs_no_delete`),
// so even service-role deletes are blocked. We deliberately leave this array
// empty and the verification pass below skips RETAINED_TABLES so retained
// logs don't count as "reset incomplete".
const LOG_TABLES: string[] = [];
const RETAINED_TABLES = new Set<string>(["activity_logs"]);

// Optional/cache tables used by some deployments. Missing tables are skipped.
const OPTIONAL_TRANSACTION_TABLES = [
  "inventory",
  "stock_movements",
  "daily_recovery",
  "dashboard_cached_stats",
  "dashboard_cache",
  "reports_cached_data",
  "reports_cache",
  "notifications",
];
const OPTIONAL_MASTER_TABLES = ["products"];

// Legacy union used by backup routine. Includes settings tables so a
// tenant-scoped safety backup captures the client's customized lookups.
const BUSINESS_TABLES = [...TRANSACTION_TABLES, ...MASTER_TABLES, ...SETTINGS_TABLES, ...LOG_TABLES];
const OPTIONAL_BUSINESS_TABLES = [...OPTIONAL_TRANSACTION_TABLES, ...OPTIONAL_MASTER_TABLES];

// Tables whose rows can also be reached via shop_id / farm_id of this tenant.
// Used for the orphan sweep so RESTRICT FKs on shops/farms can't block deletion.
const SHOP_CHILD_TABLES = new Set([
  "supplies", "shop_recoveries", "shop_ledger_entries",
]);
const FARM_CHILD_TABLES = new Set([
  "purchases", "farm_payments", "expenses", "deliveries",
]);
// supplier_ledger_entries stores the counterparty via `supplier_id` (which
// references farms.id). It has NO `farm_id` column — querying farm_id caused
// a "column does not exist" error. Sweep it via supplier_id instead.
const SUPPLIER_CHILD_TABLES = new Set([
  "supplier_ledger_entries",
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
  | { action: "factory_reset"; confirm: string; tenant_id: string }
  | { action: "delete_client"; confirm: string; tenant_id: string }
  // Legacy aliases kept for backward compat.
  | { action: "full_client_reset"; confirm: string; tenant_id: string }
  | { action: "backup"; tenant_id?: string | null }
  | { action: "restore"; backup: Record<string, any[]>; confirm: string };

const CONFIRM_PHRASES: Record<string, string[]> = {
  business_reset: ["BUSINESS RESET", "RESET", "I understand this will permanently delete data"],
  factory_reset: ["FACTORY RESET", "RESET", "I understand this will permanently delete data"],
  full_client_reset: ["FACTORY RESET", "RESET"],
  delete_client: ["DELETE CLIENT"],
  restore: ["RESET", "I understand this will permanently delete data"],
};
const isConfirmed = (action: string, s: string) =>
  (CONFIRM_PHRASES[action] ?? []).includes(s);

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

    // ---------- BUSINESS RESET (per-tenant, keeps master data + settings) ----------
    if (body.action === "business_reset") {
      if (!isConfirmed("business_reset", body.confirm)) return json({ error: 'Type "BUSINESS RESET" to confirm' }, 400);
      if (!body.tenant_id) return json({ error: "tenant_id is required" }, 400);
      return await resetTenant(admin, user, body.tenant_id, "business_reset");
    }

    // ---------- FACTORY RESET (per-tenant, wipes master + transactions + settings) ----------
    if (body.action === "factory_reset" || body.action === "full_client_reset") {
      const key = body.action;
      if (!isConfirmed(key, body.confirm)) return json({ error: 'Type "FACTORY RESET" to confirm' }, 400);
      if (!body.tenant_id) return json({ error: "tenant_id is required" }, 400);
      return await resetTenant(admin, user, body.tenant_id, "factory_reset");
    }

    // ---------- DELETE CLIENT (permanent purge) ----------
    if (body.action === "delete_client") {
      if (!isConfirmed("delete_client", body.confirm)) return json({ error: 'Type "DELETE CLIENT" to confirm' }, 400);
      if (!body.tenant_id) return json({ error: "tenant_id is required" }, 400);
      return await deleteClient(admin, user, body.tenant_id);
    }

    // ---------- RESTORE ----------
    if (body.action === "restore") {
      if (!isConfirmed("restore", body.confirm)) return json({ error: "Type RESET to confirm" }, 400);
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
  const resetTables = [...BUSINESS_TABLES, ...OPTIONAL_BUSINESS_TABLES];
  const tables = includeTenancy
    ? [...resetTables, "tenants", "tenant_users", "subscriptions", "subscription_plans", "user_roles", "profiles", "system_settings", "settings"]
    : resetTables;
  for (const t of tables) {
    try {
      const q = admin.from(t).select("*");
      const { data } = tenantId && resetTables.includes(t)
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
  mode: "business_reset" | "factory_reset",
) {
  const started = Date.now();
  // Verify tenant exists — never operate on a missing/foreign tenant.
  const { data: tenant, error: tErr } = await admin
    .from("tenants").select("id, company_name, email").eq("id", tenantId).maybeSingle();
  if (tErr) return json({ error: tErr.message }, 500);
  if (!tenant) return json({ error: "Tenant not found" }, 404);

  // Safety backup (this tenant only, business tables only). MUST succeed for factory_reset.
  let backup: Record<string, any[]> = {};
  try {
    backup = await buildBackup(admin, tenantId, /*includeTenancy*/ false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (mode === "factory_reset") {
      return json({ error: `Backup failed — reset cancelled to protect data: ${msg}` }, 500);
    }
  }

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

  // Which tables get wiped depends on mode.
  //   business_reset  -> only transactions, logs, and transactional cache. Master data is preserved.
  //   factory_reset   -> transactions + master data + settings + logs (tenant/subscription/owner survive).
  const tables = mode === "business_reset"
    ? [
        ...TRANSACTION_TABLES,
        ...OPTIONAL_TRANSACTION_TABLES,
        ...LOG_TABLES,
      ]
    : [
        ...TRANSACTION_TABLES,
        ...OPTIONAL_TRANSACTION_TABLES,
        ...MASTER_TABLES,
        ...OPTIONAL_MASTER_TABLES,
        ...SETTINGS_TABLES,
        ...LOG_TABLES,
        "settings",
      ];
  const deleted_counts: Record<string, number> = {};
  const errors: Record<string, any> = {};
  const stages: { table: string; deleted: number; error?: string }[] = [];
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
    const code = error?.code ?? null;
    const details = error?.details ?? null;
    const hint = error?.hint ?? null;
    // Try to surface the violated constraint / referencing table when Postgres reports one.
    const constraintMatch =
      typeof message === "string"
        ? message.match(/constraint "([^"]+)"/i) ?? message.match(/violates [a-z ]*constraint "([^"]+)"/i)
        : null;
    const referencingMatch =
      typeof details === "string" ? details.match(/from table "([^"]+)"/i) : null;
    const payload = {
      scope,
      message,
      code,
      details,
      hint,
      constraint: constraintMatch?.[1] ?? null,
      referencing_table: referencingMatch?.[1] ?? null,
    };
    console.error(`[reset] ${table} (${scope}) [${code ?? "?"}]: ${message}`, {
      details,
      hint,
      constraint: payload.constraint,
      referencing_table: payload.referencing_table,
    });
    errors[`${table}.${scope}`] = payload;
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
    const before = deleted_counts[table] ?? 0;

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
    if (farmIds.length && SUPPLIER_CHILD_TABLES.has(table)) {
      await deleteWhereIn(table, "supplier_id", farmIds);
    }
    const after = deleted_counts[table] ?? 0;
    const tableErr = Object.entries(errors).find(([k]) => k.startsWith(`${table}.`))?.[1] as any;
    stages.push({ table, deleted: after - before, error: tableErr?.message });
  }

  console.log(`[reset] tenant=${tenantId} mode=${mode} total=${total}`, deleted_counts, errors);
  const duration_ms = Date.now() - started;

  // ---------- Verification pass ----------
  // Count remaining rows in every wiped table for this tenant. If anything remains
  // (either by tenant_id or via the orphan sweep IDs), report it as a verification
  // failure so the caller can surface the offending tables to the user.
  const remaining_counts: Record<string, number> = {};
  const verifyTable = async (table: string) => {
    // Immutable security logs are retained by policy — never count as
    // "reset incomplete".
    if (RETAINED_TABLES.has(table)) return;
    let total = 0;
    try {
      const { count, error } = await admin
        .from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
      if (error) { if (!isMissingTable(error)) rememberError(table, "verify_tenant", error, OPTIONAL_BUSINESS_TABLES.includes(table)); return; }
      total += count ?? 0;
    } catch { /* ignore */ }
    const checkIn = async (column: string, ids: string[]) => {
      if (!ids.length) return;
      try {
        const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in(column, ids);
        total += count ?? 0;
      } catch { /* ignore */ }
    };
    if (posSaleIds.length && table === "pos_sale_items") await checkIn("sale_id", posSaleIds);
    if (purchaseIds.length && table === "supplies") await checkIn("purchase_id", purchaseIds);
    if (customerIds.length && CUSTOMER_CHILD_TABLES.has(table)) await checkIn("customer_id", customerIds);
    if (truckIds.length && TRUCK_CHILD_TABLES.has(table)) await checkIn("truck_id", truckIds);
    if (shopIds.length && SHOP_CHILD_TABLES.has(table)) await checkIn("shop_id", shopIds);
    if (farmIds.length && FARM_CHILD_TABLES.has(table)) await checkIn("farm_id", farmIds);
    if (total > 0) remaining_counts[table] = total;
  };
  for (const table of tables) await verifyTable(table);
  const verification_failed = Object.keys(remaining_counts).length > 0;
  if (verification_failed) {
    console.error(`[reset] verification failed for tenant=${tenantId}`, remaining_counts);
  }

  // Factory reset returns the tenant to its "brand-new state". After wiping
  // settings/lookup tables (meat types, units, payment methods, expense
  // categories, adjustment reasons, business profile) we MUST re-seed the
  // defaults or the tenant loses every dropdown the UI depends on.
  if (!verification_failed && mode === "factory_reset") {
    const { error: seedErr } = await admin.rpc("seed_tenant_settings", { _tid: tenantId });
    if (seedErr) {
      console.error(`[reset] re-seed failed for tenant=${tenantId}`, seedErr);
      errors["seed_tenant_settings.rpc"] = { message: seedErr.message, code: seedErr.code ?? null };
    }
  }

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
      duration_ms,
      status: verification_failed
        ? "verification_failed"
        : Object.keys(errors).length ? "partial_failure" : "success",
      deleted_counts,
      total_rows_deleted: total,
      errors: Object.keys(errors).length ? errors : undefined,
      remaining_counts: verification_failed ? remaining_counts : undefined,
    },
  }).then(() => {}, () => {});

  return json({
    ok: !verification_failed,
    mode,
    tenant_id: tenantId,
    tenant_name: tenant.company_name,
    duration_ms,
    stages,
    deleted_counts,
    total_rows_deleted: total,
    errors: Object.keys(errors).length ? errors : undefined,
    remaining_counts: verification_failed ? remaining_counts : undefined,
    verification_failed,
    backup,
    retained_tables: Array.from(RETAINED_TABLES),
    message: verification_failed
      ? `Reset incomplete — ${Object.keys(remaining_counts).length} table(s) still contain data for this tenant: ${Object.keys(remaining_counts).join(", ")}.`
      : mode === "business_reset"
        ? `Business Data Reset Successfully. ${total} record(s) removed. Master data (farms, shops, suppliers, trucks, customers) preserved. Security audit logs are retained by policy.`
        : `Factory Reset Completed Successfully. ${total} record(s) removed. Owner account, subscription and organization profile preserved. Security audit logs are retained by policy.`,
  });
}

// ---------- DELETE CLIENT (permanent purge) ----------
async function deleteClient(
  admin: any,
  actor: { id: string; email?: string | null },
  tenantId: string,
) {
  const started = Date.now();
  const { data: tenant, error: tErr } = await admin
    .from("tenants").select("id, company_name, email").eq("id", tenantId).maybeSingle();
  if (tErr) return json({ error: tErr.message }, 500);
  if (!tenant) return json({ error: "Tenant not found" }, 404);

  // Auto-backup FIRST — abort if it fails so nothing is deleted without a snapshot.
  let backup: Record<string, any[]>;
  try {
    backup = await buildBackup(admin, tenantId, /*includeTenancy*/ true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `Backup failed — delete cancelled to protect data: ${msg}` }, 500);
  }

  // Wipe all data first (uses the factory_reset table set + tenant-scoped only).
  const wipe = await resetTenant(admin, actor, tenantId, "factory_reset");
  // resetTenant returns a Response; unwrap to compose our own final response.
  let wipeBody: any = {};
  try { wipeBody = await wipe.json(); } catch { /* ignore */ }
  if (!wipeBody?.ok) {
    return json({
      error: wipeBody?.error ?? "Data wipe failed before client removal — no records were purged.",
      details: wipeBody,
    }, 500);
  }

  // Users linked to this tenant
  const { data: tu } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId);
  const userIds = (tu ?? []).map((r: any) => r.user_id);
  const { data: superRows } = await admin.from("user_roles").select("user_id").eq("role", "super_admin");
  const superIds = new Set((superRows ?? []).map((r: any) => r.user_id));
  const { data: otherLinks } = userIds.length
    ? await admin.from("tenant_users").select("user_id").in("user_id", userIds).neq("tenant_id", tenantId)
    : { data: [] as any[] };
  const otherTenantIds = new Set((otherLinks ?? []).map((r: any) => r.user_id));

  await admin.from("subscriptions").delete().eq("tenant_id", tenantId);
  await admin.from("payments").delete().eq("tenant_id", tenantId);
  await admin.from("tenant_users").delete().eq("tenant_id", tenantId);
  const { error: delTenantErr } = await admin.from("tenants").delete().eq("id", tenantId);
  if (delTenantErr) return json({ error: `Failed to delete tenant row: ${delTenantErr.message}` }, 500);

  const removedAuth: string[] = [];
  const protectedAuth: string[] = [];
  for (const uid of userIds) {
    if (superIds.has(uid) || otherTenantIds.has(uid)) { protectedAuth.push(uid); continue; }
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    removedAuth.push(uid);
  }

  const duration_ms = Date.now() - started;
  await admin.from("activity_logs").insert({
    actor_user_id: actor.id,
    tenant_id: null,
    action: "delete_client",
    entity: "tenant",
    entity_id: tenantId,
    metadata: {
      mode: "delete_client",
      tenant_id: tenantId,
      tenant_name: tenant.company_name,
      tenant_email: tenant.email,
      actor_email: actor.email ?? null,
      status: "success",
      duration_ms,
      removed_auth_users: removedAuth,
      protected_auth_users: protectedAuth,
      deleted_counts: wipeBody.deleted_counts,
      total_rows_deleted: wipeBody.total_rows_deleted,
    },
  }).then(() => {}, () => {});

  return json({
    ok: true,
    mode: "delete_client",
    tenant_id: tenantId,
    tenant_name: tenant.company_name,
    duration_ms,
    removed_auth_users: removedAuth.length,
    protected_auth_users: protectedAuth.length,
    deleted_counts: wipeBody.deleted_counts,
    total_rows_deleted: wipeBody.total_rows_deleted,
    backup,
    message: `Client Deleted Successfully. Tenant, subscription, ${removedAuth.length} auth user(s) and all data removed.`,
  });
}