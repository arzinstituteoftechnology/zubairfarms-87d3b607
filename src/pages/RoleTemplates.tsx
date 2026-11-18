import { confirmDialog } from "@/components/ConfirmHost";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { Copy, Pencil, Trash2, History, Plus } from "lucide-react";
import type { Module, Action } from "@/hooks/usePermissions";

const MODULES: Module[] = [
  "dashboard","pos","farms","shops","supplier_ledger","shop_ledger",
  "daily_recovery","purchases","supplies","expenses","trucks","deliveries",
  "inventory","stock_closing","closing_history","mortality_register",
  "reports","settings","backup_restore","users",
];
const ACTIONS: Action[] = ["view","create","edit","delete","reverse","print","export","approve","reset"];

type Template = {
  id: string; tenant_id: string | null; name: string; description: string | null;
  is_builtin: boolean; builtin_key: string | null; created_at: string;
};
type Perm = { module: string; action: string; allowed: boolean };
type Version = { id: string; version_no: number; reason: string | null; created_at: string; snapshot: any };

export default function RoleTemplates() {
  const { tenant } = useAuth();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Template | null>(null);
  const [permMap, setPermMap] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Template | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [history, setHistory] = useState<Template | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("role_templates").select("*")
      .order("is_builtin", { ascending: false }).order("name");
    setItems((data ?? []) as Template[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openEditor = async (t: Template) => {
    setEditor(t); setReason("");
    const { data } = await (supabase as any)
      .from("role_template_permissions").select("module, action, allowed").eq("template_id", t.id);
    const m: Record<string, boolean> = {};
    (data ?? []).forEach((p: Perm) => { m[`${p.module}::${p.action}`] = !!p.allowed; });
    setPermMap(m);
  };

  const toggle = (mod: Module, act: Action) => {
    if (editor?.is_builtin) return;
    const k = `${mod}::${act}`;
    setPermMap((s) => ({ ...s, [k]: !s[k] }));
  };

  const saveEditor = async () => {
    if (!editor || editor.is_builtin) return;
    if (!reason.trim()) return toast({ title: "Reason required for audit log", variant: "destructive" });
    setBusy(true);
    const rows = MODULES.flatMap((m) =>
      ACTIONS.map((a) => ({ template_id: editor.id, module: m, action: a, allowed: !!permMap[`${m}::${a}`] }))
    );
    const { error: delErr } = await (supabase as any)
      .from("role_template_permissions").delete().eq("template_id", editor.id);
    if (delErr) { setBusy(false); return toast({ title: "Failed", description: delErr.message, variant: "destructive" }); }
    const { error: insErr } = await (supabase as any)
      .from("role_template_permissions").insert(rows);
    if (insErr) { setBusy(false); return toast({ title: "Failed", description: insErr.message, variant: "destructive" }); }
    const snapshot: Record<string, Record<string, boolean>> = {};
    MODULES.forEach((m) => { snapshot[m] = {}; ACTIONS.forEach((a) => { snapshot[m][a] = !!permMap[`${m}::${a}`]; }); });
    const { data: last } = await (supabase as any)
      .from("role_template_versions").select("version_no").eq("template_id", editor.id)
      .order("version_no", { ascending: false }).limit(1).maybeSingle();
    const nextVer = ((last as any)?.version_no ?? 0) + 1;
    await (supabase as any).from("role_template_versions").insert({
      template_id: editor.id, version_no: nextVer, snapshot, reason: reason.trim(),
    });
    setBusy(false);
    toast({ title: "Template saved", description: `Version ${nextVer} recorded` });
    setEditor(null); load();
  };

  const clone = async (t: Template) => {
    const name = prompt(`Clone "${t.name}" as:`, `${t.name} copy`);
    if (!name?.trim()) return;
    const { data: newT, error } = await (supabase as any).from("role_templates").insert({
      tenant_id: tenant?.id, name: name.trim(), description: t.description, is_builtin: false,
    }).select("id").maybeSingle();
    if (error || !newT) return toast({ title: "Clone failed", description: error?.message, variant: "destructive" });
    const { data: perms } = await (supabase as any)
      .from("role_template_permissions").select("module, action, allowed").eq("template_id", t.id);
    if (perms?.length) {
      await (supabase as any).from("role_template_permissions").insert(
        (perms as Perm[]).map((p) => ({ template_id: (newT as any).id, ...p }))
      );
    }
    toast({ title: "Template cloned" });
    load();
  };

  const startRename = (t: Template) => { setRenaming(t); setNewName(t.name); setNewDesc(t.description ?? ""); };
  const saveRename = async () => {
    if (!renaming || !newName.trim()) return;
    const { error } = await (supabase as any).from("role_templates").update({
      name: newName.trim(), description: newDesc.trim() || null,
    }).eq("id", renaming.id);
    if (error) return toast({ title: "Rename failed", description: error.message, variant: "destructive" });
    setRenaming(null); toast({ title: "Renamed" }); load();
  };

  const remove = async (t: Template) => {
    if (!(await confirmDialog(`Delete template "${t.name}"? This is blocked if any user references it.`))) return;
    const { error } = await (supabase as any).from("role_templates").delete().eq("id", t.id);
    if (error) return toast({ title: "Delete blocked", description: error.message, variant: "destructive" });
    toast({ title: "Template deleted" }); load();
  };

  const openHistory = async (t: Template) => {
    setHistory(t);
    const { data } = await (supabase as any).from("role_template_versions")
      .select("id, version_no, reason, created_at, snapshot").eq("template_id", t.id)
      .order("version_no", { ascending: false });
    setVersions((data ?? []) as Version[]);
  };

  const restoreVersion = async (v: Version) => {
    if (!history || history.is_builtin) return;
    if (!(await confirmDialog(`Restore version ${v.version_no}? Current permissions will be replaced.`))) return;
    await (supabase as any).from("role_template_permissions").delete().eq("template_id", history.id);
    const rows = MODULES.flatMap((m) => ACTIONS.map((a) => ({
      template_id: history.id, module: m, action: a, allowed: !!v.snapshot?.[m]?.[a],
    })));
    await (supabase as any).from("role_template_permissions").insert(rows);
    const nextVer = (versions[0]?.version_no ?? 0) + 1;
    await (supabase as any).from("role_template_versions").insert({
      template_id: history.id, version_no: nextVer, snapshot: v.snapshot,
      reason: `Restored from version ${v.version_no}`,
    });
    toast({ title: "Version restored" });
    setHistory(null); load();
  };

  const createCustom = async () => {
    const name = prompt("New template name:");
    if (!name?.trim()) return;
    setCreating(true);
    const { error } = await (supabase as any).from("role_templates").insert({
      tenant_id: tenant?.id, name: name.trim(), is_builtin: false,
    });
    setCreating(false);
    if (error) return toast({ title: "Create failed", description: error.message, variant: "destructive" });
    toast({ title: "Template created" }); load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Built-in templates are read-only. Clone them to build custom roles.</p>
        <Button size="sm" onClick={createCustom} disabled={creating}><Plus className="h-4 w-4" /> New template</Button>
      </div>
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted"><tr>
            <th className="p-2 text-start">Name</th>
            <th className="p-2 text-start">Description</th>
            <th className="p-2 text-start">Type</th>
            <th className="p-2 text-end">Actions</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : items.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2 font-medium">{t.name}</td>
                  <td className="p-2 text-muted-foreground">{t.description ?? "—"}</td>
                  <td className="p-2"><Badge variant={t.is_builtin ? "secondary" : "default"}>{t.is_builtin ? "Built-in" : "Custom"}</Badge></td>
                  <td className="p-2 text-end">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => openEditor(t)}><Pencil className="h-4 w-4" /> {t.is_builtin ? "View" : "Edit"}</Button>
                      <Button size="sm" variant="outline" onClick={() => clone(t)}><Copy className="h-4 w-4" /></Button>
                      <Button size="sm" variant="outline" onClick={() => openHistory(t)}><History className="h-4 w-4" /></Button>
                      {!t.is_builtin && <Button size="sm" variant="outline" onClick={() => startRename(t)}>Rename</Button>}
                      {!t.is_builtin && <Button size="sm" variant="ghost" onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>{editor?.name} {editor?.is_builtin && <Badge variant="secondary" className="ms-2">Read-only</Badge>}</DialogTitle></DialogHeader>
          <div className="overflow-auto max-h-[55vh] border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0"><tr>
                <th className="p-2 text-start">Module</th>
                {ACTIONS.map((a) => <th key={a} className="p-2 text-center capitalize">{a}</th>)}
              </tr></thead>
              <tbody>
                {MODULES.map((m) => (
                  <tr key={m} className="border-t">
                    <td className="p-2 font-medium capitalize">{m.replace(/_/g, " ")}</td>
                    {ACTIONS.map((a) => (
                      <td key={a} className="p-2 text-center">
                        <Switch checked={!!permMap[`${m}::${a}`]} onCheckedChange={() => toggle(m, a)} disabled={!!editor?.is_builtin} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!editor?.is_builtin && (
            <div><Label>Reason (required)</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>Close</Button>
            {!editor?.is_builtin && <Button onClick={saveEditor} disabled={busy}>{busy ? "Saving…" : "Save version"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
            <div><Label>Description</Label><Textarea rows={2} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button onClick={saveRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{history?.name} — version history</DialogTitle></DialogHeader>
          <div className="max-h-[55vh] overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr>
                <th className="p-2 text-start">Version</th>
                <th className="p-2 text-start">When</th>
                <th className="p-2 text-start">Reason</th>
                <th className="p-2 text-end"></th>
              </tr></thead>
              <tbody>
                {versions.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No versions yet.</td></tr>
                  : versions.map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="p-2 font-medium">v{v.version_no}</td>
                      <td className="p-2 text-muted-foreground">{new Date(v.created_at).toLocaleString()}</td>
                      <td className="p-2">{v.reason ?? "—"}</td>
                      <td className="p-2 text-end">
                        {!history?.is_builtin && <Button size="sm" variant="outline" onClick={() => restoreVersion(v)}>Restore</Button>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}