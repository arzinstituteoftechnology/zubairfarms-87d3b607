import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { CrudPage } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";

const CATEGORIES = ["Feed", "Labour", "Salary", "Transport", "Fuel", "Utilities", "Repairs", "Medicine", "Rent", "Other"];
type E = { id: string; category: string; amount: number; expense_date: string; farm_id: string | null; notes: string | null; farms?: { name: string } | null };
const empty = () => ({ category: "Feed", amount: "", expense_date: format(new Date(), "yyyy-MM-dd"), farm_id: "", notes: "" });

const Expenses = () => {
  const { role, user } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<E[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty());
  const [editing, setEditing] = useState<E | null>(null);
  const [delTarget, setDelTarget] = useState<E | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, fr] = await Promise.all([
      supabase.from("expenses").select("*, farms(name)").order("expense_date", { ascending: false }),
      supabase.from("farms").select("id, name").order("name"),
    ]);
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setFarms((fr.data as any) ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.amount) return toast.error(t("expenses.amount_required"));
    const payload = { category: form.category, amount: Number(form.amount), expense_date: form.expense_date, farm_id: form.farm_id || null, notes: form.notes || null };
    const op = editing ? supabase.from("expenses").update(payload).eq("id", editing.id) : supabase.from("expenses").insert({ ...payload, created_by: user?.id });
    const { error } = await op; if (error) return toast.error(error.message);
    toast.success(t("common.saved")); setOpen(false); load();
  };
  const doDelete = async () => { if (!delTarget) return; const { error } = await supabase.from("expenses").delete().eq("id", delTarget.id); if (error) toast.error(error.message); else { toast.success(t("common.deleted")); load(); } setDelTarget(null); };

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <CrudPage<E>
        title={t("expenses.title")} subtitle={t("expenses.subtitle_total", { value: fmtMoney(total) })}
        rows={rows} loading={loading} searchKeys={["category", "notes"]}
        onAdd={() => { setEditing(null); setForm(empty()); setOpen(true); }} addLabel={t("expenses.add")}
        columns={[
          { key: "date", label: t("common.date"), render: (r) => <span className="force-ltr">{r.expense_date}</span> },
          { key: "cat", label: t("expenses.category"), render: (r) => <span className="font-medium">{r.category}</span> },
          { key: "farm", label: t("suppliers.farm"), render: (r) => r.farms?.name || "—" },
          { key: "notes", label: t("common.notes"), render: (r) => <span className="text-muted-foreground">{r.notes || "—"}</span> },
          { key: "amt", label: t("common.amount"), className: "text-end font-semibold", render: (r) => fmtMoney(r.amount) },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ ...r, amount: String(r.amount), farm_id: r.farm_id ?? "" }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? t("expenses.edit") : t("expenses.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("common.date")}</Label><Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
              <div><Label>{t("common.amount")} *</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("expenses.category")}</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{t("expenses.farm_optional")}</Label>
                <Select value={form.farm_id || "__none"} onValueChange={(v) => setForm({ ...form, farm_id: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">{t("common.none")}</SelectItem>{farms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>{t("common.notes")}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("expenses.delete_q")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={doDelete}>{t("common.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Expenses;