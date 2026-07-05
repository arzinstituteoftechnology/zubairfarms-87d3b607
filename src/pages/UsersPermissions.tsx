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
import { Plus, UserPlus, ShieldAlert, Trash2, Settings2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

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
  const [editUser, setEditUser] = useState<Row | null>(null);
  const [rolePermsMap, setRolePermsMap] = useState<Record<string, boolean>>({});
  const [overridesMap, setOverridesMap] = useState<Record<string, boolean | undefined>>({});

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

  const createUser = async () => {
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
          <p className="text-sm text-muted-foreground">Create tenant users, assign roles, and fine-tune per-user permissions.</p>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button><UserPlus className="h-4 w-4" /> Add User</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add tenant user</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Temporary password</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" /></div>
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenNew(false)}>Cancel</Button>
              <Button onClick={createUser} disabled={busy}>{busy ? "Creating…" : "Create user"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-end">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No users yet.</TableCell></TableRow>
            ) : rows.map((r) => {
              const isSelf = r.user_id === session?.user?.id;
              return (
                <TableRow key={r.id}>
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