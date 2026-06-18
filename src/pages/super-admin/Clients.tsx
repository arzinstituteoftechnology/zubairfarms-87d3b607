import { useEffect, useState } from "react";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pause, Play, Trash2, KeyRound, CreditCard, Stethoscope, RefreshCw, Eraser, Download, Archive, RotateCcw } from "lucide-react";
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
  const [resetOpen, setResetOpen] = useState<{ tenant: Tenant; mode: "business" | "full"; confirm: string; busy: boolean } | null>(null);
  const [purgeOpen, setPurgeOpen] = useState<{ tenant: Tenant; confirm: string; busy: boolean } | null>(null);

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
  const runPurge = async () => {
    if (!purgeOpen) return;
    if (purgeOpen.confirm !== "PURGE") return toast.error("Type PURGE to confirm");
    setPurgeOpen({ ...purgeOpen, busy: true });
    const { data, error } = await supabase.functions.invoke("admin-tenant-action", {
      body: { action: "purge_tenant", tenant_id: purgeOpen.tenant.id, confirm: "PURGE" },
    });
    if (error || (data as any)?.error) {
      setPurgeOpen({ ...purgeOpen, busy: false });
      return toast.error((data as any)?.error ?? error?.message ?? "Purge failed");
    }
    toast.success(`Purged. Removed ${(data as any)?.removed_auth_users ?? 0} auth user(s); protected ${(data as any)?.protected_auth_users ?? 0}.`);
    setPurgeOpen(null); load();
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

  const runReset = async () => {
    if (!resetOpen) return;
    if (resetOpen.confirm !== "RESET") return toast.error("Type RESET to confirm");
    setResetOpen({ ...resetOpen, busy: true });
    const action = resetOpen.mode === "full" ? "full_client_reset" : "business_reset";
    const { data, error } = await supabase.functions.invoke("admin-reset-data", {
      body: { action, tenant_id: resetOpen.tenant.id, confirm: "RESET" },
    });
    if (error || (data as any)?.error) {
      setResetOpen({ ...resetOpen, busy: false });
      return toast.error((data as any)?.error ?? error?.message ?? "Reset failed");
    }
    toast.success(resetOpen.mode === "full" ? "Full client reset complete" : "Business data reset complete");
    setResetOpen(null);
    load();
  };

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
    const { data: tu } = await supabase.from("tenant_users").select("user_id").eq("tenant_id", pwUser.tenant.id).limit(1).maybeSingle();
    if (!tu) return toast.error("No user found");
    const { error } = await supabase.functions.invoke("admin-tenant-action", { body: { action: "reset_password", user_id: tu.user_id, new_password: pwUser.password } });
    if (error) return toast.error(error.message);
    toast.success("Password reset"); setPwUser(null);
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
                      <Button size="sm" variant="ghost" title="Permanently purge" onClick={() => setPurgeOpen({ tenant: t, confirm: "", busy: false })}><Trash2 className="h-4 w-4 text-red-500"/></Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" title="Extend / Pay" onClick={() => setExtendOpen({ tenant: t, plan_id: "", amount: "" })}><CreditCard className="h-4 w-4"/></Button>
                      <Button size="sm" variant="ghost" title="Backup data" onClick={() => downloadBackup(t)}><Download className="h-4 w-4"/></Button>
                      <Button size="sm" variant="ghost" title="Reset client data" onClick={() => setResetOpen({ tenant: t, mode: "business", confirm: "", busy: false })}><Eraser className="h-4 w-4 text-amber-400"/></Button>
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

      <Dialog open={!!resetOpen} onOpenChange={(o) => !o && setResetOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Client Data — {resetOpen?.tenant.company_name}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <Label>Reset mode</Label>
              <Select value={resetOpen?.mode ?? "business"} onValueChange={(v) => resetOpen && setResetOpen({ ...resetOpen, mode: v as "business" | "full" })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business Data Reset (purchases, supplies, expenses, deliveries, inventory, recoveries)</SelectItem>
                  <SelectItem value="full">Full Client Reset (business data + settings)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
              <p className="font-semibold mb-1">This will permanently delete this client's business data.</p>
              <ul className="list-disc pl-5 text-xs space-y-0.5">
                <li>Purchases, supplies, expenses, deliveries, sales, payments, recoveries</li>
                <li>Customers, suppliers, shops, farms, trucks</li>
                {resetOpen?.mode === "full" && <li>Tenant settings</li>}
              </ul>
              <p className="text-xs mt-2"><b>Preserved:</b> owner account, email/password, subscription, organization{resetOpen?.mode === "business" ? ", settings" : ""}. Other clients are not affected.</p>
            </div>
            <div>
              <Label>Type <span className="font-mono">RESET</span> to confirm</Label>
              <Input value={resetOpen?.confirm ?? ""} onChange={(e) => resetOpen && setResetOpen({ ...resetOpen, confirm: e.target.value })} placeholder="RESET"/>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(null)} disabled={resetOpen?.busy}>Cancel</Button>
            <Button variant="destructive" onClick={runReset} disabled={!resetOpen || resetOpen.confirm !== "RESET" || resetOpen.busy}>
              {resetOpen?.busy ? "Resetting…" : "Reset client data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!purgeOpen} onOpenChange={(o) => !o && setPurgeOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Permanently Purge — {purgeOpen?.tenant.company_name}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-red-200">
              <p className="font-semibold mb-1">This is irreversible.</p>
              <ul className="list-disc pl-5 text-xs space-y-0.5">
                <li>All business data for this tenant is deleted.</li>
                <li>The tenant record is deleted.</li>
                <li>Auth users linked only to this tenant are deleted.</li>
              </ul>
              <p className="text-xs mt-2"><b>Protected:</b> Super Admin accounts and any user linked to another client are NEVER deleted.</p>
            </div>
            <div>
              <Label>Type <span className="font-mono">PURGE</span> to confirm</Label>
              <Input value={purgeOpen?.confirm ?? ""} onChange={(e) => purgeOpen && setPurgeOpen({ ...purgeOpen, confirm: e.target.value })} placeholder="PURGE"/>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeOpen(null)} disabled={purgeOpen?.busy}>Cancel</Button>
            <Button variant="destructive" onClick={runPurge} disabled={!purgeOpen || purgeOpen.confirm !== "PURGE" || purgeOpen.busy}>
              {purgeOpen?.busy ? "Purging…" : "Permanently purge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Clients;