import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Activity, RefreshCw, Database, KeyRound, Cloud, Zap, Radio, Server,
  AlertTriangle, CheckCircle2, XCircle, Download, Printer, TimerReset, Bell,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Status = "green" | "yellow" | "red";
type Snapshot = {
  id: string; overall: Status;
  components: Record<string, Status>;
  metrics: Record<string, number>;
  latency_ms: number | null; worker_id: string | null; created_at: string;
};
type SystemError = {
  id: string; tenant_id: string | null; user_id: string | null;
  module: string; source: string; severity: "info"|"warning"|"error"|"critical";
  message: string; stack: string | null; context: any;
  request_path: string | null; status_code: number | null;
  resolved: boolean; resolved_at: string | null; created_at: string;
};
type AlertRule = {
  id: string; name: string; metric: string; op: string; threshold: number;
  severity: "info"|"warning"|"error"|"critical"; enabled: boolean; description: string | null;
};
type AlertIncident = {
  id: string; rule_id: string; metric: string;
  observed_value: number; threshold: number; severity: string;
  status: "firing"|"resolved"; fired_at: string; resolved_at: string | null;
  details: any;
};
type TimelineEvent = {
  id: string; action: string; entity: string | null;
  metadata: any; created_at: string; tenant_id: string | null;
};

