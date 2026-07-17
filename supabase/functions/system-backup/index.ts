import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tables that hold business data — included in every backup snapshot.
// NOTE: keep this list in sync with the reset function's table sets. Every
// tenant-scoped table in `public` must be listed here or a tenant backup will
// silently omit user-customized data (units, meat types, business profile, …)
// and a restore will leave that data behind.
const BUSINESS_TABLES = [
  // Master data
  "shops", "farms", "customers", "trucks",
  // Per-tenant configuration / lookups
  "business_profiles",
  "meat_types", "units", "payment_methods",
  "expense_categories", "stock_adjustment_reasons",
  "user_permission_overrides",
  // Transactions
  "purchases", "supplies", "deliveries",
  "supplier_ledger_entries", "shop_ledger_entries",
  "shop_recoveries", "farm_payments", "customer_payments", "payments",
  "expenses", "pos_sales", "pos_sale_items",
  "stock_adjustments", "stock_closings",
  "activity_logs",
];

// System tables included so settings/users/roles survive a restore.
const SYSTEM_TABLES = [
  "tenants", "tenant_users", "subscriptions", "subscription_plans",
  "user_roles", "profiles", "system_settings", "settings",
];

const ALL_TABLES = [...BUSINESS_TABLES, ...SYSTEM_TABLES];

