import { useEffect, useRef, useState } from "react";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pause, Play, Trash2, KeyRound, CreditCard, Stethoscope, RefreshCw, Eraser, Download, Archive, RotateCcw, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Tenant { id: string; company_name: string; owner_name: string; email: string; mobile: string | null; country: string | null; city: string | null; status: string; created_at: string; deleted_at: string | null }
interface Plan { id: string; name: string; duration_days: number; price: number; billing_cycle: string }

const Clients = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    company_name: "", farm_name: "", owner_name: "", mobile: "", email: "", password: "",
    country: "", city: "", plan_id: "",
  });
  const [pwUser, setPwUser] = useState<{ tenant: Tenant; password: string } | null>(null);
  const [extendOpen, setExtendOpen] = useState<{ tenant: Tenant; plan_id: string; amount: string } | null>(null);
  const [diagOpen, setDiagOpen] = useState<{ tenant: Tenant; report: any | null; loading: boolean } | null>(null);
  // Unified destructive-action manager: one dialog, three modes.
  type ResetMode = "business_reset" | "factory_reset" | "delete_client";
  type Stage = "warn" | "confirm" | "running" | "done";
  const [manage, setManage] = useState<
    | {
        tenant: Tenant;
        mode: ResetMode;
        stage: Stage;
        confirm: string;
        progress: number;
        currentStep: string;
        createBackup: boolean;
        backupInfo?: { backup_id: string; backup_name: string; size: number } | null;
        result?: any;
      }
    | null
  >(null);
  const stepTimer = useRef<number | null>(null);

  const load = async () => {
    const { data } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
    setTenants(data ?? []);
    const { data: p } = await supabase.from("subscription_plans").select("id, name, duration_days, price, billing_cycle").eq("is_active", true);
    setPlans(p ?? []);
  };
  useEffect(() => { load(); }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-create-tenant", { body: form });
    setBusy(false);
    let backendError: string | null = (data as any)?.error ?? null;
    if (!backendError && error) {
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        try { const j = await ctx.json(); backendError = j?.error ?? null; } catch { /* ignore */ }
      }
      if (!backendError && ctx && typeof ctx.text === "function") {
        try { backendError = await ctx.text(); } catch { /* ignore */ }
      }
      if (!backendError) backendError = error.message;
    }
    if (backendError) return toast.error(backendError);
    toast.success("Client created");
    setOpen(false);
    setForm({ company_name: "", farm_name: "", owner_name: "", mobile: "", email: "", password: "", country: "", city: "", plan_id: "" });
    load();
  };

  const suspend = async (t: Tenant) => {
    const { error } = await supabase.functions.invoke("admin-tenant-action", { body: { action: t.status === "suspended" ? "activate_tenant" : "suspend_tenant", tenant_id: t.id } });
    if (error) return toast.error(error.message);
    toast.success("Updated"); load();
  };
  const remove = async (t: Tenant) => {
    if (!confirm(`Archive ${t.company_name}?\n\nThe client will be hidden and suspended, but ALL data, users, subscriptions and payments are preserved. You can restore at any time.`)) return;
    const { error } = await supabase.functions.invoke("admin-tenant-action", { body: { action: "delete_tenant", tenant_id: t.id } });
    if (error) return toast.error(error.message);
    toast.success("Client archived"); load();
  };
  const restore = async (t: Tenant) => {
    const { error } = await supabase.functions.invoke("admin-tenant-action", { body: { action: "restore_tenant", tenant_id: t.id } });
    if (error) return toast.error(error.message);
    toast.success("Client restored"); load();
  };
  // Per-mode metadata used by the unified dialog.
  const modeConfig: Record<ResetMode, {
    label: string;
    phrase: string;
    tone: "amber" | "red" | "crimson";
    intro: string;
    deletes: string[];
    keeps: string[];
    successMsg: string;
    steps: string[];
  }> = {
    business_reset: {
      label: "Reset Business Data",
      phrase: "BUSINESS RESET",
      tone: "amber",
      intro: "Clears all daily accounting records. Master data (farms, shops, suppliers, trucks) stays intact so the client can start fresh accounting without recreating setup data.",
      deletes: ["Purchases", "Supplies", "Shop & Supplier Ledger", "Daily Recovery", "Expenses", "Deliveries", "Inventory & Stock Movements", "Reports / Dashboard cache", "Activity Logs"],
      keeps: ["Owner account & password", "Subscription", "Organization settings", "Farms, Shops, Suppliers, Trucks, Customers, Products"],
      successMsg: "Business Data Reset Successfully",
      steps: ["Preparing safety backup…", "Deleting Ledger…", "Deleting Recoveries…", "Deleting Purchases & Supplies…", "Deleting Expenses & Deliveries…", "Cleaning Inventory…", "Clearing Reports & Dashboard cache…", "Purging Activity Logs…", "Finalising…"],
    },
    factory_reset: {
      label: "Factory Reset",
      phrase: "FACTORY RESET",
      tone: "red",
      intro: "Wipes the entire tenant back to a brand-new state. Owner login, subscription and organization profile survive; everything else is gone.",
      deletes: ["All business data", "Inventory & Products", "Shops, Suppliers, Farms, Trucks, Customers", "Dashboard & Reports", "Tenant settings", "Activity Logs"],
      keeps: ["Owner login (email + password)", "Subscription", "Tenant record & organization profile"],
      successMsg: "Factory Reset Completed Successfully",
      steps: ["Building safety backup…", "Deleting transactions…", "Deleting master data…", "Removing tenant settings…", "Clearing caches…", "Purging Activity Logs…", "Finalising…"],
    },
    delete_client: {
      label: "Delete Client Permanently",
      phrase: "DELETE CLIENT",
      tone: "crimson",
      intro: "Permanently removes the entire tenant, including auth users, subscription and every record. A safety backup is generated first — if the backup fails, the delete is cancelled.",
      deletes: ["Auth user(s) linked only to this tenant", "Tenant record & subscription", "All business data, settings, reports, logs, files & backups"],
      keeps: ["Super admin accounts", "Users linked to other tenants"],
      successMsg: "Client Deleted Successfully",
      steps: ["Building auto-backup…", "Deleting business data…", "Deleting master data & settings…", "Deleting subscription & payments…", "Deleting tenant users…", "Deleting tenant record…", "Removing auth users…", "Writing audit log…"],
    },
  };

  const openManage = (tenant: Tenant, mode: ResetMode) =>
    setManage({ tenant, mode, stage: "warn", confirm: "", progress: 0, currentStep: "", createBackup: true, backupInfo: null });

  const closeManage = () => {
    if (stepTimer.current) { window.clearInterval(stepTimer.current); stepTimer.current = null; }
    setManage(null);
  };

  const startProgressAnimation = (steps: string[]) => {
    let i = 0;
    setManage((m) => m ? { ...m, currentStep: steps[0], progress: 5 } : m);
    stepTimer.current = window.setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      const pct = Math.min(90, Math.round(((i + 1) / steps.length) * 90));
      setManage((m) => m ? { ...m, currentStep: steps[i], progress: pct } : m);
    }, 700);
  };

  const runManage = async () => {
    if (!manage) return;
    const cfg = modeConfig[manage.mode];
    if (manage.confirm.trim() !== cfg.phrase) return toast.error(`Type "${cfg.phrase}" exactly to confirm`);
    const started = Date.now();

    // ---------- Step 1 & 2: Create + Verify pre-reset backup (if enabled) ----------
    let backupInfo: { backup_id: string; backup_name: string; size: number } | null = null;
    if (manage.createBackup) {
      setManage({ ...manage, stage: "running", progress: 5, currentStep: "Creating Backup…", backupInfo: null });
      const { data: bkp, error: bkpErr } = await supabase.functions.invoke("system-backup", {
        body: { action: "create", backup_type: "pre_reset", tenant_id: manage.tenant.id },
      });
      if (bkpErr || (bkp as any)?.error || !(bkp as any)?.backup_id) {
        setManage({ ...manage, stage: "confirm" });
        return toast.error("Backup creation failed — reset cancelled", {
          description: (bkp as any)?.error ?? bkpErr?.message ?? "Unknown error",
          duration: 10000,
        });
      }
      setManage({ ...manage, stage: "running", progress: 25, currentStep: "Compressing Database…", backupInfo: null });
      // Verify integrity before proceeding
      setManage((m) => m ? { ...m, progress: 40, currentStep: "Verifying Backup Integrity…" } : m);
      const { data: ver, error: verErr } = await supabase.functions.invoke("system-backup", {
        body: { action: "verify", backup_id: (bkp as any).backup_id },
      });
      if (verErr || !(ver as any)?.ok) {
        setManage({ ...manage, stage: "confirm" });
        return toast.error("Backup verification failed — reset cancelled", {
          description: (ver as any)?.error ?? verErr?.message ?? "Integrity check failed",
          duration: 10000,
        });
      }
      backupInfo = {
        backup_id: (bkp as any).backup_id,
        backup_name: (bkp as any).backup_name ?? "backup",
        size: (bkp as any).size ?? 0,
      };
      toast.success("Backup Verified", { description: backupInfo.backup_name, duration: 4000 });
      setManage((m) => m ? { ...m, progress: 55, currentStep: "Backup Verified — Executing Reset…", backupInfo } : m);
    } else {
      setManage({ ...manage, stage: "running", progress: 5, currentStep: cfg.steps[0], backupInfo: null });
    }

    // ---------- Step 3: Execute reset ----------
    startProgressAnimation(cfg.steps);
    const { data, error } = await supabase.functions.invoke("admin-reset-data", {
      body: { action: manage.mode, tenant_id: manage.tenant.id, confirm: cfg.phrase },
    });
    if (stepTimer.current) { window.clearInterval(stepTimer.current); stepTimer.current = null; }
    if (error || (data as any)?.error) {
      const errs = (data as any)?.errors ?? {};
      const detail = Object.entries(errs).map(([k, v]: any) => {
        const [table, scope] = k.split(".");
        return `• ${table} (${scope}) — ${v?.code ?? "ERR"}: ${v?.message}${v?.constraint ? ` [constraint ${v.constraint}]` : ""}`;
      }).join("\n");
      console.error("[reset]", { action: manage.mode, error, data });
      setManage({ ...manage, stage: "confirm" });
      return toast.error(
        (data as any)?.error ?? error?.message ?? "Operation failed",
        { description: detail || undefined, duration: 12000 },
      );
    }
    const total = (data as any)?.total_rows_deleted ?? 0;
    const ms = (data as any)?.duration_ms ?? (Date.now() - started);
    setManage({ ...manage, stage: "done", progress: 100, currentStep: "Reset Completed.", backupInfo, result: data });
    toast.success(cfg.successMsg, {
      description: `${total} record(s) removed in ${(ms / 1000).toFixed(1)}s.`,
      duration: 6000,
    });
    await load();
  };

  const downloadBackup = async (t: Tenant) => {
    toast.info("Building backup…");
    const { data, error } = await supabase.functions.invoke("admin-reset-data", { body: { action: "backup", tenant_id: t.id } });
    if (error || (data as any)?.error) return toast.error((data as any)?.error ?? error?.message ?? "Backup failed");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `backup-${t.company_name.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("Backup downloaded");
  };

  // (runReset removed — replaced by runManage above.)

  const diagnose = async (t: Tenant) => {
    setDiagOpen({ tenant: t, report: null, loading: true });
    const { data, error } = await supabase.functions.invoke("admin-tenant-action", { body: { action: "diagnose_login", email: t.email } });
    if (error) { toast.error(error.message); setDiagOpen(null); return; }
    setDiagOpen({ tenant: t, report: data, loading: false });
  };

  const syncAuth = async () => {
    if (!confirm("Scan all tenants and repair missing/mismatched auth.users accounts? Newly created auth accounts will get a temp password you must reset.")) return;
    const { data, error } = await supabase.functions.invoke("admin-tenant-action", { body: { action: "sync_auth_users" } });
    if (error) return toast.error(error.message);
    const repaired = (data as any)?.repaired ?? [];
    if (!repaired.length) toast.success("All tenants already healthy.");
    else {
      toast.success(`Repaired ${repaired.length} tenant(s). See console.`);
      console.table(repaired);
      alert("Repair report:\n\n" + JSON.stringify(repaired, null, 2));
    }
    load();
  };
  const resetPassword = async () => {
    if (!pwUser) return;
    if (!pwUser.password || pwUser.password.length < 6) return toast.error("Password must be at least 6 characters");
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return toast.error("Super Admin session expired. Please sign in again.");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      console.error("[reset_password] super admin session invalid:", authError);
      return toast.error("Super Admin session expired. Please sign in again.");
    }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-tenant-action`;
    let data: any = null;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: "reset_password",
          tenant_id: pwUser.tenant.id,
          tenant_email: pwUser.tenant.email,
          new_password: pwUser.password,
        }),
      });
      const text = await resp.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
      if (!resp.ok || data?.success === false || data?.error) {
        const msg = data?.error || `Request failed (${resp.status})`;
        console.error("[reset_password] failed:", { status: resp.status, body: data, tenant_id: pwUser.tenant.id, tenant_email: pwUser.tenant.email });
        return toast.error(msg);
      }
    } catch (e) {
      console.error("[reset_password] network error:", e);
      return toast.error(e instanceof Error ? e.message : "Network error");
    }
    toast.success(data?.message ?? "Password updated successfully");
    setPwUser(null);
  };
  const extend = async () => {
    if (!extendOpen?.plan_id) return toast.error("Pick a plan");
    const plan = plans.find(p => p.id === extendOpen.plan_id);
    if (!plan) return;
    const { data: existing } = await supabase.from("subscriptions").select("expires_at").eq("tenant_id", extendOpen.tenant.id).order("expires_at", { ascending: false }).limit(1).maybeSingle();
    const base = existing && new Date(existing.expires_at) > new Date() ? new Date(existing.expires_at) : new Date();
    base.setUTCDate(base.getUTCDate() + plan.duration_days);
    const { data: sub, error: sErr } = await supabase.from("subscriptions").insert({
      tenant_id: extendOpen.tenant.id, plan_id: plan.id, expires_at: base.toISOString(),
      status: plan.billing_cycle === "trial" ? "trial" : "active",
    }).select().single();
    if (sErr) return toast.error(sErr.message);
    const amount = parseFloat(extendOpen.amount || String(plan.price));
    const invoice = `INV-${Date.now()}`;
    await supabase.from("payments").insert({
      invoice_number: invoice, tenant_id: extendOpen.tenant.id, subscription_id: sub.id,
      plan_name: plan.name, amount, payment_date: new Date().toISOString().slice(0, 10),
      expiry_date: base.toISOString().slice(0, 10), status: "paid",
    });
    toast.success("Subscription extended");
    setExtendOpen(null);
  };

  return (
    <div className="space-y-4 text-zinc-100">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Clients</h1><p className="text-zinc-400 text-sm">All tenant accounts</p></div>
        <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => setShowArchived(s => !s)}>
          <Archive className="h-4 w-4"/> {showArchived ? "Show active" : "Show archived"}
        </Button>
        <Button variant="outline" onClick={syncAuth}><RefreshCw className="h-4 w-4"/> Sync auth users</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4"/> New Client</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Client</DialogTitle></DialogHeader>
            <form onSubmit={onCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Company Name *</Label><Input required value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })}/></div>
                <div><Label>Farm Name</Label><Input value={form.farm_name} onChange={e => setForm({ ...form, farm_name: e.target.value })}/></div>
                <div><Label>Owner Name *</Label><Input required value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })}/></div>
                <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })}/></div>
                <div><Label>Email *</Label><Input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></div>
                <div><Label>Password *</Label><Input type="password" required minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}/></div>
                <div><Label>Country</Label><Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}/></div>
                <div><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></div>
              </div>
              <div><Label>Plan</Label>
                <Select value={form.plan_id} onValueChange={(v) => setForm({ ...form, plan_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Free Trial (default)"/></SelectTrigger>
                  <SelectContent>{plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name} — ${p.price} / {p.duration_days}d</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="bg-zinc-900 border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm text-zinc-100">
          <thead className="bg-zinc-800/50 text-zinc-100 text-left">
            <tr><th className="p-3">Company</th><th className="p-3">Owner</th><th className="p-3">Email</th><th className="p-3">Location</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {tenants.filter(t => showArchived ? !!t.deleted_at : !t.deleted_at).map(t => (
              <tr key={t.id} className={`border-t border-zinc-800 ${t.deleted_at ? "opacity-60" : ""}`}>
                <td className="p-3 font-medium">{t.company_name}</td>
                <td className="p-3">{t.owner_name}</td>
                <td className="p-3 text-zinc-300">{t.email}</td>
                <td className="p-3 text-zinc-300">{[t.city, t.country].filter(Boolean).join(", ") || "—"}</td>
                <td className="p-3">
                  {t.deleted_at
                    ? <span className="px-2 py-0.5 rounded text-xs bg-zinc-500/20 text-zinc-300">archived</span>
                    : <span className={`px-2 py-0.5 rounded text-xs ${t.status === "active" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{t.status}</span>}
                </td>
                <td className="p-3 text-right space-x-1">
                  {t.deleted_at ? (
                    <>
                      <Button size="sm" variant="ghost" title="Restore" onClick={() => restore(t)}><RotateCcw className="h-4 w-4 text-green-400"/></Button>
                      <Button size="sm" variant="ghost" title="Delete Client Permanently" onClick={() => openManage(t, "delete_client")}><Trash2 className="h-4 w-4 text-red-500"/></Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" title="Extend / Pay" onClick={() => setExtendOpen({ tenant: t, plan_id: "", amount: "" })}><CreditCard className="h-4 w-4"/></Button>
                      <Button size="sm" variant="ghost" title="Backup data" onClick={() => downloadBackup(t)}><Download className="h-4 w-4"/></Button>
                      <Button size="sm" variant="ghost" title="Reset Business Data" onClick={() => openManage(t, "business_reset")}><Eraser className="h-4 w-4 text-amber-400"/></Button>
                      <Button size="sm" variant="ghost" title="Factory Reset" onClick={() => openManage(t, "factory_reset")}><ShieldAlert className="h-4 w-4 text-orange-500"/></Button>
                      <Button size="sm" variant="ghost" title="Delete Client Permanently" onClick={() => openManage(t, "delete_client")}><Trash2 className="h-4 w-4 text-red-500"/></Button>
                      <Button size="sm" variant="ghost" title="Diagnose login" onClick={() => diagnose(t)}><Stethoscope className="h-4 w-4"/></Button>
                      <Button size="sm" variant="ghost" title="Reset Password" onClick={() => setPwUser({ tenant: t, password: "" })}><KeyRound className="h-4 w-4"/></Button>
                      <Button size="sm" variant="ghost" title={t.status === "active" ? "Suspend" : "Activate"} onClick={() => suspend(t)}>{t.status === "active" ? <Pause className="h-4 w-4"/> : <Play className="h-4 w-4"/>}</Button>
                      <Button size="sm" variant="ghost" title="Archive" onClick={() => remove(t)}><Archive className="h-4 w-4 text-red-400"/></Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!tenants.length && <tr><td colSpan={6} className="p-6 text-center text-zinc-300">No clients yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!pwUser} onOpenChange={(o) => !o && setPwUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Password — {pwUser?.tenant.company_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>New Password</Label>
            <Input type="password" minLength={6} value={pwUser?.password ?? ""} onChange={e => setPwUser(pwUser ? { ...pwUser, password: e.target.value } : null)} />
          </div>
          <DialogFooter><Button onClick={resetPassword} disabled={!pwUser?.password || pwUser.password.length < 6}>Reset</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extendOpen} onOpenChange={(o) => !o && setExtendOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Extend Subscription — {extendOpen?.tenant.company_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Plan</Label>
              <Select value={extendOpen?.plan_id ?? ""} onValueChange={(v) => setExtendOpen(extendOpen ? { ...extendOpen, plan_id: v } : null)}>
                <SelectTrigger><SelectValue placeholder="Pick plan"/></SelectTrigger>
                <SelectContent>{plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name} — ${p.price} / {p.duration_days}d</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Amount (leave blank to use plan price)</Label>
              <Input type="number" step="0.01" value={extendOpen?.amount ?? ""} onChange={e => setExtendOpen(extendOpen ? { ...extendOpen, amount: e.target.value } : null)} />
            </div>
          </div>
          <DialogFooter><Button onClick={extend}>Record Payment & Extend</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!diagOpen} onOpenChange={(o) => !o && setDiagOpen(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Login Diagnostic — {diagOpen?.tenant.company_name}</DialogTitle></DialogHeader>
          {diagOpen?.loading ? <p className="text-sm text-zinc-400">Checking…</p> : (
            <div className="space-y-2 text-sm">
              <div className="rounded bg-zinc-800/60 p-3"><b>Likely cause:</b> {diagOpen?.report?.likely_cause}</div>
              <pre className="text-xs bg-zinc-900 border border-zinc-800 rounded p-3 overflow-auto max-h-80">{JSON.stringify(diagOpen?.report, null, 2)}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Unified destructive-action manager (Business Reset / Factory Reset / Delete Client) */}
      <Dialog open={!!manage} onOpenChange={(o) => { if (!o && manage?.stage !== "running") closeManage(); }}>
        <DialogContent className="max-w-lg">
          {manage && (() => {
            const cfg = modeConfig[manage.mode];
            const toneClass = cfg.tone === "amber"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : cfg.tone === "red"
                ? "border-orange-500/50 bg-orange-500/10 text-orange-200"
                : "border-red-600/60 bg-red-600/10 text-red-200";
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-400" /> Warning
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <p className="text-zinc-200">
                    <b>{cfg.label}</b> — {manage.tenant.company_name}
                  </p>
                  <p className="text-zinc-400">This action cannot be undone. Please choose carefully.</p>
                  <div className={`rounded border p-3 ${toneClass}`}>
                    <p className="text-xs mb-2">{cfg.intro}</p>
                    <p className="font-semibold text-xs mt-2">Will delete:</p>
                    <ul className="list-disc pl-5 text-xs space-y-0.5">{cfg.deletes.map(d => <li key={d}>{d}</li>)}</ul>
                    <p className="font-semibold text-xs mt-2">Will keep:</p>
                    <ul className="list-disc pl-5 text-xs space-y-0.5 text-emerald-300">{cfg.keeps.map(k => <li key={k}>{k}</li>)}</ul>
                  </div>

                  {manage.stage === "confirm" && (
                    <div>
                      <Label>Type <span className="font-mono">{cfg.phrase}</span> to confirm</Label>
                      <Input
                        autoFocus
                        value={manage.confirm}
                        onChange={(e) => setManage({ ...manage, confirm: e.target.value })}
                        placeholder={cfg.phrase}
                      />
                    </div>
                  )}

                  {manage.stage === "running" && (
                    <div className="space-y-2">
                      <Progress value={manage.progress} />
                      <p className="text-xs text-zinc-300">{manage.currentStep}</p>
                    </div>
                  )}

                  {manage.stage === "done" && manage.result && (
                    <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-200 text-xs space-y-1">
                      <p className="font-semibold">{cfg.successMsg}</p>
                      <p>{manage.result.total_rows_deleted ?? 0} record(s) removed in {((manage.result.duration_ms ?? 0) / 1000).toFixed(1)}s.</p>
                      {manage.result.removed_auth_users != null && (
                        <p>Auth users removed: {manage.result.removed_auth_users} (protected: {manage.result.protected_auth_users}).</p>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  {manage.stage === "warn" && (
                    <>
                      <Button variant="outline" onClick={closeManage}>Cancel</Button>
                      <Button variant="destructive" onClick={() => setManage({ ...manage, stage: "confirm" })}>Continue</Button>
                    </>
                  )}
                  {manage.stage === "confirm" && (
                    <>
                      <Button variant="outline" onClick={closeManage}>Cancel</Button>
                      <Button variant="destructive" onClick={runManage} disabled={manage.confirm.trim() !== cfg.phrase}>
                        {cfg.label}
                      </Button>
                    </>
                  )}
                  {manage.stage === "running" && (
                    <Button variant="outline" disabled>Working…</Button>
                  )}
                  {manage.stage === "done" && (
                    <Button onClick={closeManage}>Close</Button>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Clients;