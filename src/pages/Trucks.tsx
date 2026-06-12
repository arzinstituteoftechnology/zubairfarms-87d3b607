import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { CrudPage } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type T = { id: string; number: string; driver_name: string | null; driver_phone: string | null; notes: string | null };
const empty = { number: "", driver_name: "", driver_phone: "", notes: "" };

const Trucks = () => {
  const { role, user, tenant } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [editing, setEditing] = useState<T | null>(null);
  const [del, setDel] = useState<T | null>(null);

  const load = async () => { setLoading(true); const { data, error } = await supabase.from("trucks").select("*").order("number"); if (error) toast.error(error.message); else setRows((data as any) ?? []); setLoading(false); };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.number?.trim()) return toast.error(t("trucks.number_required"));
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    const payload = { number: form.number, driver_name: form.driver_name || null, driver_phone: form.driver_phone || null, notes: form.notes || null };
    const op = editing ? supabase.from("trucks").update(payload).eq("id", editing.id) : supabase.from("trucks").insert({ ...payload, tenant_id: tenant.id, created_by: user?.id });
    const { error } = await op; if (error) return toast.error(error.message);
    toast.success(t("common.saved")); setOpen(false); load();
  };
  const doDelete = async () => { if (!del) return; const { error } = await supabase.from("trucks").delete().eq("id", del.id); if (error) toast.error(error.message); else { toast.success(t("common.deleted")); load(); } setDel(null); };

  return (
    <>
      <CrudPage<T>
        title={t("trucks.title")} subtitle={t("trucks.subtitle")} rows={rows} loading={loading} searchKeys={["number", "driver_name", "driver_phone"]}
        onAdd={() => { setEditing(null); setForm(empty); setOpen(true); }} addLabel={t("trucks.add")}
        columns={[
          { key: "n", label: t("trucks.number"), render: (r) => <span className="font-medium">{r.number}</span> },
          { key: "d", label: t("trucks.driver"), render: (r) => r.driver_name || "—" },
          { key: "p", label: t("common.phone"), render: (r) => r.driver_phone || "—" },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm(r); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDel(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? t("trucks.edit") : t("trucks.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("trucks.number_label")}</Label><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("trucks.driver_name")}</Label><Input value={form.driver_name ?? ""} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
              <div><Label>{t("trucks.driver_phone")}</Label><Input value={form.driver_phone ?? ""} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} /></div>
            </div>
            <div><Label>{t("common.notes")}</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("trucks.delete_q")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={doDelete}>{t("common.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Trucks;