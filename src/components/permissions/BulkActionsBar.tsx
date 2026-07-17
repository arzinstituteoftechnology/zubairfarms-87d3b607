import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { Users, Copy, RotateCcw, X } from "lucide-react";
import type { TenantRole } from "@/hooks/usePermissions";

const ROLES: TenantRole[] = ["owner", "manager", "cashier", "data_entry", "read_only"];

export type BulkUser = { user_id: string; full_name?: string; email?: string };

export function BulkActionsBar({
  selected, allUsers, onDone, onClear,
}: {
  selected: BulkUser[];
  allUsers: BulkUser[];
  onDone: () => void;
  onClear: () => void;
}) {
  const [action, setAction] = useState<"assign_role" | "copy_permissions" | "reset_defaults" | null>(null);
  const [newRole, setNewRole] = useState<TenantRole>("manager");
  const [sourceUser, setSourceUser] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (selected.length === 0) return null;

  const apply = async () => {
    if (!action) return;
    if (!reason.trim()) return toast({ title: "Reason required", variant: "destructive" });
    if (action === "copy_permissions" && !sourceUser) return toast({ title: "Pick a source user", variant: "destructive" });
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("apply_bulk_permission_action", {
      _action: action,
      _target_user_ids: selected.map((s) => s.user_id),
      _new_role: action === "assign_role" ? newRole : null,
      _source_user_id: action === "copy_permissions" ? sourceUser : null,
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) return toast({ title: "Bulk action failed", description: error.message, variant: "destructive" });
    const r = data as { success: number; failed: number };
    toast({ title: "Bulk action complete", description: `${r.success} succeeded, ${r.failed} failed` });
    setAction(null); setReason(""); setSourceUser("");
    onDone();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">{selected.length} selected</span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setAction("assign_role")}><Users className="h-4 w-4" /> Assign role</Button>
        <Button size="sm" variant="outline" onClick={() => setAction("copy_permissions")}><Copy className="h-4 w-4" /> Copy from user</Button>
        <Button size="sm" variant="outline" onClick={() => setAction("reset_defaults")}><RotateCcw className="h-4 w-4" /> Reset to defaults</Button>
        <Button size="sm" variant="ghost" onClick={onClear}><X className="h-4 w-4" /></Button>
      </div>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "assign_role" && "Assign role to selected users"}
              {action === "copy_permissions" && "Copy permissions from another user"}
              {action === "reset_defaults" && "Reset permissions to role defaults"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded border p-2 bg-muted/30 max-h-32 overflow-auto">
              {selected.map((s) => <div key={s.user_id}>{s.full_name ?? s.email ?? s.user_id}</div>)}
            </div>
            {action === "assign_role" && (
              <div>
                <Label>New role</Label>
                <Select value={newRole} onValueChange={(v: TenantRole) => setNewRole(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {action === "copy_permissions" && (
              <div>
                <Label>Source user</Label>
                <Select value={sourceUser} onValueChange={setSourceUser}>
                  <SelectTrigger><SelectValue placeholder="Choose user to copy from" /></SelectTrigger>
                  <SelectContent>
                    {allUsers.filter((u) => !selected.some((s) => s.user_id === u.user_id)).map((u) => (
                      <SelectItem key={u.user_id} value={u.user_id}>{u.full_name ?? u.email ?? u.user_id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Reason (required — recorded in audit log)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Cancel</Button>
            <Button onClick={apply} disabled={busy}>{busy ? "Applying…" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}