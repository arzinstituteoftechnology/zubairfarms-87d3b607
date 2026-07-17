import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions, TenantRole, Module, Action } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, UserPlus, ShieldAlert, Trash2, Settings2, Mail, RotateCw, Ban, Copy, ScrollText, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionsBar } from "@/components/permissions/BulkActionsBar";
import RoleTemplates from "./RoleTemplates";
import { downloadAuditCSV, downloadAuditXLSX, downloadAuditPDF, type AuditRow } from "@/lib/permissionAuditExport";
import { FileDown } from "lucide-react";

const ROLES: { value: TenantRole; label: string; desc: string }[] = [
  { value: "owner", label: "Owner", desc: "Full access to every tenant module" },
  { value: "manager", label: "Manager", desc: "Business ops, cannot factory reset or manage subscription" },
  { value: "cashier", label: "Cashier", desc: "POS, Daily Recovery, Shop Ledger" },
  { value: "data_entry", label: "Data Entry Operator", desc: "Add records only" },
  { value: "read_only", label: "Read Only User", desc: "View-only Dashboard, Reports, Ledgers, Inventory" },
];

const MODULES: Module[] = [
  "dashboard","pos","farms","shops","supplier_ledger","shop_ledger",
  "daily_recovery","purchases","supplies","expenses","trucks","deliveries",
  "inventory","stock_closing","closing_history","mortality_register",
  "reports","settings","backup_restore","users",
];
const ACTIONS: Action[] = ["view","create","edit","delete","reverse","print","export","approve","reset"];

const MODULE_LABEL: Record<Module,string> = {
  dashboard:"Dashboard", pos:"POS", farms:"Farms", shops:"Shops",
  supplier_ledger:"Supplier Ledger", shop_ledger:"Shop Ledger",
  daily_recovery:"Daily Recovery", purchases:"Purchases", supplies:"Supplies",
  expenses:"Expenses", trucks:"Trucks", deliveries:"Deliveries",
  inventory:"Inventory", stock_closing:"Daily Closing Stock",
  closing_history:"Closing History", mortality_register:"Mortality Register",
  reports:"Reports Center", settings:"Settings", backup_restore:"Backup & Restore",
  users:"Users & Permissions",
};

type Row = {
  id: string; user_id: string; tenant_role: TenantRole; status: "active"|"disabled";
  created_at: string; full_name?: string; email?: string;
};

