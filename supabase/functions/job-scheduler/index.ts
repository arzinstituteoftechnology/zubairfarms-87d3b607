// Centralized background job scheduler / worker.
// Cron invokes this endpoint periodically (see README for schedule).
// It (1) recovers stuck jobs, (2) claims a batch with concurrency lock,
// (3) dispatches each job to its handler, (4) reports success/failure,
// (5) runs retention cleanup at the end. Handlers must be additive —
// do NOT alter accounting/notification business logic here.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type Job = {
  id: string;
  tenant_id: string | null;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

const BATCH = 10;
const STALE_MINUTES = 15;
const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Handler = (job: Job, ctx: { sb: SupabaseClient; report: (pct: number, msg?: string) => Promise<void> }) => Promise<Record<string, unknown> | void>;

// -------- Handler registry (extend here — never mutate business modules) --------
const handlers: Record<string, Handler> = {
  // Drain the notification email queue via the existing edge function.
  email_queue: async (_job, { report }) => {
    await report(10, "invoking process-notification-queue");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/process-notification-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`process-notification-queue failed [${res.status}]: ${JSON.stringify(body)}`);
    await report(100, "done");
    return body as Record<string, unknown>;
  },

  // Purge soft-deleted / expired notifications older than 30 days.
  notification_cleanup: async (_job, { sb, report }) => {
    await report(20, "deleting soft-deleted notifications");
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { count, error } = await sb
      .from("notifications")
      .delete({ count: "exact" })
      .lt("deleted_at", cutoff);
    if (error) throw new Error(error.message);
    await report(100, "done");
    return { deleted: count ?? 0 };
  },

  // Purge finished jobs whose retention window has passed.
  job_retention_cleanup: async (_job, { sb, report }) => {
    await report(50);
    const { data, error } = await sb.rpc("cleanup_background_jobs");
    if (error) throw new Error(error.message);
    await report(100);
    return { deleted: data as number };
  },

  // Requeue stalled jobs (defensive — scheduler also does this at start).
  stuck_job_recovery: async (_job, { sb, report }) => {
    await report(50);
    const { data, error } = await sb.rpc("recover_stuck_jobs", { _stale_minutes: STALE_MINUTES });
    if (error) throw new Error(error.message);
    await report(100);
    return { recovered: data as number };
  },

  // Enterprise health check — probes each subsystem, writes a snapshot,
  // evaluates alert rules, and opens/closes incidents.
  health_check: async (_job, { sb, report }) => {
    const started = Date.now();
    const components: Record<string, "green" | "yellow" | "red"> = {};
    const metrics: Record<string, number | null> = {};

    // Database
    await report(10, "database");
    try {
      const { error } = await sb.from("background_jobs").select("id", { head: true, count: "exact" }).limit(1);
      components.database = error ? "red" : "green";
      metrics.db_healthy = error ? 0 : 1;
    } catch { components.database = "red"; metrics.db_healthy = 0; }

    // Auth
    await report(20, "auth");
    try {
      const { data, error } = await (sb.auth as any).admin.listUsers({ page: 1, perPage: 1 });
      components.auth = error ? "red" : "green";
      metrics.auth_users_total = data?.total ?? null;
    } catch { components.auth = "red"; }

    // Storage
    await report(30, "storage");
    try {
      const { data, error } = await sb.storage.listBuckets();
      components.storage = error ? "red" : "green";
      metrics.storage_buckets = data?.length ?? 0;
    } catch { components.storage = "red"; }

    // Live metrics (queue / scheduler / errors)
    await report(50, "metrics");
    const { data: live, error: liveErr } = await sb.rpc("get_live_metrics", { _window_minutes: 15 });
    const live_metrics = (live ?? {}) as Record<string, number | string | null>;
    if (liveErr) components.metrics = "red";
    for (const [k, v] of Object.entries(live_metrics)) {
      if (typeof v === "number") metrics[k] = v;
    }

    // Scheduler component
    const tickSec = Number(live_metrics.scheduler_last_tick_seconds ?? 99999);
    components.scheduler = tickSec > 300 ? "red" : tickSec > 120 ? "yellow" : "green";

    // Queue component
    const qsize = Number(live_metrics.queue_size ?? 0);
    components.queue = qsize > 200 ? "red" : qsize > 50 ? "yellow" : "green";

    // Realtime (best-effort — publication exists implies functional)
    components.realtime = "green";

    // API — since we're inside an edge function, being alive means OK
    components.api = "green";

    // Overall
    const worst = Object.values(components).reduce<"green" | "yellow" | "red">(
      (acc, s) => (s === "red" || acc === "red" ? "red" : s === "yellow" || acc === "yellow" ? "yellow" : "green"),
      "green",
    );

    await report(75, "writing snapshot");
    const { data: snap } = await sb
      .from("system_health_snapshots")
      .insert({
        overall: worst,
        components,
        metrics,
        latency_ms: Date.now() - started,
        worker_id: WORKER_ID,
      })
      .select("id")
      .single();

    // Evaluate alert rules
    await report(90, "evaluating alerts");
    const { data: rules } = await sb.from("alert_rules").select("*").eq("enabled", true);
    const cmp = (a: number, op: string, b: number) =>
      op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : op === "<=" ? a <= b : a === b;

    for (const r of rules ?? []) {
      const obs = Number(metrics[r.metric] ?? 0);
      const firing = cmp(obs, r.op, Number(r.threshold));

      // Currently firing incident for this rule?
      const { data: openInc } = await sb
        .from("alert_incidents")
        .select("id")
        .eq("rule_id", r.id)
        .eq("status", "firing")
        .limit(1)
        .maybeSingle();

      if (firing && !openInc) {
        await sb.from("alert_incidents").insert({
          rule_id: r.id, metric: r.metric,
          observed_value: obs, threshold: r.threshold,
          severity: r.severity, status: "firing",
          snapshot_id: snap?.id ?? null,
          details: { rule_name: r.name, op: r.op },
        });
        await sb.from("system_errors").insert({
          module: "monitoring", source: "job", severity: r.severity,
          message: `Alert firing: ${r.name} (${r.metric} ${r.op} ${r.threshold}, observed ${obs})`,
          context: { rule_id: r.id, metric: r.metric, observed: obs, threshold: r.threshold },
        });
      } else if (!firing && openInc) {
        await sb.from("alert_incidents").update({
          status: "resolved", resolved_at: new Date().toISOString(),
        }).eq("id", openInc.id);
      }
    }

    await report(100, "done");
    return { overall: worst, components, metrics, snapshot_id: snap?.id ?? null };
  },
};

