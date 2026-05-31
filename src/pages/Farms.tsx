import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CrudPage } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Farm = { id: string; name: string; contact_person: string | null; phone: string | null; address: string | null; notes: string | null };

const empty: Partial<Farm> = { name: "", contact_person: "", phone: "", address: "", notes: "" };

const Farms = () => {
  const { role, user } = useAuth();
  const [rows, setRows] = useState<Farm[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Farm>>(empty);
  const [editing, setEditing] = useState<Farm | null>(null);
  const [delTarget, setDelTarget] = useState<Farm | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("farms").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message); else setRows(data as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); setForm(empty); setOpen(true); };
  const onEdit = (f: Farm) => { setEditing(f); setForm(f); setOpen(true); };

  const save = async () => {
    if (!form.name?.trim()) return toast.error("Name is required");
    if (editing) {
      const { error } = await supabase.from("farms").update({
        name: form.name, contact_person: form.contact_person, phone: form.phone, address: form.address, notes: form.notes,
      }).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Farm updated");
    } else {
      const { error } = await supabase.from("farms").insert({
        name: form.name!, contact_person: form.contact_person, phone: form.phone, address: form.address, notes: form.notes, created_by: user?.id,
      });
      if (error) return toast.error(error.message);
      toast.success("Farm added");
    }
    setOpen(false); load();
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("farms").delete().eq("id", delTarget.id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
    setDelTarget(null);
  };

  return (
    <>
      <CrudPage<Farm>
        title="Farms"
        subtitle="Suppliers you buy livestock/meat from"
        rows={rows}
        loading={loading}
        searchKeys={["name", "contact_person", "phone"]}
        onAdd={onAdd}
        addLabel="Add farm"
        columns={[
          { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "contact", label: "Contact", render: (r) => r.contact_person || "—" },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
          { key: "address", label: "Address", render: (r) => <span className="text-muted-foreground">{r.address || "—"}</span> },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => onEdit(r)}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit farm" : "Add farm"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contact person</Label><Input value={form.contact_person ?? ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete farm?</AlertDialogTitle><AlertDialogDescription>This will fail if purchases exist for this farm.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Farms;