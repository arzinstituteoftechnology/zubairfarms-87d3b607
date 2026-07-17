import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, CheckCircle2, Clock, Copy, KeyRound, Shield, Activity, CreditCard, HardDrive, Users, Tractor, Store, TruckIcon } from "lucide-react";
import { toast } from "sonner";
import { computeState, isValidLicenseKey, quotaUsage, type SubscriptionStateName } from "@/lib/subscription";
import { useNavigate } from "react-router-dom";

const STATE_COLOR: Record<SubscriptionStateName, string> = {
  active: "bg-green-500/15 text-green-700 dark:text-green-400",
  trial: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  grace: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  expired: "bg-destructive/15 text-destructive",
  suspended: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
};

interface Snap {
  state: SubscriptionStateName;
  read_only: boolean;
  subscription_id?: string;
  plan_name?: string; tier?: string; license_key?: string;
  issue_date?: string; activated_at?: string; expires_at?: string;
  cancelled_at?: string; grace_ends_at?: string;
  days_left?: number; grace_days_left?: number;
  is_trial?: boolean; trial_days?: number;
  quotas?: any;
}
interface Usage { users: number; farms: number; shops: number; trucks: number; backups: number; backup_storage_mb: number; reports_last_30d: number; logins_last_30d: number; }

export default function SubscriptionPage() {
  const { tenant, isSuperAdmin, loading, role } = useAuth();
  const navigate = useNavigate();
  const isOwner = role === "admin";
  const [snap, setSnap] = useState<Snap | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!tenant || (!isOwner && !isSuperAdmin)) { navigate("/", { replace: true }); return; }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tenant?.id]);

  const refresh = async () => {
    if (!tenant) return;
    setBusy(true);
    try {
      const [{ data: st }, { data: us }, { data: ev }, { data: pay }, { data: pl }] = await Promise.all([
        (supabase as any).rpc("subscription_state", { _tenant_id: tenant.id }),
        (supabase as any).rpc("tenant_usage", { _tenant_id: tenant.id }),
        supabase.from("subscription_events" as any).select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
        supabase.from("payments").select("*").eq("tenant_id", tenant.id).order("payment_date", { ascending: false }).limit(50),
        supabase.from("subscription_plans").select("*").eq("is_active", true).order("price"),
      ]);
      setSnap(st as any);
      setUsage(us as any);
      setEvents((ev as any) ?? []);
      setPayments((pay as any) ?? []);
      setPlans((pl as any) ?? []);
    } finally { setBusy(false); }
  };

  const local = useMemo(() => {
    if (!snap) return null;
    return computeState({
      expires_at: snap.expires_at,
      cancelled_at: snap.cancelled_at,
      is_trial: snap.is_trial,
      tenant_status: tenant?.status,
      grace_period_days: snap.grace_ends_at && snap.expires_at
        ? Math.round((new Date(snap.grace_ends_at).getTime() - new Date(snap.expires_at).getTime()) / 86400000)
        : 0,
    });
  }, [snap, tenant?.status]);

  if (loading || !snap) return <div className="p-8 text-muted-foreground">Loading subscription…</div>;

  const state = snap.state;
  const licenseValid = isValidLicenseKey(snap.license_key);
  const q = snap.quotas ?? {};
  const lastPayment = payments[0];

  const copy = (v?: string | null) => { if (!v) return; navigator.clipboard.writeText(v); toast.success("Copied"); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" /> Subscription & Licensing</h1>
          <p className="text-sm text-muted-foreground">Manage your plan, license, usage and billing history.</p>
        </div>
        <Badge className={STATE_COLOR[state]} variant="outline">{state.toUpperCase()}</Badge>
      </div>

      {snap.read_only && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">Read-only mode active</div>
            <div>
              {state === "grace" && `Your subscription expired on ${new Date(snap.expires_at!).toLocaleDateString()}. Grace period ends ${new Date(snap.grace_ends_at!).toLocaleDateString()} (${snap.grace_days_left ?? 0} day${snap.grace_days_left === 1 ? "" : "s"} left). New data cannot be added.`}
              {state === "expired" && "Your subscription has expired. Contact your administrator to renew."}
              {state === "suspended" && "This account has been suspended. Contact your administrator."}
              {state === "cancelled" && "Your subscription is cancelled."}
              {state === "none" && "No subscription is currently assigned."}
            </div>
          </div>
        </div>
      )}

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Current Plan</div>
          <div className="font-semibold text-lg">{snap.plan_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{snap.tier ?? "custom"} · {q.support_priority ?? "standard"} support</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="font-semibold text-lg capitalize">{state}</div>
          {snap.is_trial && <div className="text-xs text-blue-600">Trial · {snap.trial_days ?? "?"} days</div>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Expires</div>
          <div className="font-semibold text-lg">{snap.expires_at ? new Date(snap.expires_at).toLocaleDateString() : "—"}</div>
          <div className="text-xs text-muted-foreground">{(snap.days_left ?? 0)} day{snap.days_left === 1 ? "" : "s"} left</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Last Payment</div>
          <div className="font-semibold text-lg">{lastPayment ? `${Number(lastPayment.amount).toFixed(2)}` : "—"}</div>
          <div className="text-xs text-muted-foreground">{lastPayment ? new Date(lastPayment.payment_date).toLocaleDateString() : "No payments yet"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Next Billing</div>
          <div className="font-semibold text-lg">{snap.expires_at ? new Date(snap.expires_at).toLocaleDateString() : "—"}</div>
          <div className="text-xs text-muted-foreground">Contact admin to renew</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="license" className="space-y-4">
        <TabsList>
          <TabsTrigger value="license"><KeyRound className="h-4 w-4 mr-1" /> License</TabsTrigger>
          <TabsTrigger value="usage"><Activity className="h-4 w-4 mr-1" /> Usage</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="billing"><CreditCard className="h-4 w-4 mr-1" /> Billing</TabsTrigger>
          <TabsTrigger value="events"><Clock className="h-4 w-4 mr-1" /> Events</TabsTrigger>
        </TabsList>

        <TabsContent value="license">
          <Card>
            <CardHeader><CardTitle className="text-base">License Information</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">License Key</div>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="px-2 py-1 rounded bg-muted font-mono text-xs break-all">{snap.license_key ?? "—"}</code>
                    <Button size="sm" variant="ghost" onClick={() => copy(snap.license_key)}><Copy className="h-3 w-3" /></Button>
                    {licenseValid ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Grace Period</div>
                  <div>{snap.grace_ends_at ? new Date(snap.grace_ends_at).toLocaleDateString() : "—"}</div>
                </div>
                <div><div className="text-xs text-muted-foreground">Issue Date</div><div>{snap.issue_date ? new Date(snap.issue_date).toLocaleString() : "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Activation</div><div>{snap.activated_at ? new Date(snap.activated_at).toLocaleString() : "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Expiry</div><div>{snap.expires_at ? new Date(snap.expires_at).toLocaleString() : "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Cancellation</div><div>{snap.cancelled_at ? new Date(snap.cancelled_at).toLocaleString() : "—"}</div></div>
              </div>

              <div className="pt-2 border-t">
                <div className="text-xs text-muted-foreground mb-1">Capabilities</div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={q.report_access ? "default" : "outline"}>Reports {q.report_access ? "✓" : "✗"}</Badge>
                  <Badge variant={q.audit_access ? "default" : "outline"}>Audit {q.audit_access ? "✓" : "✗"}</Badge>
                  <Badge variant={q.api_access ? "default" : "outline"}>API {q.api_access ? "✓" : "✗"}</Badge>
                  <Badge variant="outline">Backups: {q.backup_frequency ?? "default"}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage">
          <Card>
            <CardHeader><CardTitle className="text-base">Usage Monitor</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {usage && (
                <div className="grid md:grid-cols-2 gap-4">
                  <QuotaRow icon={<Users className="h-4 w-4" />} label="Active Users" used={usage.users} max={q.max_users} />
                  <QuotaRow icon={<Tractor className="h-4 w-4" />} label="Farms" used={usage.farms} max={q.max_farms} />
                  <QuotaRow icon={<Store className="h-4 w-4" />} label="Shops" used={usage.shops} max={q.max_shops} />
                  <QuotaRow icon={<TruckIcon className="h-4 w-4" />} label="Trucks" used={usage.trucks} max={q.max_trucks} />
                  <QuotaRow icon={<HardDrive className="h-4 w-4" />} label="Backup Storage (MB)" used={usage.backup_storage_mb} max={q.max_storage_mb} />
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Activity (last 30d)</div>
                    <div className="text-sm mt-1">
                      Reports: <strong>{usage.reports_last_30d}</strong> · Logins: <strong>{usage.logins_last_30d}</strong> · Backups: <strong>{usage.backups}</strong>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans">
          <Card>
            <CardHeader><CardTitle className="text-base">Available Plans</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {plans.map((p) => (
                  <div key={p.id} className={`rounded-lg border p-4 ${p.id === (snap as any).plan_id ? "border-primary bg-primary/5" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{p.name}</div>
                      <Badge variant="outline" className="text-xs">{p.tier ?? p.billing_cycle}</Badge>
                    </div>
                    <div className="text-2xl font-bold mt-1">${Number(p.price).toFixed(2)}<span className="text-xs font-normal text-muted-foreground"> / {p.billing_cycle}</span></div>
                    <div className="text-xs text-muted-foreground mt-1">{p.duration_days} days</div>
                    <ul className="text-xs mt-3 space-y-1 text-muted-foreground">
                      {p.max_users != null && <li>Up to {p.max_users} users</li>}
                      {p.max_farms != null && <li>Up to {p.max_farms} farms</li>}
                      {p.max_shops != null && <li>Up to {p.max_shops} shops</li>}
                      {p.max_trucks != null && <li>Up to {p.max_trucks} trucks</li>}
                      {p.max_storage_mb != null && <li>{p.max_storage_mb} MB storage</li>}
                      {p.backup_frequency && <li>Backup: {p.backup_frequency}</li>}
                      {Array.isArray(p.features) && p.features.map((f: string, i: number) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                ))}
                {!plans.length && <div className="text-sm text-muted-foreground">No plans published.</div>}
              </div>
              <div className="text-xs text-muted-foreground mt-4">To change your plan, contact your administrator.</div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing">
          <Card>
            <CardHeader><CardTitle className="text-base">Billing History</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead>
                  <TableHead>Plan</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.invoice_number ?? p.id.slice(0,8)}</TableCell>
                      <TableCell>{new Date(p.payment_date).toLocaleDateString()}</TableCell>
                      <TableCell>${Number(p.amount).toFixed(2)}</TableCell>
                      <TableCell>{p.plan_name ?? "—"}</TableCell>
                      <TableCell>{p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{p.status ?? "paid"}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {!payments.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No payments recorded.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader><CardTitle className="text-base">Subscription Events</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>Event</TableHead><TableHead>Details</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(e.created_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{String(e.event_type).replace(/_/g," ")}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md truncate">{JSON.stringify(e.metadata ?? {})}</TableCell>
                    </TableRow>
                  ))}
                  {!events.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No events yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</Button>
      </div>
    </div>
  );
}

function QuotaRow({ icon, label, used, max }: { icon: React.ReactNode; label: string; used: number; max: number | null | undefined }) {
  const q = quotaUsage(used, max);
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">{icon} {label}</div>
        <div className={`text-sm font-medium ${q.overLimit ? "text-destructive" : ""}`}>
          {used}{q.hasLimit ? ` / ${max}` : ""}
        </div>
      </div>
      {q.hasLimit && <Progress value={q.pct} className="h-1.5 mt-2" />}
    </div>
  );
}
