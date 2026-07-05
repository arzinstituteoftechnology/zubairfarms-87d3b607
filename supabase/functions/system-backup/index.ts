import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tables that hold business data — included in every backup snapshot.
const BUSINESS_TABLES = [
  "shops", "farms", "customers", "trucks",
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

type Action =
  | { action: "create"; backup_type?: "daily" | "manual" | "monthly" | "emergency" | "pre_restore" | "pre_reset"; tenant_id?: string | null }
  | { action: "verify"; backup_id: string }
  | { action: "restore"; backup_id?: string; backup?: Record<string, any[]>; preserve_super_admin?: boolean }
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
    if (!isCron) {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Not authenticated" }, 401);
      const { data: roleRow } = await admin
        .from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
      if (!roleRow) return json({ error: "Forbidden — super admin only" }, 403);
      userId = user.id;
    }

    const body = (await req.json().catch(() => ({}))) as Action;

    if (body.action === "create") {
      return await handleCreate(admin, body.backup_type ?? "manual", userId, body.tenant_id ?? null);
    }
    if (body.action === "verify") {
      return await handleVerify(admin, body.backup_id);
    }
    if (body.action === "cleanup") {
      return await handleCleanup(admin);
    }
    if (body.action === "download") {
      return await handleDownload(admin, body.backup_id);
    }
    if (body.action === "restore") {
      return await handleRestore(admin, body, userId);
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
      counts,
      data: snap,
    };
    const body = JSON.stringify(payload);
    // Gzip-compress so backups stay small on storage / downloads.
    const gz = new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"));
    const gzBuf = await new Response(gz).arrayBuffer();
    const blob = new Blob([gzBuf], { type: "application/gzip" });

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
      errors: tableErrCount ? errors : undefined,
    };

    await admin.from("backup_history").update({
      status: tableErrCount ? "warning" : "success",
      storage_path: path,
      file_size: gzBuf.byteLength,
      backup_name: backupName,
      table_counts: counts,
      health,
      completed_at: new Date().toISOString(),
    }).eq("id", row.id);

    // Trigger cleanup async (don't block)
    handleCleanup(admin).catch(() => {});

    return json({ ok: true, backup_id: row.id, path, backup_name: backupName, size: gzBuf.byteLength, counts, health, tenant_id: tenantId, tenant_name: tenantName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("backup_history").update({
      status: "failed", error_message: msg, completed_at: new Date().toISOString(),
    }).eq("id", row.id);
    return json({ error: msg, backup_id: row.id }, 500);
  }
}

// Verify a backup by re-downloading it and confirming it parses and contains the tenant.
async function handleVerify(admin: any, backup_id: string) {
  const { data: row, error } = await admin.from("backup_history").select("*").eq("id", backup_id).single();
  if (error || !row?.storage_path) return json({ ok: false, error: "Backup not found" }, 404);
  if (row.status === "failed") return json({ ok: false, error: row.error_message ?? "Backup failed" }, 400);
  const { data: file, error: dErr } = await admin.storage.from("system-backups").download(row.storage_path);
  if (dErr || !file) return json({ ok: false, error: dErr?.message ?? "Cannot download backup" }, 500);
  try {
    let text: string;
    if (row.storage_path.endsWith(".gz")) {
      const ds = file.stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(ds).text();
    } else {
      text = await file.text();
    }
    const parsed = JSON.parse(text);
    const tables = Object.keys(parsed.data ?? parsed);
    if (!tables.length) return json({ ok: false, error: "Backup contains no tables" }, 400);
    if (row.tenant_id && !(parsed.data?.tenants?.length)) return json({ ok: false, error: "Tenant row missing from backup" }, 400);
    return json({ ok: true, backup_id, tables: tables.length, file_size: row.file_size });
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

  return json({ ok: true, deleted: deleted.length });
}

async function handleDownload(admin: any, backup_id: string) {
  const { data: row, error } = await admin.from("backup_history").select("*").eq("id", backup_id).single();
  if (error || !row?.storage_path) return json({ error: "Backup not found" }, 404);
  const { data: signed, error: sErr } = await admin.storage.from("system-backups")
    .createSignedUrl(row.storage_path, 300);
  if (sErr) return json({ error: sErr.message }, 500);
  return json({ ok: true, url: signed.signedUrl, filename: row.storage_path.split("/").pop() });
}

async function handleRestore(admin: any, body: any, userId: string | null) {
  // 1. Take emergency pre-restore backup first
  const preResp = await handleCreate(admin, "pre_restore", userId);
  const preBody = await preResp.json().catch(() => ({}));
  if (!preResp.ok || preBody.error) {
    return json({ error: `Pre-restore backup failed: ${preBody.error ?? "unknown"}` }, 500);
  }

  // 2. Load backup payload
  let payload: any;
  if (body.backup_id) {
    const { data: row, error } = await admin.from("backup_history").select("*").eq("id", body.backup_id).single();
    if (error || !row?.storage_path) return json({ error: "Backup not found" }, 404);
    const { data: file, error: dErr } = await admin.storage.from("system-backups").download(row.storage_path);
    if (dErr) return json({ error: dErr.message }, 500);
    let text: string;
    if (row.storage_path.endsWith(".gz")) {
      const ds = file.stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(ds).text();
    } else {
      text = await file.text();
    }
    payload = JSON.parse(text);
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
    "shops", "farms", "customers", "trucks"];
  const children = ["purchases", "supplies", "deliveries", "supplier_ledger_entries", "shop_ledger_entries",
    "shop_recoveries", "farm_payments", "customer_payments", "payments", "expenses", "pos_sales", "pos_sale_items", "activity_logs"];
  const order = [...parents, ...children];

  for (const t of order) {
    const rows = data[t];
    if (!Array.isArray(rows) || rows.length === 0) { results[t] = { restored: 0 }; continue; }
    let payload = rows;
    if (t === "user_roles") {
      // never duplicate-remove super admins; just upsert
      payload = rows;
    }
    const { error, count } = await admin.from(t).upsert(payload, { onConflict: "id", count: "exact" });
    results[t] = { restored: count ?? payload.length, error: error?.message };
  }

  return json({ ok: true, pre_restore_backup_id: preBody.backup_id, results, preserved_super_admins: [...superIds] });
}