export default function UsersPermissions() {
  const { session, tenant } = useAuth();
  const { isOwner, refresh } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", tenant_role: "manager" as TenantRole });
  const [mode, setMode] = useState<"direct" | "invite">("invite");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<Row | null>(null);
  const [rolePermsMap, setRolePermsMap] = useState<Record<string, boolean>>({});
  const [overridesMap, setOverridesMap] = useState<Record<string, boolean | undefined>>({});

  // ---- Invitations state ----
  type Invitation = {
    id: string; email: string; full_name: string | null; tenant_role: TenantRole;
    status: "pending" | "accepted" | "expired" | "cancelled";
    expires_at: string; sent_at: string; resend_count: number;
  };
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);

  // ---- Audit state ----
  type Audit = {
    id: string; created_at: string; actor_email: string | null; target_email: string | null;
    action: string; module: string | null; permission_action: string | null;
    previous_value: any; new_value: any; reason: string | null; actor_ip: string | null; actor_user_agent: string | null;
  };
  const [audit, setAudit] = useState<Audit[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilter, setAuditFilter] = useState({ action: "all", q: "" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectAll = (all: boolean) => setSelected(all ? new Set(rows.filter((r) => r.tenant_role !== "owner").map((r) => r.user_id)) : new Set());

  const load = async () => {
    setLoading(true);
    const { data: tu } = await (supabase as any)
      .from("tenant_users")
      .select("id, user_id, tenant_role, status, created_at")
      .order("created_at", { ascending: true });
    const ids = (tu ?? []).map((r: any) => r.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id, full_name").in("id", ids)
      : { data: [] as any[] };
    const pmap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
    setRows((tu ?? []).map((r: any) => ({ ...r, full_name: pmap.get(r.user_id) ?? r.user_id.slice(0, 8) })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadInvites = async () => {
    setInvitesLoading(true);
    const { data } = await (supabase as any)
      .from("user_invitations")
      .select("id, email, full_name, tenant_role, status, expires_at, sent_at, resend_count")
      .order("created_at", { ascending: false });
    setInvites((data ?? []) as Invitation[]);
    setInvitesLoading(false);
  };
  useEffect(() => { if (isOwner) loadInvites(); }, [isOwner]);

  const loadAudit = async () => {
    setAuditLoading(true);
    let q = (supabase as any).from("permission_audit_log")
      .select("id, created_at, actor_email, target_email, action, module, permission_action, previous_value, new_value, reason, actor_ip, actor_user_agent")
      .order("created_at", { ascending: false }).limit(300);
    if (auditFilter.action !== "all") q = q.eq("action", auditFilter.action);
    const { data } = await q;
    let list = (data ?? []) as Audit[];
    if (auditFilter.q) {
      const needle = auditFilter.q.toLowerCase();
      list = list.filter((r) => [r.actor_email, r.target_email, r.reason, r.module].filter(Boolean).some((v: any) => String(v).toLowerCase().includes(needle)));
    }
    setAudit(list);
    setAuditLoading(false);
  };
  useEffect(() => { if (isOwner) loadAudit(); /* eslint-disable-next-line */ }, [isOwner, auditFilter.action]);

  const createUser = async () => {
    if (mode === "invite") return sendInvite();
    if (!form.email || !form.password || !form.full_name) {
      toast({ title: "Missing fields", description: "Name, email, and password are required", variant: "destructive" });
      return;
    }
    if (form.password.length < 8) {
      toast({ title: "Weak password", description: "Use at least 8 characters", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("owner-create-tenant-user", {
      body: { full_name: form.full_name, email: form.email, password: form.password, tenant_role: form.tenant_role },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast({ title: "Failed", description: (data as any)?.error ?? error?.message ?? "Unknown error", variant: "destructive" });
      return;
    }
    toast({ title: "User created", description: `${form.email} added as ${form.tenant_role}` });
    setOpenNew(false);
    setForm({ full_name: "", email: "", password: "", tenant_role: "manager" });
    await load();
  };

  const sendInvite = async () => {
    if (!form.email || !form.full_name) {
      toast({ title: "Missing fields", description: "Name and email are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("owner-invite-user", {
      body: { action: "invite", full_name: form.full_name, email: form.email, tenant_role: form.tenant_role },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast({ title: "Invitation failed", description: (data as any)?.error ?? error?.message, variant: "destructive" });
      return;
    }
    const url = (data as any).accept_url as string;
    setLastInviteUrl(url);
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    toast({ title: "Invitation created", description: "Accept link copied to clipboard" });
    setForm({ full_name: "", email: "", password: "", tenant_role: "manager" });
    await loadInvites();
  };

  const resendInvite = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("owner-invite-user", { body: { action: "resend", invitation_id: id } });
    if (error || (data as any)?.error) return toast({ title: "Resend failed", description: (data as any)?.error ?? error?.message, variant: "destructive" });
    try { await navigator.clipboard.writeText((data as any).accept_url); } catch {}
    toast({ title: "New link generated", description: "Copied to clipboard" });
    loadInvites();
  };
  const revokeInvite = async (id: string) => {
    if (!confirm("Revoke this invitation? The link will stop working.")) return;
    const { data, error } = await supabase.functions.invoke("owner-invite-user", { body: { action: "revoke", invitation_id: id } });
    if (error || (data as any)?.error) return toast({ title: "Revoke failed", description: (data as any)?.error ?? error?.message, variant: "destructive" });
    toast({ title: "Invitation revoked" });
    loadInvites();
  };

  const setUserStatus = async (row: Row, status: "active" | "disabled") => {
    const { error } = await (supabase as any).from("tenant_users").update({ status }).eq("id", row.id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: `User ${status === "active" ? "enabled" : "disabled"}` });
    load();
  };

  const setUserRole = async (row: Row, tenant_role: TenantRole) => {
    const { error } = await (supabase as any).from("tenant_users").update({ tenant_role }).eq("id", row.id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Role updated", description: `${row.full_name} → ${tenant_role}` });
    load();
  };

  const removeUser = async (row: Row) => {
    if (!confirm(`Remove ${row.full_name} from this tenant? Their login stays in the system but they lose all access.`)) return;
    const { error } = await (supabase as any).from("tenant_users").delete().eq("id", row.id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "User removed" });
    load();
  };

  // ---- per-user permission editor ----
  const openPermissions = async (row: Row) => {
    setEditUser(row);
    const [{ data: rp }, { data: ov }] = await Promise.all([
      (supabase as any).from("role_permissions").select("module, action, allowed").eq("role", row.tenant_role),
      (supabase as any).from("user_permission_overrides").select("module, action, allowed").eq("user_id", row.user_id),
    ]);
    const rmap: Record<string, boolean> = {};
    (rp ?? []).forEach((r: any) => { rmap[`${r.module}::${r.action}`] = !!r.allowed; });
    setRolePermsMap(rmap);
    const omap: Record<string, boolean | undefined> = {};
    (ov ?? []).forEach((r: any) => { omap[`${r.module}::${r.action}`] = !!r.allowed; });
    setOverridesMap(omap);
  };

  const effectivePerm = (m: Module, a: Action) => {
    const k = `${m}::${a}`;
    if (overridesMap[k] !== undefined) return overridesMap[k]!;
    return !!rolePermsMap[k];
  };

  const togglePerm = async (m: Module, a: Action) => {
    if (!editUser) return;
    const k = `${m}::${a}`;
    const cur = effectivePerm(m, a);
    const next = !cur;
    // Upsert override
    const { error } = await (supabase as any).from("user_permission_overrides")
      .upsert({ user_id: editUser.user_id, tenant_id: tenant?.id, module: m, action: a, allowed: next },
              { onConflict: "user_id,module,action" });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    setOverridesMap((s) => ({ ...s, [k]: next }));
  };

  const resetOverride = async (m: Module, a: Action) => {
    if (!editUser) return;
    const k = `${m}::${a}`;
    const { error } = await (supabase as any).from("user_permission_overrides")
      .delete().eq("user_id", editUser.user_id).eq("module", m).eq("action", a);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    setOverridesMap((s) => { const c = { ...s }; delete c[k]; return c; });
  };

  if (!isOwner) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive" />
        <h2 className="text-xl font-semibold">Owner only</h2>
        <p className="text-muted-foreground">Only the tenant Owner can manage users and permissions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users & Permissions</h1>
          <p className="text-sm text-muted-foreground">Invite users, assign roles, fine-tune per-user permissions, and audit every change.</p>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button><UserPlus className="h-4 w-4" /> Add User</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add tenant user</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <RadioGroup value={mode} onValueChange={(v: any) => setMode(v)} className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 border rounded-md p-2 cursor-pointer ${mode==="invite"?"border-primary":""}`}>
                  <RadioGroupItem value="invite" /> <Mail className="h-4 w-4" /> Send invitation
                </label>
                <label className={`flex items-center gap-2 border rounded-md p-2 cursor-pointer ${mode==="direct"?"border-primary":""}`}>
                  <RadioGroupItem value="direct" /> <UserPlus className="h-4 w-4" /> Create directly
                </label>
              </RadioGroup>
              <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              {mode === "direct" && (
                <div><Label>Temporary password</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" /></div>
              )}
              <div>
                <Label>Role</Label>
                <Select value={form.tenant_role} onValueChange={(v: TenantRole) => setForm({ ...form, tenant_role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{r.label}</span>
                          <span className="text-xs text-muted-foreground">{r.desc}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {lastInviteUrl && (
                <div className="border rounded-md p-2 text-xs bg-muted/50 break-all">
                  <div className="font-medium mb-1">Last invitation link (copied):</div>
                  <div>{lastInviteUrl}</div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenNew(false)}>Cancel</Button>
              <Button onClick={createUser} disabled={busy}>{busy ? (mode==="invite"?"Sending…":"Creating…") : (mode==="invite"?"Send invitation":"Create user")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
          <TabsTrigger value="templates">Role templates</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <div className="mb-3">
            <BulkActionsBar
              selected={rows.filter((r) => selected.has(r.user_id)).map((r) => ({ user_id: r.user_id, full_name: r.full_name, email: r.email }))}
              allUsers={rows.map((r) => ({ user_id: r.user_id, full_name: r.full_name, email: r.email }))}
              onDone={() => { setSelected(new Set()); load(); refresh(); }}
              onClear={() => setSelected(new Set())}
            />
          </div>
          <Card className="p-0 overflow-x-auto">
            <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={selected.size > 0 && selected.size === rows.filter((r) => r.tenant_role !== "owner").length}
                  onCheckedChange={(v) => selectAll(!!v)}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-end">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No users yet.</TableCell></TableRow>
            ) : rows.map((r) => {
              const isSelf = r.user_id === session?.user?.id;
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.user_id)}
                      onCheckedChange={() => toggleSelect(r.user_id)}
                      disabled={r.tenant_role === "owner"}
                    />
                  </TableCell>
                  <TableCell><div className="font-medium">{r.full_name}</div></TableCell>
                  <TableCell>
                    <Select value={r.tenant_role} onValueChange={(v: TenantRole) => setUserRole(r, v)} disabled={isSelf && r.tenant_role === "owner"}>
                      <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((ro) => <SelectItem key={ro.value} value={ro.value}>{ro.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={r.status === "active"} onCheckedChange={(v) => setUserStatus(r, v ? "active" : "disabled")} disabled={isSelf} />
                      <Badge variant={r.status === "active" ? "default" : "destructive"}>{r.status}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => openPermissions(r)} disabled={r.tenant_role === "owner"}>
                        <Settings2 className="h-4 w-4" /> Permissions
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeUser(r)} disabled={isSelf || r.tenant_role === "owner"}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="invitations">
          <Card className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Resent</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitesLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : invites.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No invitations yet.</TableCell></TableRow>
                ) : invites.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell><div className="font-medium">{i.email}</div>{i.full_name && <div className="text-xs text-muted-foreground">{i.full_name}</div>}</TableCell>
                    <TableCell className="capitalize">{i.tenant_role.replace("_", " ")}</TableCell>
                    <TableCell>
                      <Badge variant={i.status === "pending" ? "default" : i.status === "accepted" ? "secondary" : "destructive"}>{i.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(i.expires_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{i.resend_count}</TableCell>
                    <TableCell className="text-end">
                      {i.status === "pending" && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" onClick={() => resendInvite(i.id)}><RotateCw className="h-4 w-4" /> Resend</Button>
                          <Button size="sm" variant="ghost" onClick={() => revokeInvite(i.id)}><Ban className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <RoleTemplates />
        </TabsContent>

        <TabsContent value="audit">
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex flex-col">
                <Label className="text-xs">Action</Label>
                <Select value={auditFilter.action} onValueChange={(v) => setAuditFilter((s) => ({ ...s, action: v }))}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {["role_changed","status_changed","override_set","override_cleared","invite_sent","invite_resent","invite_revoked","invite_accepted","bulk_role_applied","bulk_permissions_copied","bulk_permissions_reset","role_template_created","role_template_updated","role_template_deleted"].map((a) => (
                      <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col flex-1 min-w-[200px]">
                <Label className="text-xs">Search</Label>
                <Input value={auditFilter.q} onChange={(e) => setAuditFilter((s) => ({ ...s, q: e.target.value }))} placeholder="actor, target, reason, module" onKeyDown={(e) => { if (e.key === "Enter") loadAudit(); }} />
              </div>
              <Button variant="outline" onClick={loadAudit}>Apply</Button>
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => downloadAuditCSV(audit as AuditRow[])} disabled={audit.length === 0}><FileDown className="h-4 w-4" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={() => downloadAuditXLSX(audit as AuditRow[])} disabled={audit.length === 0}><FileDown className="h-4 w-4" /> Excel</Button>
              <Button variant="outline" size="sm" onClick={() => downloadAuditPDF(audit as AuditRow[])} disabled={audit.length === 0}><FileDown className="h-4 w-4" /> PDF</Button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>
                  <th className="p-2 text-start"></th>
                  <th className="p-2 text-start">Time</th>
                  <th className="p-2 text-start">Actor</th>
                  <th className="p-2 text-start">Target</th>
                  <th className="p-2 text-start">Action</th>
                  <th className="p-2 text-start">Details</th>
                </tr></thead>
                <tbody>
                  {auditLoading ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                  ) : audit.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No audit entries.</td></tr>
                  ) : audit.map((r) => (
                    <>
                      <tr key={r.id} className="border-t">
                        <td className="p-2 align-top">
                          <button className="text-muted-foreground" onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}>
                            {expanded[r.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="p-2 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="p-2">{r.actor_email ?? <span className="text-muted-foreground">system</span>}</td>
                        <td className="p-2">{r.target_email ?? "—"}</td>
                        <td className="p-2 capitalize">{r.action.replace(/_/g, " ")}</td>
                        <td className="p-2 text-muted-foreground">
                          {r.module ? `${r.module}${r.permission_action ? " · " + r.permission_action : ""}` : ""}
                          {r.reason ? <span> — {r.reason}</span> : null}
                        </td>
                      </tr>
                      {expanded[r.id] && (
                        <tr className="bg-muted/40">
                          <td colSpan={6} className="p-3">
                            <div className="grid md:grid-cols-2 gap-3 text-xs">
                              <div>
                                <div className="font-medium mb-1">Previous</div>
                                <pre className="bg-background p-2 rounded overflow-auto max-h-40">{JSON.stringify(r.previous_value ?? null, null, 2)}</pre>
                              </div>
                              <div>
                                <div className="font-medium mb-1">New</div>
                                <pre className="bg-background p-2 rounded overflow-auto max-h-40">{JSON.stringify(r.new_value ?? null, null, 2)}</pre>
                              </div>
                              <div className="md:col-span-2 text-muted-foreground">
                                IP: {r.actor_ip ?? "—"} · Device: {r.actor_user_agent ?? "—"}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Showing latest 300 entries. Use the filters and export to CSV/Excel/PDF for offline review.</p>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) { setEditUser(null); refresh(); } }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Permissions — {editUser?.full_name} <Badge variant="outline" className="ms-2">{editUser?.tenant_role}</Badge></DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Green switches indicate the user is allowed to perform that action. Overrides take precedence over the role defaults.</p>
          <div className="overflow-auto max-h-[60vh] border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="p-2 text-start">Module</th>
                  {ACTIONS.map((a) => <th key={a} className="p-2 text-center capitalize">{a}</th>)}
                </tr>
              </thead>
              <tbody>
                {MODULES.map((m) => (
                  <tr key={m} className="border-t">
                    <td className="p-2 font-medium">{MODULE_LABEL[m]}</td>
                    {ACTIONS.map((a) => {
                      const k = `${m}::${a}`;
                      const overridden = overridesMap[k] !== undefined;
                      const allowed = effectivePerm(m, a);
                      return (
                        <td key={a} className="p-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <Switch checked={allowed} onCheckedChange={() => togglePerm(m, a)} />
                            {overridden && (
                              <button onClick={() => resetOverride(m, a)} className="text-[10px] text-muted-foreground underline">reset</button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}