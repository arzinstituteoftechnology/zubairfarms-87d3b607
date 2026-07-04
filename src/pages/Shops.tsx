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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Shop = { id: string; name: string; contact_person: string | null; phone: string | null; address: string | null; notes: string | null; opening_balance: number; deleted_at?: string | null };
const empty: Partial<Shop> = { name: "", contact_person: "", phone: "", address: "", notes: "", opening_balance: 0 };

const Shops = () => {
  const { role, user, tenant } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Shop>>(empty);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [delTarget, setDelTarget] = useState<Shop | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("shops").select("*").is("deleted_at", null).order("created_at", { ascending: false });
    if (error) toast.error(error.message); else setRows(data as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name?.trim()) return toast.error(t("farms.name_required"));
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    const openingBalance = Number(form.opening_balance ?? 0) || 0;
    const payload: any = { name: form.name, contact_person: form.contact_person, phone: form.phone, address: form.address, notes: form.notes, opening_balance: openingBalance };
    if (editing) {
      const prevOpening = Number(editing.opening_balance ?? 0) || 0;
      const { error } = await supabase.from("shops").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      if (openingBalance !== prevOpening) {
        await supabase.from("shop_ledger_entries").delete().eq("shop_id", editing.id).eq("entry_type", "opening_balance");
        if (openingBalance > 0) {
          await supabase.from("shop_ledger_entries").insert({
            shop_id: editing.id, tenant_id: tenant.id, entry_type: "opening_balance",
            amount: openingBalance, description: "Opening balance", entry_date: new Date().toISOString().slice(0, 10), created_by: user?.id,
          });
        }
      }
      toast.success(t("shops.updated"));
    } else {
      const { data: inserted, error } = await supabase.from("shops").insert({ ...payload, tenant_id: tenant.id, created_by: user?.id }).select("id").single();
      if (error) return toast.error(error.message);
      if (inserted && openingBalance > 0) {
        await supabase.from("shop_ledger_entries").insert({
          shop_id: inserted.id, tenant_id: tenant.id, entry_type: "opening_balance",
          amount: openingBalance, description: "Opening balance", entry_date: new Date().toISOString().slice(0, 10), created_by: user?.id,
        });
      }
      toast.success(t("shops.added"));
    }
    setOpen(false); load();
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("shops").delete().eq("id", delTarget.id);
    if (error) {
      if ((error as any).code === "23503") {
        const { error: e2 } = await supabase.from("shops").update({ deleted_at: new Date().toISOString() } as any).eq("id", delTarget.id);
        if (e2) toast.error(e2.message);
        else { toast.success("This shop has ledger history. It has been archived instead of permanently deleted."); load(); }
      } else toast.error(error.message);
    } else { toast.success(t("common.deleted")); load(); }
    setDelTarget(null);
  };

  return (
    <>
      <CrudPage<Shop>
        title={t("shops.title")}
        subtitle={t("shops.subtitle")}
        rows={rows} loading={loading}
        searchKeys={["name", "contact_person", "phone"]}
        onAdd={() => { setEditing(null); setForm(empty); setOpen(true); }}
        addLabel={t("shops.add")}
        columns={[
          { key: "name", label: t("common.name"), render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "contact", label: t("farms.contact"), render: (r) => r.contact_person || "—" },
          { key: "phone", label: t("common.phone"), render: (r) => r.phone || "—" },
          { key: "address", label: t("common.address"), render: (r) => <span className="text-muted-foreground">{r.address || "—"}</span> },
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
          <DialogHeader><DialogTitle>{editing ? t("shops.edit") : t("shops.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("farms.name")}</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("farms.contact_person")}</Label><Input value={form.contact_person ?? ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
              <div><Label>{t("common.phone")}</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><Label>{t("common.address")}</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div>
              <Label>Opening Balance (previous due)</Label>
              <Input type="number" min="0" step="0.01" value={form.opening_balance ?? 0}
                onChange={(e) => setForm({ ...form, opening_balance: e.target.value === "" ? 0 : Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground mt-1">Amount the shop already owed before using this system. Shows in the shop ledger as the first entry.</p>
            </div>
            <div><Label>{t("common.notes")}</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("shops.delete_q")}</AlertDialogTitle><AlertDialogDescription>{t("shops.delete_warn")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={doDelete}>{t("common.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Shops;