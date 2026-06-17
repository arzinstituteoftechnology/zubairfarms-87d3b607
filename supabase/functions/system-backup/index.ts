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
  "activity_logs",
];

// System tables included so settings/users/roles survive a restore.
const SYSTEM_TABLES = [
  "tenants", "tenant_users", "subscriptions", "subscription_plans",
  "user_roles", "profiles", "system_settings", "settings",
];

const ALL_TABLES = [...BUSINESS_TABLES, ...SYSTEM_TABLES];

type Action =
  | { action: "create"; backup_type?: "daily" | "manual" | "monthly" | "emergency" | "pre_restore" }
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
      return await handleCreate(admin, body.backup_type ?? "manual", userId);
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

async function snapshot(admin: any) {
  const out: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const t of ALL_TABLES) {
    try {
      const { data, error } = await admin.from(t).select("*");
      if (error) { errors[t] = error.message; continue; }
      out[t] = data ?? [];
      counts[t] = (data ?? []).length;
    } catch (e) {
      errors[t] = e instanceof Error ? e.message : String(e);
    }
  }
  return { snapshot: out, counts, errors };
}

async function handleCreate(admin: any, backup_type: string, userId: string | null) {
  // 1. Insert pending row
  const { data: row, error: insErr } = await admin.from("backup_history")
    .insert({ backup_type, status: "pending", created_by: userId })
    .select("*").single();
  if (insErr) return json({ error: insErr.message }, 500);

  try {
    const { snapshot: snap, counts, errors } = await snapshot(admin);

    const payload = {
      generated_at: new Date().toISOString(),
      backup_type,
      app: "MeatFlow ERP",
      version: 1,
      counts,
      data: snap,
    };
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "application/json" });

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const path = `${yyyy}/${mm}/${dd}/${backup_type}-${stamp}.json`;

    const { error: upErr } = await admin.storage.from("system-backups")
      .upload(path, blob, { contentType: "application/json", upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    const tableErrCount = Object.keys(errors).length;
    const health = {
      tables_ok: Object.keys(counts).length,
      tables_failed: tableErrCount,
      total_records: Object.values(counts).reduce((a, b) => a + b, 0),
      errors: tableErrCount ? errors : undefined,
    };

    await admin.from("backup_history").update({
      status: tableErrCount ? "warning" : "success",
      storage_path: path,
      file_size: body.length,
      table_counts: counts,
      health,
      completed_at: new Date().toISOString(),
    }).eq("id", row.id);

    // Trigger cleanup async (don't block)
    handleCleanup(admin).catch(() => {});

    return json({ ok: true, backup_id: row.id, path, size: body.length, counts, health });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("backup_history").update({
      status: "failed", error_message: msg, completed_at: new Date().toISOString(),
    }).eq("id", row.id);
    return json({ error: msg, backup_id: row.id }, 500);
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
    payload = JSON.parse(await file.text());
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