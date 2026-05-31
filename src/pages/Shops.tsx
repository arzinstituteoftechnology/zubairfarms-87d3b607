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

type Shop = { id: string; name: string; contact_person: string | null; phone: string | null; address: string | null; notes: string | null };
const empty: Partial<Shop> = { name: "", contact_person: "", phone: "", address: "", notes: "" };

const Shops = () => {
  const { role, user } = useAuth();
  const [rows, setRows] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Shop>>(empty);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [delTarget, setDelTarget] = useState<Shop | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("shops").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message); else setRows(data as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name?.trim()) return toast.error("Name is required");
    const payload: any = { name: form.name, contact_person: form.contact_person, phone: form.phone, address: form.address, notes: form.notes };
    const op = editing
      ? supabase.from("shops").update(payload).eq("id", editing.id)
      : supabase.from("shops").insert({ ...payload, created_by: user?.id });
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success(editing ? "Shop updated" : "Shop added");
    setOpen(false); load();
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("shops").delete().eq("id", delTarget.id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
    setDelTarget(null);
  };

  return (
    <>
      <CrudPage<Shop>
        title="Shops"
        subtitle="Retail shops you supply meat to"
        rows={rows} loading={loading}
        searchKeys={["name", "contact_person", "phone"]}
        onAdd={() => { setEditing(null); setForm(empty); setOpen(true); }}
        addLabel="Add shop"
        columns={[
          { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "contact", label: "Contact", render: (r) => r.contact_person || "—" },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
          { key: "address", label: "Address", render: (r) => <span className="text-muted-foreground">{r.address || "—"}</span> },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm(r); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit shop" : "Add shop"}</DialogTitle></DialogHeader>
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
          <AlertDialogHeader><AlertDialogTitle>Delete shop?</AlertDialogTitle><AlertDialogDescription>This will fail if supplies exist for this shop.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Shops;