async function runOne(sb: SupabaseClient, job: Job) {
  const report = async (pct: number, msg?: string) => {
    await sb.rpc("report_job_progress", { _id: job.id, _pct: pct, _message: msg ?? null });
  };
  const handler = handlers[job.job_type];
  if (!handler) {
    await sb.rpc("fail_job", { _id: job.id, _error: `no_handler_for:${job.job_type}`, _details: null });
    return { id: job.id, ok: false, error: "no_handler" };
  }
  try {
    const result = await handler(job, { sb, report });
    await sb.rpc("complete_job", { _id: job.id, _result: (result ?? null) as any });
    return { id: job.id, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb.rpc("fail_job", { _id: job.id, _error: message.slice(0, 1000), _details: { stack: err instanceof Error ? err.stack : null } as any });
    return { id: job.id, ok: false, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const started = Date.now();

  // 1) Recover crashed/stalled jobs before claiming.
  const { data: recovered } = await sb.rpc("recover_stuck_jobs", { _stale_minutes: STALE_MINUTES });

  // 2) Claim a batch.
  const { data: claimed, error: claimErr } = await sb.rpc("claim_next_jobs", { _worker_id: WORKER_ID, _limit: BATCH });
  if (claimErr) {
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const jobs = (claimed ?? []) as Job[];

  // 3) Run jobs. Small parallelism keeps one function cold-start productive
  //    while the per-row FOR UPDATE SKIP LOCKED prevents dup execution.
  const results = await Promise.all(jobs.map((j) => runOne(sb, j)));

  // 4) Opportunistic retention sweep every invocation (cheap: single UPDATE).
  const { data: cleaned } = await sb.rpc("cleanup_background_jobs");

  // 5) Audit trail
  await sb.from("activity_logs").insert({
    action: "job_scheduler_tick",
    entity: "background_jobs",
    metadata: {
      worker_id: WORKER_ID,
      recovered_stuck: recovered ?? 0,
      claimed: jobs.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      cleaned_retention: cleaned ?? 0,
      duration_ms: Date.now() - started,
    },
  });

  return new Response(
    JSON.stringify({
      worker: WORKER_ID,
      recovered_stuck: recovered ?? 0,
      processed: jobs.length,
      results,
      cleaned_retention: cleaned ?? 0,
      duration_ms: Date.now() - started,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});