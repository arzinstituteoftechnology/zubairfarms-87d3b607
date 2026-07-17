import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function nextRunAt(schedule: string, from: Date): Date | null {
  const d = new Date(from);
  switch (schedule) {
    case "hourly":    d.setUTCHours(d.getUTCHours() + 1); return d;
    case "every_6h":  d.setUTCHours(d.getUTCHours() + 6); return d;
    case "daily":     d.setUTCDate(d.getUTCDate() + 1); return d;
    case "weekly":    d.setUTCDate(d.getUTCDate() + 7); return d;
    case "monthly":   d.setUTCMonth(d.getUTCMonth() + 1); return d;
    default: return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const CRON_SECRET = Deno.env.get("CRON_SHARED_SECRET") ?? "meatflow-cron-23-59";
    if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    const now = new Date();
    const { data: due } = await admin
      .from("tenant_backup_settings")
      .select("*")
      .neq("schedule", "off")
      .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`);

    const triggered: any[] = [];
    for (const s of due ?? []) {
      try {
        const resp = await fetch(`${url}/functions/v1/system-backup`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
          body: JSON.stringify({ action: "create", backup_type: "manual", tenant_id: s.tenant_id }),
        });
        const body = await resp.json().catch(() => ({}));
        const next = nextRunAt(s.schedule, now);
        await admin.from("tenant_backup_settings").update({
          last_run_at: now.toISOString(),
          next_run_at: next ? next.toISOString() : null,
        }).eq("tenant_id", s.tenant_id);
        triggered.push({ tenant_id: s.tenant_id, ok: resp.ok, backup_id: body.backup_id, error: body.error });
      } catch (e) {
        triggered.push({ tenant_id: s.tenant_id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return new Response(JSON.stringify({ ok: true, triggered }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});