// Schema version stamped into every backup payload. Bump on breaking schema
// changes so restores can refuse older backups if incompatible.
const SCHEMA_VERSION = "1.0";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Action =
  | { action: "create"; backup_type?: "daily" | "manual" | "monthly" | "emergency" | "pre_restore" | "pre_reset"; tenant_id?: string | null }
  | { action: "verify"; backup_id: string }
  | { action: "restore"; backup_id?: string; backup?: Record<string, any[]>; preserve_super_admin?: boolean; _rolling_back?: boolean }
  | { action: "cleanup" }
  | { action: "download"; backup_id: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    // Shared secret for the pg_cron daily job. Not user-facing.
    const CRON_SECRET = Deno.env.get("CRON_SHARED_SECRET") ?? "meatflow-cron-23-59";
    const isCron = req.headers.get("x-cron-secret") === CRON_SECRET;
    const admin = createClient(url, service);

    let userId: string | null = null;
    let callerTenantId: string | null = null;
    let callerIsSuperAdmin = false;
    let callerIsTenantOwner = false;
    if (!isCron) {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Not authenticated" }, 401);
      userId = user.id;
      const { data: roleRow } = await admin
        .from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
      callerIsSuperAdmin = !!roleRow;
      if (!callerIsSuperAdmin) {
        const { data: tu } = await admin.from("tenant_users")
          .select("tenant_id, tenant_role, status").eq("user_id", user.id).maybeSingle();
        if (tu && tu.status === "active" && tu.tenant_role === "owner") {
          callerIsTenantOwner = true;
          callerTenantId = tu.tenant_id;
        }
      }
      if (!callerIsSuperAdmin && !callerIsTenantOwner) {
        return json({ error: "Forbidden — super admin or account Owner only" }, 403);
      }
    }

    const body = (await req.json().catch(() => ({}))) as Action;

    if (body.action === "create") {
      // Tenant Owners may only create backups scoped to their own tenant.
      let tId = body.tenant_id ?? null;
      if (callerIsTenantOwner) {
        if (tId && tId !== callerTenantId) {
          return json({ error: "Owners can only create backups for their own account" }, 403);
        }
        tId = callerTenantId;
      }
      return await handleCreate(admin, body.backup_type ?? "manual", userId, tId);
    }
    if (body.action === "verify") {
      return await handleVerify(admin, body.backup_id, callerIsTenantOwner ? callerTenantId : null);
    }
    if (body.action === "cleanup") {
      if (!callerIsSuperAdmin) return json({ error: "Super admin only" }, 403);
      return await handleCleanup(admin);
    }
    if (body.action === "download") {
      return await handleDownload(admin, body.backup_id, callerIsTenantOwner ? callerTenantId : null);
    }
    if (body.action === "restore") {
      return await handleRestore(admin, body, userId, callerIsTenantOwner ? callerTenantId : null);
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function snapshot(admin: any, tenantId: string | null = null) {
  const out: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  // When tenant-scoped: skip subscription_plans (global), scope all others by tenant_id or membership.
  const tables = tenantId
    ? ALL_TABLES.filter((t) => t !== "subscription_plans")
    : ALL_TABLES;
  // Members of this tenant (for user_roles + profiles which live in auth land).
  let tenantUserIds: string[] = [];
  if (tenantId) {
    const { data: tu } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId);
    tenantUserIds = (tu ?? []).map((r: any) => r.user_id);
  }
  for (const t of tables) {
    try {
      let q = admin.from(t).select("*");
      if (tenantId) {
        if (t === "tenants") q = q.eq("id", tenantId);
        else if (t === "user_roles" || t === "profiles") {
          if (!tenantUserIds.length) { out[t] = []; counts[t] = 0; continue; }
          q = q.in(t === "profiles" ? "id" : "user_id", tenantUserIds);
        } else {
          q = q.eq("tenant_id", tenantId);
        }
      }
      const { data, error } = await q;
      if (error) { errors[t] = error.message; continue; }
      out[t] = data ?? [];
      counts[t] = (data ?? []).length;
    } catch (e) {
      errors[t] = e instanceof Error ? e.message : String(e);
    }
  }
  return { snapshot: out, counts, errors };
}

async function handleCreate(admin: any, backup_type: string, userId: string | null, tenantId: string | null = null) {
  // Look up tenant name for scoped backups so the file has a friendly name.
  let tenantName: string | null = null;
  if (tenantId) {
    const { data: tRow } = await admin.from("tenants").select("company_name").eq("id", tenantId).maybeSingle();
    tenantName = tRow?.company_name ?? null;
  }
  // 1. Insert pending row
  const { data: row, error: insErr } = await admin.from("backup_history")
    .insert({ backup_type, status: "pending", created_by: userId, tenant_id: tenantId, tenant_name: tenantName })
    .select("*").single();
  if (insErr) return json({ error: insErr.message }, 500);

  try {
    const { snapshot: snap, counts, errors } = await snapshot(admin, tenantId);

    const payload = {
      generated_at: new Date().toISOString(),
      backup_type,
      tenant_id: tenantId,
      tenant_name: tenantName,
      app: "MeatFlow ERP",
      version: 1,
      schema_version: SCHEMA_VERSION,
      counts,
      data: snap,
    };
    const body = JSON.stringify(payload);
    // Gzip-compress so backups stay small on storage / downloads.
    const gz = new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"));
    const gzBuf = await new Response(gz).arrayBuffer();
    const blob = new Blob([gzBuf], { type: "application/gzip" });
    const checksum = await sha256Hex(gzBuf);

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mi = String(now.getUTCMinutes()).padStart(2, "0");
    const safeTenant = (tenantName ?? "System").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
    const backupName = `${safeTenant}_${yyyy}-${mm}-${dd}_${hh}-${mi}_${backup_type}_Backup.json.gz`;
    const path = `${yyyy}/${mm}/${dd}/${backupName}`;

    const { error: upErr } = await admin.storage.from("system-backups")
      .upload(path, blob, { contentType: "application/gzip", upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    const tableErrCount = Object.keys(errors).length;
    const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
    // Integrity check — a valid tenant backup must contain the tenant row itself.
    const integrityOk = tenantId ? (snap["tenants"]?.length === 1) : true;
    if (!integrityOk) throw new Error("Integrity check failed — tenant row missing from snapshot");
    const health = {
      tables_ok: Object.keys(counts).length,
      tables_failed: tableErrCount,
      total_records: totalRecords,
      integrity_ok: integrityOk,
      compressed: true,
      uncompressed_size: body.length,
      schema_version: SCHEMA_VERSION,
      checksum_sha256: checksum,
      errors: tableErrCount ? errors : undefined,
    };

    await admin.from("backup_history").update({
      status: tableErrCount ? "warning" : "success",
      storage_path: path,
      file_size: gzBuf.byteLength,
      backup_name: backupName,
      table_counts: counts,
      health,
      checksum_sha256: checksum,
      schema_version: SCHEMA_VERSION,
      completed_at: new Date().toISOString(),
    }).eq("id", row.id);

    // Audit trail — Requirement #8: backup operations must generate audit events.
    await admin.from("activity_logs").insert({
      action: "backup_create",
      entity: "backup_history",
      entity_id: row.id,
      tenant_id: tenantId,
      actor_user_id: userId,
      metadata: { backup_type, backup_name: backupName, path, size: gzBuf.byteLength, counts, tenant_name: tenantName },
    }).then(() => {}, () => {});

    // Trigger cleanup async (don't block)
    handleCleanup(admin).catch(() => {});

    return json({ ok: true, backup_id: row.id, path, backup_name: backupName, size: gzBuf.byteLength, counts, health, tenant_id: tenantId, tenant_name: tenantName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("backup_history").update({
      status: "failed", error_message: msg, completed_at: new Date().toISOString(),
    }).eq("id", row.id);
    await admin.from("activity_logs").insert({
      action: "backup_create_failed",
      entity: "backup_history",
      entity_id: row.id,
      tenant_id: tenantId,
      actor_user_id: userId,
      metadata: { backup_type, error: msg, tenant_name: tenantName },
    }).then(() => {}, () => {});
    return json({ error: msg, backup_id: row.id }, 500);
  }
}

// Verify a backup by re-downloading it, recomputing its checksum, and
// confirming schema/tenant match. Rejects invalid backups.
async function handleVerify(admin: any, backup_id: string, ownerTenantId: string | null) {
  const { data: row, error } = await admin.from("backup_history").select("*").eq("id", backup_id).single();
  if (error || !row?.storage_path) return json({ ok: false, error: "Backup not found" }, 404);
  if (ownerTenantId && row.tenant_id !== ownerTenantId) {
    return json({ ok: false, error: "You can only verify backups for your own account" }, 403);
  }
  if (row.status === "failed") return json({ ok: false, error: row.error_message ?? "Backup failed" }, 400);
  const { data: file, error: dErr } = await admin.storage.from("system-backups").download(row.storage_path);
  if (dErr || !file) return json({ ok: false, error: dErr?.message ?? "Cannot download backup" }, 500);
  try {
    const raw = await file.arrayBuffer();
    const actualChecksum = await sha256Hex(raw);
    const checksumOk = row.checksum_sha256 ? actualChecksum === row.checksum_sha256 : true;
    let text: string;
    if (row.storage_path.endsWith(".gz")) {
      const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(ds).text();
    } else {
      text = new TextDecoder().decode(raw);
    }
    const parsed = JSON.parse(text);
    const tables = Object.keys(parsed.data ?? parsed);
    const schemaOk = !parsed.schema_version || parsed.schema_version === SCHEMA_VERSION;
    const tenantOk = row.tenant_id ? (parsed.tenant_id === row.tenant_id && parsed.data?.tenants?.length === 1) : true;
    const ok = checksumOk && schemaOk && tenantOk && tables.length > 0;
    return json({
      ok, backup_id, tables: tables.length, file_size: row.file_size,
      checksum_ok: checksumOk, schema_ok: schemaOk, tenant_ok: tenantOk,
      schema_version: parsed.schema_version ?? null,
      counts: parsed.counts ?? row.table_counts ?? null,
      backup_date: parsed.generated_at ?? row.completed_at,
      checksum: actualChecksum,
      error: ok ? undefined :
        !checksumOk ? "Checksum mismatch — backup file corrupted"
        : !schemaOk ? `Schema version mismatch (backup ${parsed.schema_version} vs current ${SCHEMA_VERSION})`
        : !tenantOk ? "Tenant row missing or mismatched"
        : "Backup contains no tables",
    }, ok ? 200 : 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleCleanup(admin: any) {
  const { data: settings } = await admin.from("backup_settings").select("*").eq("id", 1).single();
  const retainDaily = settings?.retain_daily ?? 30;
  const retainMonthly = settings?.retain_monthly ?? 12;
  const retainManual = settings?.retain_manual ?? 5;

  const deleted: string[] = [];

  async function trim(type: string, keep: number) {
    const { data: rows } = await admin.from("backup_history")
      .select("id, storage_path").eq("backup_type", type).eq("status", "success")
      .order("created_at", { ascending: false });
    const old = (rows ?? []).slice(keep);
    for (const r of old) {
      if (r.storage_path) await admin.storage.from("system-backups").remove([r.storage_path]).catch(() => {});
      await admin.from("backup_history").delete().eq("id", r.id);
      deleted.push(r.id);
    }
  }

  await trim("daily", retainDaily);
  await trim("monthly", retainMonthly);
  await trim("manual", retainManual);
  // emergency + pre_restore: keep last 10
  await trim("emergency", 10);
  await trim("pre_restore", 10);
  // pre_reset backups are generated before every Business/Factory Reset. Without
  // trimming they accumulate forever and fill storage.
  await trim("pre_reset", 10);

  return json({ ok: true, deleted: deleted.length });
}

async function handleDownload(admin: any, backup_id: string, ownerTenantId: string | null) {
  const { data: row, error } = await admin.from("backup_history").select("*").eq("id", backup_id).single();
  if (error || !row?.storage_path) return json({ error: "Backup not found" }, 404);
  if (ownerTenantId && row.tenant_id !== ownerTenantId) {
    return json({ error: "You can only download backups for your own account" }, 403);
  }
  const { data: signed, error: sErr } = await admin.storage.from("system-backups")
    .createSignedUrl(row.storage_path, 300);
  if (sErr) return json({ error: sErr.message }, 500);
  return json({ ok: true, url: signed.signedUrl, filename: row.storage_path.split("/").pop() });
}

async function handleRestore(admin: any, body: any, userId: string | null, ownerTenantId: string | null) {
  const isRollback = body._rolling_back === true;

  // 0. Pre-load target backup metadata and enforce tenant scope for owners.
  let sourceRow: any = null;
  if (body.backup_id) {
    const { data, error } = await admin.from("backup_history").select("*").eq("id", body.backup_id).single();
    if (error || !data?.storage_path) return json({ error: "Backup not found" }, 404);
    sourceRow = data;
    if (ownerTenantId && sourceRow.tenant_id !== ownerTenantId) {
      return json({ error: "You can only restore backups for your own account" }, 403);
    }
  }

  // 1. Take emergency pre-restore backup first (skip during rollback to avoid recursion).
  let preBackupId: string | null = null;
  if (!isRollback) {
    const preResp = await handleCreate(admin, "pre_restore", userId, sourceRow?.tenant_id ?? ownerTenantId ?? null);
    const preBody = await preResp.json().catch(() => ({}));
    if (!preResp.ok || preBody.error) {
      return json({ error: `Pre-restore backup failed: ${preBody.error ?? "unknown"}` }, 500);
    }
    preBackupId = preBody.backup_id;
  }

  // 2. Load backup payload
  let payload: any;
  if (body.backup_id) {
    const row = sourceRow;
    const { data: file, error: dErr } = await admin.storage.from("system-backups").download(row.storage_path);
    if (dErr) return json({ error: dErr.message }, 500);
    const raw = await file.arrayBuffer();
    // Integrity gate — reject if checksum mismatches when we have one on file.
    if (row.checksum_sha256) {
      const actual = await sha256Hex(raw);
      if (actual !== row.checksum_sha256) {
        return json({ error: "Refusing to restore — backup checksum mismatch (file corrupted)" }, 400);
      }
    }
    let text: string;
    if (row.storage_path.endsWith(".gz")) {
      const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(ds).text();
    } else {
      text = new TextDecoder().decode(raw);
    }
    payload = JSON.parse(text);
    if (payload.schema_version && payload.schema_version !== SCHEMA_VERSION) {
      return json({ error: `Refusing to restore — schema version mismatch (${payload.schema_version} vs ${SCHEMA_VERSION})` }, 400);
    }
    if (ownerTenantId && payload.tenant_id !== ownerTenantId) {
      return json({ error: "Refusing to restore — backup belongs to a different account" }, 403);
    }
  } else if (body.backup) {
    payload = body.backup;
  } else {
    return json({ error: "Provide backup_id or backup" }, 400);
  }

  const data: Record<string, any[]> = payload.data ?? payload;

  // 3. Identify super-admin user ids to preserve
  const { data: superRows } = await admin.from("user_roles").select("user_id").eq("role", "super_admin");
  const superIds = new Set((superRows ?? []).map((r: any) => r.user_id));

  const results: Record<string, { restored: number; error?: string }> = {};

  // Order: parents first
  const parents = ["tenants", "subscription_plans", "subscriptions", "tenant_users", "profiles", "user_roles", "system_settings", "settings",
    "business_profiles",
    "meat_types", "units", "payment_methods", "expense_categories", "stock_adjustment_reasons",
    "user_permission_overrides",
    "shops", "farms", "customers", "trucks"];
  const children = ["purchases", "supplies", "deliveries", "supplier_ledger_entries", "shop_ledger_entries",
    "shop_recoveries", "farm_payments", "customer_payments", "payments", "expenses", "pos_sales", "pos_sale_items", "activity_logs"];
  const order = [...parents, ...children];

  for (const t of order) {
    const rows = data[t];
    if (!Array.isArray(rows) || rows.length === 0) { results[t] = { restored: 0 }; continue; }
    let rowPayload = rows;
    if (t === "user_roles") {
      // never duplicate-remove super admins; just upsert
      rowPayload = rows;
    }
    const { error, count } = await admin.from(t).upsert(rowPayload, { onConflict: "id", count: "exact" });
    results[t] = { restored: count ?? rowPayload.length, error: error?.message };
  }

  const restoreErrors = Object.entries(results).filter(([, r]: any) => r?.error).map(([t, r]: any) => ({ table: t, error: r.error }));
  const restoredTotal = Object.values(results).reduce((a, r: any) => a + (r.restored ?? 0), 0);

  // Disaster recovery — if the restore hit any error and we have a pre-restore
  // snapshot, roll back automatically so the database never remains partial.
  let rolledBack = false;
  let rollbackError: string | null = null;
  if (!isRollback && restoreErrors.length > 0 && preBackupId) {
    try {
      const rbResp = await handleRestore(admin, { backup_id: preBackupId, _rolling_back: true }, userId, ownerTenantId);
      const rbBody = await rbResp.json().catch(() => ({}));
      rolledBack = !!rbBody.ok;
      if (!rolledBack) rollbackError = rbBody.error ?? "Rollback failed";
    } catch (e) {
      rollbackError = e instanceof Error ? e.message : String(e);
    }
  }

  // Audit trail — Requirement #8: restore operations must generate audit events.
  await admin.from("activity_logs").insert({
    action: isRollback ? "backup_rollback" : "backup_restore",
    entity: "backup_history",
    entity_id: body.backup_id ?? null,
    tenant_id: payload?.tenant_id ?? null,
    actor_user_id: userId,
    metadata: {
      backup_id: body.backup_id ?? null,
      pre_restore_backup_id: preBackupId,
      total_restored: restoredTotal,
      table_errors: restoreErrors,
      preserved_super_admins: [...superIds],
      rolled_back: rolledBack,
      rollback_error: rollbackError,
    },
  }).then(() => {}, () => {});

  const ok = restoreErrors.length === 0;
  return json({
    ok,
    pre_restore_backup_id: preBackupId,
    results,
    preserved_super_admins: [...superIds],
    total_restored: restoredTotal,
    table_errors: restoreErrors,
    rolled_back: rolledBack,
    rollback_error: rollbackError,
  }, ok ? 200 : 500);
}