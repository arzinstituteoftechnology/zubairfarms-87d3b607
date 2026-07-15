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