const STATUS_ICON: Record<Status, JSX.Element> = {
  green: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  yellow: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  red: <XCircle className="h-4 w-4 text-red-400" />,
};
const STATUS_BG: Record<Status, string> = {
  green: "bg-emerald-500/15 border-emerald-500/40",
  yellow: "bg-amber-500/15 border-amber-500/40",
  red: "bg-red-500/15 border-red-500/40",
};
const COMPONENT_ICONS: Record<string, JSX.Element> = {
  api: <Server className="h-4 w-4" />,
  database: <Database className="h-4 w-4" />,
  auth: <KeyRound className="h-4 w-4" />,
  storage: <Cloud className="h-4 w-4" />,
  scheduler: <Zap className="h-4 w-4" />,
  queue: <Activity className="h-4 w-4" />,
  realtime: <Radio className="h-4 w-4" />,
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) { toast.info("No data to export"); return; }
  const cols = Object.keys(rows[0]);
  const body = [cols.join(","), ...rows.map(r => cols.map(c => csvEscape(r[c])).join(","))].join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function MonitoringPage() {
  const [tab, setTab] = useState<"health"|"metrics"|"errors"|"perf"|"timeline"|"alerts">("health");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [live, setLive] = useState<Record<string, number | string | null>>({});
  const [errors, setErrors] = useState<SystemError[]>([]);
  const [errStatus, setErrStatus] = useState<"all"|"unresolved">("unresolved");
  const [errSeverity, setErrSeverity] = useState<string>("all");
  const [errSearch, setErrSearch] = useState("");
  const [slowQueries, setSlowQueries] = useState<any[]>([]);
  const [longJobs, setLongJobs] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [incidents, setIncidents] = useState<AlertIncident[]>([]);

  const loadHealth = useCallback(async () => {
    const { data } = await supabase.from("system_health_snapshots").select("*")
      .order("created_at", { ascending: false }).limit(60);
    setSnapshots((data ?? []) as Snapshot[]);
  }, []);
  const loadLive = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_live_metrics", { _window_minutes: 15 });
    if (!error && data) setLive(data as any);
  }, []);
  const loadErrors = useCallback(async () => {
    let q = supabase.from("system_errors").select("*").order("created_at", { ascending: false }).limit(300);
    if (errStatus === "unresolved") q = q.eq("resolved", false);
    if (errSeverity !== "all") q = q.eq("severity", errSeverity as any);
    const { data } = await q;
    setErrors((data ?? []) as SystemError[]);
  }, [errStatus, errSeverity]);
  const loadPerf = useCallback(async () => {
    const { data: jobs } = await supabase.from("background_jobs").select("*")
      .order("duration_ms", { ascending: false, nullsFirst: false }).limit(20);
    setLongJobs(jobs ?? []);
    const { data: adjLogs } = await supabase.from("activity_logs")
      .select("action,metadata,created_at")
      .in("action", ["job_scheduler_tick", "notification_queue_processed"])
      .order("created_at", { ascending: false }).limit(10);
    setSlowQueries((adjLogs ?? []).map((r: any) => ({
      action: r.action, duration_ms: r.metadata?.duration_ms ?? null, at: r.created_at,
    })));
  }, []);
  const loadTimeline = useCallback(async () => {
    const { data } = await supabase.from("activity_logs").select("*")
      .order("created_at", { ascending: false }).limit(100);
    setTimeline((data ?? []) as TimelineEvent[]);
  }, []);
  const loadAlerts = useCallback(async () => {
    const [{ data: r }, { data: i }] = await Promise.all([
      supabase.from("alert_rules").select("*").order("created_at", { ascending: true }),
      supabase.from("alert_incidents").select("*").order("fired_at", { ascending: false }).limit(200),
    ]);
    setRules((r ?? []) as AlertRule[]);
    setIncidents((i ?? []) as AlertIncident[]);
  }, []);

  useEffect(() => {
    loadHealth(); loadLive(); loadErrors(); loadPerf(); loadTimeline(); loadAlerts();
    const t = setInterval(loadLive, 10_000);
    return () => clearInterval(t);
  }, [loadHealth, loadLive, loadErrors, loadPerf, loadTimeline, loadAlerts]);

  useEffect(() => { loadErrors(); }, [errStatus, errSeverity, loadErrors]);

  useEffect(() => {
    const ch = supabase.channel("monitoring-live" + "-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "system_health_snapshots" }, () => { loadHealth(); loadLive(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "system_errors" }, loadErrors)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_incidents" }, loadAlerts)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadHealth, loadLive, loadErrors, loadAlerts]);

  const latest = snapshots[0];
  const overall: Status = latest?.overall ?? "yellow";
  const components = latest?.components ?? {};
  const componentKeys = ["api","database","auth","storage","scheduler","queue","realtime"];

  const filteredErrors = useMemo(() => {
    if (!errSearch) return errors;
    const s = errSearch.toLowerCase();
    return errors.filter(e => e.message.toLowerCase().includes(s) || e.module.toLowerCase().includes(s));
  }, [errors, errSearch]);

  const resolveErr = async (id: string) => {
    const { error } = await supabase.rpc("resolve_system_error", { _id: id, _notes: null });
    if (error) toast.error(error.message); else { toast.success("Resolved"); loadErrors(); }
  };
  const toggleRule = async (r: AlertRule) => {
    const { error } = await supabase.from("alert_rules").update({ enabled: !r.enabled }).eq("id", r.id);
    if (error) toast.error(error.message); else loadAlerts();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Activity className="h-6 w-6" /> System Monitoring
        </h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { loadHealth(); loadLive(); loadErrors(); loadPerf(); loadTimeline(); loadAlerts(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print / PDF
          </Button>
        </div>
      </div>

      <Card className={`p-4 border ${STATUS_BG[overall]} bg-zinc-900`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            {STATUS_ICON[overall]}
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-400">Overall status</div>
              <div className="text-xl font-semibold uppercase">{overall}</div>
            </div>
          </div>
          <div className="text-xs text-zinc-400">
            Last check: {latest ? formatDistanceToNow(new Date(latest.created_at), { addSuffix: true }) : "—"}
            {latest?.latency_ms && <> · {latest.latency_ms}ms</>}
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="metrics">Live Metrics</TabsTrigger>
          <TabsTrigger value="errors">Errors ({errors.filter(e => !e.resolved).length})</TabsTrigger>
          <TabsTrigger value="perf">Performance</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({incidents.filter(i => i.status === "firing").length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "health" && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {componentKeys.map(k => {
            const s = (components[k] ?? "yellow") as Status;
            return (
              <Card key={k} className={`p-4 border bg-zinc-900 ${STATUS_BG[s]}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {COMPONENT_ICONS[k]}
                    <span className="font-medium capitalize">{k}</span>
                  </div>
                  {STATUS_ICON[s]}
                </div>
                <div className="text-xs text-zinc-400 mt-2 capitalize">{s}</div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "metrics" && (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <Metric label="Queue size" value={live.queue_size} />
            <Metric label="Running jobs" value={live.running_jobs} />
            <Metric label="Failed (15m)" value={live.failed_jobs_window} tone="amber" />
            <Metric label="Dead-letter" value={live.dead_letter_total} tone="red" />
            <Metric label="Errors (15m)" value={live.errors_window} tone="amber" />
            <Metric label="Unresolved errors" value={live.unresolved_errors} tone="red" />
            <Metric label="Requests / min" value={live.requests_last_minute} />
            <Metric label="Active users (15m)" value={live.active_users_window} />
            <Metric label="Scheduler idle (s)" value={live.scheduler_last_tick_seconds} tone={Number(live.scheduler_last_tick_seconds ?? 0) > 120 ? "red" : "green"} />
            <Metric label="Avg job duration (ms)" value={live.avg_job_duration_ms} />
            <Metric label="Max job duration (ms)" value={live.max_job_duration_ms} />
            <Metric label="Firing alerts" value={live.firing_alerts} tone={Number(live.firing_alerts ?? 0) > 0 ? "red" : "green"} />
          </div>
          <div className="text-xs text-zinc-500">
            CPU / Memory / API latency come from Lovable Cloud advanced settings; this dashboard shows application-level metrics collected in-database.
          </div>
        </>
      )}

      {tab === "errors" && (
        <>
          <Card className="p-3 flex flex-wrap gap-2 items-center bg-zinc-900 border-zinc-800">
            <Select value={errStatus} onValueChange={(v) => setErrStatus(v as any)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unresolved">Unresolved</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Select value={errSeverity} onValueChange={setErrSeverity}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["all","info","warning","error","critical"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Search…" className="max-w-xs" value={errSearch} onChange={(e) => setErrSearch(e.target.value)} />
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCsv("errors.csv", filteredErrors as any)}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </Card>
          <Card className="divide-y divide-zinc-800 bg-zinc-900 border-zinc-800">
            {filteredErrors.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No errors match your filters</div>
            ) : filteredErrors.map(e => (
              <div key={e.id} className="p-3">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge className={
                    e.severity === "critical" ? "bg-red-500/20 text-red-300"
                    : e.severity === "error"  ? "bg-amber-500/20 text-amber-300"
                    : e.severity === "warning" ? "bg-yellow-500/20 text-yellow-300"
                    : "bg-zinc-500/20 text-zinc-300"
                  }>{e.severity}</Badge>
                  <Badge variant="outline">{e.module}</Badge>
                  <Badge variant="outline">{e.source}</Badge>
                  <span className="text-[11px] text-zinc-500">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
                  {e.tenant_id && <span className="text-[10px] text-zinc-500">tenant:{e.tenant_id.slice(0,8)}</span>}
                </div>
                <div className="text-sm text-zinc-100 break-words">{e.message}</div>
                {e.stack && <pre className="mt-1 text-[11px] text-zinc-400 whitespace-pre-wrap break-all max-h-32 overflow-auto">{e.stack}</pre>}
                <div className="mt-2 flex items-center gap-2">
                  {e.resolved ? (
                    <Badge className="bg-emerald-500/20 text-emerald-300">Resolved</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => resolveErr(e.id)}>Mark resolved</Button>
                  )}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {tab === "perf" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="p-3 bg-zinc-900 border-zinc-800">
            <div className="font-medium mb-2 flex items-center gap-2"><TimerReset className="h-4 w-4" /> Longest-running jobs</div>
            <div className="divide-y divide-zinc-800 max-h-[420px] overflow-auto">
              {longJobs.length === 0 ? <div className="text-sm text-zinc-500 p-2">No data</div> : longJobs.map(j => (
                <div key={j.id} className="py-2 text-sm flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono truncate">{j.job_type}</div>
                    <div className="text-[11px] text-zinc-500">{j.status} · {new Date(j.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-zinc-300 whitespace-nowrap">{j.duration_ms ?? "—"} ms</div>
                </div>
              ))}
            </div>
            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => downloadCsv("long_jobs.csv", longJobs.map((j: any) => ({
                job_type: j.job_type, status: j.status, duration_ms: j.duration_ms, attempts: j.attempts, created_at: j.created_at,
              })))}><Download className="h-4 w-4 mr-1" /> CSV</Button>
            </div>
          </Card>
          <Card className="p-3 bg-zinc-900 border-zinc-800">
            <div className="font-medium mb-2">Recent scheduler ticks</div>
            <div className="divide-y divide-zinc-800 max-h-[420px] overflow-auto">
              {slowQueries.length === 0 ? <div className="text-sm text-zinc-500 p-2">No data</div> : slowQueries.map((r, idx) => (
                <div key={idx} className="py-2 text-sm flex justify-between gap-2">
                  <div>
                    <div className="font-mono">{r.action}</div>
                    <div className="text-[11px] text-zinc-500">{new Date(r.at).toLocaleString()}</div>
                  </div>
                  <div className="text-zinc-300 whitespace-nowrap">{r.duration_ms ?? "—"} ms</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "timeline" && (
        <>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => downloadCsv("timeline.csv", timeline.map(t => ({
              at: t.created_at, action: t.action, entity: t.entity, tenant_id: t.tenant_id, metadata: JSON.stringify(t.metadata ?? {}),
            })))}><Download className="h-4 w-4 mr-1" /> CSV</Button>
          </div>
          <Card className="divide-y divide-zinc-800 bg-zinc-900 border-zinc-800">
            {timeline.length === 0 ? <div className="p-6 text-sm text-zinc-500 text-center">No events</div> : timeline.map(t => (
              <div key={t.id} className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-[10px]">{t.action}</Badge>
                  {t.entity && <span className="text-xs text-zinc-500">{t.entity}</span>}
                  <span className="text-[11px] text-zinc-500 ml-auto">
                    {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                  </span>
                </div>
                {t.metadata && Object.keys(t.metadata).length > 0 && (
                  <pre className="mt-1 text-[11px] text-zinc-400 whitespace-pre-wrap break-all max-h-24 overflow-auto">
                    {JSON.stringify(t.metadata, null, 0)}
                  </pre>
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      {tab === "alerts" && (
        <>
          <Card className="p-3 bg-zinc-900 border-zinc-800">
            <div className="font-medium mb-3 flex items-center gap-2"><Bell className="h-4 w-4" /> Alert rules</div>
            <div className="space-y-2">
              {rules.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 border border-zinc-800 rounded-md p-2">
                  <div className="min-w-0">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-zinc-400 font-mono">
                      {r.metric} {r.op} {r.threshold} · severity: {r.severity}
                    </div>
                    {r.description && <div className="text-[11px] text-zinc-500">{r.description}</div>}
                  </div>
                  <Switch checked={r.enabled} onCheckedChange={() => toggleRule(r)} />
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-3 bg-zinc-900 border-zinc-800">
            <div className="font-medium mb-2">Incident history</div>
            <div className="divide-y divide-zinc-800">
              {incidents.length === 0 ? <div className="text-sm text-zinc-500 p-2">No incidents yet</div> : incidents.map(i => (
                <div key={i.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge className={i.status === "firing" ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300"}>
                        {i.status}
                      </Badge>
                      <span className="text-sm">{i.details?.rule_name ?? i.metric}</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">
                      {i.metric} observed={i.observed_value} threshold={i.threshold}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500">
                    fired {formatDistanceToNow(new Date(i.fired_at), { addSuffix: true })}
                    {i.resolved_at && <> · resolved {formatDistanceToNow(new Date(i.resolved_at), { addSuffix: true })}</>}
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => downloadCsv("incidents.csv", incidents as any)}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: any; tone?: "default"|"green"|"amber"|"red" }) {
  const t = { default: "text-zinc-100", green: "text-emerald-400", amber: "text-amber-400", red: "text-red-400" }[tone];
  return (
    <Card className="p-4 bg-zinc-900 border-zinc-800">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold ${t}`}>{value ?? "—"}</div>
    </Card>
  );
}