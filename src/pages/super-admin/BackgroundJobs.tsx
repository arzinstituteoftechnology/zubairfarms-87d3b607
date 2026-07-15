import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { RefreshCw, Play, RotateCcw, XCircle, Trash2, Zap, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Job = {
  id: string; tenant_id: string | null; job_type: string; payload: any;
  idempotency_key: string | null; priority: number; status: string;
  attempts: number; max_attempts: number;
  next_run_at: string; started_at: string | null; finished_at: string | null;
  duration_ms: number | null; last_error: string | null;
  progress: number; progress_message: string | null;
  worker_id: string | null; created_at: string;
};

const STATUSES = ["all","queued","running","succeeded","failed","cancelled","dead"];
const PRIORITY_LABEL: Record<number,string> = { 1: "Critical", 2: "High", 3: "Normal", 4: "Low" };
const PRIORITY_COLOR: Record<number,string> = {
  1: "bg-red-500/20 text-red-400 border-red-500/40",
  2: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  3: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  4: "bg-zinc-500/20 text-zinc-400 border-zinc-500/40",
};
const STATUS_COLOR: Record<string,string> = {
  queued: "bg-zinc-500/20 text-zinc-300",
  running: "bg-blue-500/20 text-blue-300 animate-pulse",
  succeeded: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-amber-500/20 text-amber-300",
  cancelled: "bg-zinc-500/20 text-zinc-400",
  dead: "bg-red-500/20 text-red-300",
};

export default function BackgroundJobsPage() {
  const [tab, setTab] = useState<"jobs"|"dead">("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dead, setDead] = useState<any[]>([]);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [invoking, setInvoking] = useState(false);

  const load = async () => {
    let query = supabase.from("background_jobs").select("*")
      .order("created_at", { ascending: false }).limit(300);
    if (status !== "all") query = query.eq("status", status as any);
    if (type !== "all") query = query.eq("job_type", type);
    const { data } = await query;
    setJobs((data ?? []) as Job[]);

    const { data: dl } = await supabase.from("background_jobs_dead_letter")
      .select("*").order("moved_at", { ascending: false }).limit(200);
    setDead(dl ?? []);
  };

  useEffect(() => { load(); }, [status, type]);

  useEffect(() => {
    const ch = supabase.channel("bg-jobs-admin" + "-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "background_jobs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [status, type]);

  const filtered = useMemo(() => {
    if (!q) return jobs;
    const s = q.toLowerCase();
    return jobs.filter(j =>
      j.job_type.toLowerCase().includes(s) ||
      (j.last_error ?? "").toLowerCase().includes(s) ||
      (j.tenant_id ?? "").toLowerCase().includes(s) ||
      (j.idempotency_key ?? "").toLowerCase().includes(s)
    );
  }, [jobs, q]);

  const jobTypes = useMemo(() => Array.from(new Set(jobs.map(j => j.job_type))), [jobs]);

  const stats = useMemo(() => ({
    queued: jobs.filter(j => j.status === "queued").length,
    running: jobs.filter(j => j.status === "running").length,
    succeeded: jobs.filter(j => j.status === "succeeded").length,
    failed: jobs.filter(j => j.status === "failed").length,
    dead: dead.length,
  }), [jobs, dead]);

  const runScheduler = async () => {
    setInvoking(true);
    const { data, error } = await supabase.functions.invoke("job-scheduler", { body: {} });
    setInvoking(false);
    if (error) toast.error(error.message);
    else toast.success(`Scheduler tick: processed ${data?.processed ?? 0}`);
  };

  const act = async (rpc: string, id: string, ok: string) => {
    const { error } = await supabase.rpc(rpc as any, { _id: id });
    if (error) toast.error(error.message); else toast.success(ok);
    load();
  };

  const seed = async (jobType: string, priority = 3) => {
    const { error } = await supabase.rpc("enqueue_job", {
      _job_type: jobType, _tenant_id: null, _payload: {} as any,
      _priority: priority as any, _idempotency_key: `manual-${jobType}-${Date.now()}`,
      _delay_seconds: 0, _max_attempts: 3, _retention_hours: 24,
    });
    if (error) toast.error(error.message);
    else { toast.success(`Enqueued ${jobType}`); load(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Zap className="h-6 w-6" /> Background Jobs
        </h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          <Button size="sm" onClick={runScheduler} disabled={invoking}>
            <Play className="h-4 w-4 mr-1" /> {invoking ? "Running…" : "Run scheduler now"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Queued" value={stats.queued} />
        <Stat label="Running" value={stats.running} tone="blue" />
        <Stat label="Succeeded" value={stats.succeeded} tone="green" />
        <Stat label="Failed" value={stats.failed} tone="amber" />
        <Stat label="Dead-letter" value={stats.dead} tone="red" />
      </div>

      <Card className="p-3 flex flex-wrap gap-2 bg-zinc-900 border-zinc-800">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs text-zinc-400 uppercase tracking-wide">Seed:</span>
          <Button variant="outline" size="sm" onClick={() => seed("email_queue", 2)}>email_queue</Button>
          <Button variant="outline" size="sm" onClick={() => seed("notification_cleanup", 4)}>notification_cleanup</Button>
          <Button variant="outline" size="sm" onClick={() => seed("job_retention_cleanup", 4)}>job_retention_cleanup</Button>
          <Button variant="outline" size="sm" onClick={() => seed("stuck_job_recovery", 2)}>stuck_job_recovery</Button>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="dead">Dead-letter ({dead.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "jobs" && (
        <>
          <Card className="p-3 flex flex-wrap gap-2 items-center bg-zinc-900 border-zinc-800">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {jobTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="max-w-xs" placeholder="Search type/tenant/error…" value={q} onChange={e => setQ(e.target.value)} />
          </Card>

          <Card className="divide-y divide-zinc-800 bg-zinc-900 border-zinc-800">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No jobs match filters</div>
            ) : filtered.map(j => (
              <div key={j.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge className={STATUS_COLOR[j.status]}>{j.status}</Badge>
                      <Badge variant="outline" className={PRIORITY_COLOR[j.priority]}>{PRIORITY_LABEL[j.priority]}</Badge>
                      <span className="font-mono text-sm text-zinc-200">{j.job_type}</span>
                      {j.tenant_id && <span className="text-[10px] text-zinc-500">tenant:{j.tenant_id.slice(0,8)}</span>}
                      <span className="text-[10px] text-zinc-500">attempt {j.attempts}/{j.max_attempts}</span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      created {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}
                      {j.started_at && <> · started {formatDistanceToNow(new Date(j.started_at), { addSuffix: true })}</>}
                      {j.duration_ms != null && <> · {j.duration_ms}ms</>}
                      {j.worker_id && <> · worker {j.worker_id}</>}
                    </div>
                    {j.status === "running" && (
                      <div className="mt-2 space-y-1">
                        <Progress value={Number(j.progress) || 0} className="h-1.5" />
                        {j.progress_message && <div className="text-[11px] text-zinc-400">{j.progress_message}</div>}
                      </div>
                    )}
                    {j.last_error && (
                      <div className="mt-2 text-xs text-amber-300 flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="font-mono break-all">{j.last_error}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {j.status === "queued" && (
                      <Button size="sm" variant="outline" onClick={() => act("run_job_now", j.id, "Scheduled to run now")}><Play className="h-3.5 w-3.5" /></Button>
                    )}
                    {(j.status === "failed" || j.status === "dead" || j.status === "cancelled" || j.status === "succeeded") && (
                      <Button size="sm" variant="outline" onClick={() => act("retry_job", j.id, "Retry queued")}><RotateCcw className="h-3.5 w-3.5" /></Button>
                    )}
                    {(j.status === "queued" || j.status === "running") && (
                      <Button size="sm" variant="outline" onClick={() => act("cancel_job", j.id, "Cancelled")}><XCircle className="h-3.5 w-3.5" /></Button>
                    )}
                    {["succeeded","failed","dead","cancelled"].includes(j.status) && (
                      <Button size="sm" variant="outline" onClick={() => act("delete_job", j.id, "Deleted")}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {tab === "dead" && (
        <Card className="divide-y divide-zinc-800 bg-zinc-900 border-zinc-800">
          {dead.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">Dead-letter queue is empty</div>
          ) : dead.map(d => (
            <div key={d.id} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-red-500/20 text-red-300">DEAD</Badge>
                <span className="font-mono text-sm">{d.job_type}</span>
                <span className="text-[10px] text-zinc-500">
                  moved {formatDistanceToNow(new Date(d.moved_at), { addSuffix: true })} · {d.attempts} attempts
                </span>
              </div>
              {d.last_error && <div className="text-xs text-amber-300 font-mono break-all">{d.last_error}</div>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default"|"blue"|"green"|"amber"|"red" }) {
  const toneClass = {
    default: "text-zinc-100",
    blue: "text-blue-400",
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
  }[tone];
  return (
    <Card className="p-4 bg-zinc-900 border-zinc-800">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-3xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}