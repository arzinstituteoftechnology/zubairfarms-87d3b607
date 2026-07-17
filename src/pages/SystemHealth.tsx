import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, AlertTriangle, CheckCircle2, XCircle, HelpCircle, RefreshCcw, Download, Wrench, Server } from "lucide-react";
import { toast } from "sonner";
import {
  buildHealthChecks, overallStatus, filterErrorRows, toCSV, systemInfo,
  type HealthCheck, type HealthSnapshot, type HealthStatus, type LogFilter,
} from "@/lib/systemHealth";

const STATUS_ICON: Record<HealthStatus, JSX.Element> = {
  healthy: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  critical: <XCircle className="h-4 w-4 text-destructive" />,
  unknown: <HelpCircle className="h-4 w-4 text-muted-foreground" />,
};
const STATUS_BADGE: Record<HealthStatus, string> = {
  healthy: "bg-green-500/15 text-green-700 dark:text-green-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  critical: "bg-destructive/15 text-destructive",
  unknown: "bg-muted text-muted-foreground",
};

export default function SystemHealth() {
  const { tenant, role, loading, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const isOwner = role === "admin";

  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [errors, setErrors] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [maint, setMaint] = useState<any>({ enabled: false, message: "", read_only: true, estimated_return_at: "" });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<LogFilter>({});

  useEffect(() => {
    if (loading) return;
    if (!tenant || (!isOwner && !isSuperAdmin)) { navigate("/", { replace: true }); return; }
    void refresh();
    const t = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tenant?.id]);

  const refresh = async () => {
    if (!tenant) return;
    setBusy(true);
    try {
      const [snapRes, errRes, jobRes, actRes, incRes, mRes] = await Promise.all([
        (supabase as any).rpc("tenant_health_snapshot", { _tenant_id: tenant.id }),
        supabase.from("system_errors").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("background_jobs").select("id,job_type,status,attempts,duration_ms,last_error,created_at,finished_at").order("created_at", { ascending: false }).limit(100),
        supabase.from("activity_logs").select("id,action,entity,actor_user_id,created_at,metadata").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("alert_incidents" as any).select("*").order("fired_at", { ascending: false }).limit(50),
        supabase.from("maintenance_mode" as any).select("*").eq("tenant_id", tenant.id).maybeSingle(),
      ]);
      setSnap(snapRes.data as any);
      setErrors((errRes.data as any) ?? []);
      setJobs((jobRes.data as any) ?? []);
      setActivity((actRes.data as any) ?? []);
      setIncidents((incRes.data as any) ?? []);
      if (mRes.data) setMaint({
        enabled: (mRes.data as any).enabled, message: (mRes.data as any).message ?? "",
        read_only: (mRes.data as any).read_only,
        estimated_return_at: (mRes.data as any).estimated_return_at?.slice(0,16) ?? "",
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load health data");
    } finally { setBusy(false); }
  };

  const checks: HealthCheck[] = useMemo(() => (snap ? buildHealthChecks(snap) : []), [snap]);
  const overall = overallStatus(checks);
  const filteredErrors = useMemo(() => filterErrorRows(errors, filter), [errors, filter]);

  const saveMaintenance = async () => {
    if (!tenant) return;
    const payload: any = {
      tenant_id: tenant.id,
      enabled: maint.enabled, message: maint.message || null,
      read_only: maint.read_only,
      estimated_return_at: maint.estimated_return_at ? new Date(maint.estimated_return_at).toISOString() : null,
      updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("maintenance_mode" as any).upsert(payload, { onConflict: "tenant_id" });
    if (error) return toast.error(error.message);
    toast.success("Maintenance settings saved");
  };

  const exportCsv = () => {
    const cols = ["created_at","severity","source","module","message","request_path"];
    const csv = toCSV(filteredErrors, cols);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `system-errors-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  if (loading || !snap) return <div className="p-8 text-muted-foreground">Loading system health…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Server className="h-6 w-6" /> System Health</h1>
          <p className="text-sm text-muted-foreground">Live monitoring, health checks, alerts, and maintenance for this account.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_BADGE[overall]} variant="outline">{overall.toUpperCase()}</Badge>
          <Button size="sm" variant="outline" onClick={refresh} disabled={busy}><RefreshCcw className="h-3 w-3 mr-1" />Refresh</Button>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="checks">Health Checks</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="info">System Info</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Metric label="System Status" value={overall.toUpperCase()} tone={overall} />
            <Metric label="Active Users" value={snap.users.active} />
            <Metric label="Sessions (15m)" value={snap.users.sessions_15m} />
            <Metric label="Requests / min" value={snap.requests_last_minute} />
            <Metric label="Requests / hour" value={snap.requests_last_hour} />
            <Metric label="Errors (24h)" value={snap.errors.last_24h} tone={snap.errors.last_24h > 20 ? "warning" : "healthy"} />
            <Metric label="Unresolved Errors" value={snap.errors.unresolved} tone={snap.errors.unresolved > 0 ? "warning" : "healthy"} />
            <Metric label="Jobs Queued" value={snap.jobs.queued} />
            <Metric label="Jobs Running" value={snap.jobs.running} />
            <Metric label="Jobs Failed (24h)" value={snap.jobs.failed_24h} tone={snap.jobs.failed_24h > 0 ? "warning" : "healthy"} />
            <Metric label="Email Queue" value={snap.email_queue_pending} />
            <Metric label="Backup Storage" value={`${(snap.backup.total_bytes/(1024*1024)).toFixed(1)} MB`} />
          </div>
        </TabsContent>

        <TabsContent value="checks">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Check</TableHead><TableHead>Status</TableHead><TableHead>Detail</TableHead><TableHead>Last checked</TableHead></TableRow></TableHeader>
              <TableBody>
                {checks.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell><span className="inline-flex items-center gap-1">{STATUS_ICON[c.status]} <span className="capitalize">{c.status}</span></span></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.detail}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.last_checked ? new Date(c.last_checked).toLocaleTimeString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="queue">
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead>
                <TableHead>Duration</TableHead><TableHead>Started</TableHead><TableHead>Finished</TableHead><TableHead>Error</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-xs">{j.job_type}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{j.status}</Badge></TableCell>
                    <TableCell>{j.attempts}</TableCell>
                    <TableCell>{j.duration_ms ? `${j.duration_ms}ms` : "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(j.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{j.finished_at ? new Date(j.finished_at).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-xs truncate">{j.last_error ?? ""}</TableCell>
                  </TableRow>
                ))}
                {!jobs.length && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No jobs recorded.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="errors">
          <Card>
            <CardHeader><CardTitle className="text-base">Error Center</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-4 gap-2">
                <Input type="date" value={filter.from ?? ""} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
                <Input type="date" value={filter.to ?? ""} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
                <Select value={filter.severity ?? "all"} onValueChange={(v) => setFilter({ ...filter, severity: v === "all" ? undefined : v })}>
                  <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Search message/module…" value={filter.q ?? ""} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3 w-3 mr-1" /> Export CSV</Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Time</TableHead><TableHead>Severity</TableHead><TableHead>Source</TableHead>
                    <TableHead>Module</TableHead><TableHead>Message</TableHead><TableHead>Resolved</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredErrors.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{e.severity}</Badge></TableCell>
                        <TableCell className="text-xs">{e.source}</TableCell>
                        <TableCell className="text-xs">{e.module}</TableCell>
                        <TableCell className="text-xs max-w-md truncate">{e.message}</TableCell>
                        <TableCell>{e.resolved ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                      </TableRow>
                    ))}
                    {!filteredErrors.length && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No errors match.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>User</TableHead></TableRow></TableHeader>
              <TableBody>
                {activity.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{a.action}</Badge></TableCell>
                    <TableCell className="text-xs">{a.entity}</TableCell>
                    <TableCell className="text-xs font-mono">{a.actor_user_id?.slice(0,8) ?? "system"}</TableCell>
                  </TableRow>
                ))}
                {!activity.length && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No activity yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Fired</TableHead><TableHead>Metric</TableHead><TableHead>Severity</TableHead><TableHead>Value</TableHead><TableHead>Threshold</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(i.fired_at).toLocaleString()}</TableCell>
                    <TableCell>{i.metric}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{i.severity}</Badge></TableCell>
                    <TableCell>{i.observed_value}</TableCell>
                    <TableCell>{i.threshold}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{i.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {!incidents.length && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No alert incidents.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="maintenance">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wrench className="h-4 w-4" /> Maintenance Mode</CardTitle></CardHeader>
            <CardContent className="space-y-4 max-w-2xl">
              {!isOwner && !isSuperAdmin && <p className="text-sm text-muted-foreground">Owner-only.</p>}
              <div className="flex items-center gap-3">
                <Switch checked={!!maint.enabled} onCheckedChange={(v) => setMaint({ ...maint, enabled: v })} disabled={!isOwner && !isSuperAdmin} />
                <Label>Enable maintenance mode</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={!!maint.read_only} onCheckedChange={(v) => setMaint({ ...maint, read_only: v })} disabled={!isOwner && !isSuperAdmin} />
                <Label>Read-only mode</Label>
              </div>
              <div>
                <Label>Message</Label>
                <Textarea value={maint.message} onChange={(e) => setMaint({ ...maint, message: e.target.value })} placeholder="We're upgrading the system…" />
              </div>
              <div>
                <Label>Estimated return</Label>
                <Input type="datetime-local" value={maint.estimated_return_at ?? ""} onChange={(e) => setMaint({ ...maint, estimated_return_at: e.target.value })} />
              </div>
              <Button onClick={saveMaintenance} disabled={!isOwner && !isSuperAdmin}>Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <Card>
            <CardHeader><CardTitle className="text-base">System Information</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {Object.entries(systemInfo("2026.07.17")).map(([k, v]) => (
                  <div key={k}><dt className="text-xs uppercase text-muted-foreground">{k.replace(/_/g," ")}</dt><dd className="font-mono">{String(v)}</dd></div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Activity Log</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Full search, filters, and PDF/Excel export live in the <a href="/settings/activity" className="underline">Activity Center</a>.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Auto-refresh every 30s · generated {new Date(snap.generated_at).toLocaleTimeString()}</div>
    </div>
  );
}

function Metric({ label, value, tone = "healthy" }: { label: string; value: string | number; tone?: HealthStatus }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold text-lg">{value}</div>
      <div className="mt-1"><Badge className={STATUS_BADGE[tone]} variant="outline">{tone}</Badge></div>
    </CardContent></Card>
  );
}
