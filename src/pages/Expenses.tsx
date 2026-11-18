import { useEffect, useState } from "react";
import { noteIfFinalizedDay } from "@/lib/closingLockToast";
import { validateNonNegative } from "@/lib/formValidation";
import { useQueryClient } from "@tanstack/react-query";
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
import { Pencil, Trash2, Printer } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { printReport } from "@/lib/printReport";
import { useSettingsLists, activeOnly } from "@/hooks/useSettingsLists";

type E = { id: string; category: string; amount: number; expense_date: string; farm_id: string | null; notes: string | null; farms?: { name: string } | null };
const empty = (date = format(new Date(), "yyyy-MM-dd")) => ({ category: "Feed", amount: "", expense_date: date, farm_id: "", notes: "" });

const Expenses = () => {
  const { role, user, tenant } = useAuth();
  const { t } = useTranslation();
  const { expenseCategories } = useSettingsLists();
  const CATEGORIES = activeOnly(expenseCategories).map(c => c.name);
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<E[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty());
  const [editing, setEditing] = useState<E | null>(null);
  const [delTarget, setDelTarget] = useState<E | null>(null);
  const { selectedDate, setSelectedDate } = useLedgerDate();
  const ledgerToday = format(new Date(), "yyyy-MM-dd");

  const load = async (date = selectedDate) => {
    setLoading(true);
    setRows([]);
    const [{ data, error }, fr] = await Promise.all([
      supabase.from("expenses").select("*, farms(name)").eq("expense_date", date).order("created_at", { ascending: false }),
      supabase.from("farms").select("id, name").is("deleted_at", null).order("name"),
    ]);
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setFarms((fr.data as any) ?? []); setLoading(false);
  };
  useEffect(() => { load(selectedDate); }, [selectedDate]);

  const save = async () => {
    if (!form.amount) return toast.error(t("expenses.amount_required"));
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    { const bad = validateNonNegative({ Amount: form.amount }); if (bad) return toast.error(bad); }
    if (!(Number(form.amount) > 0)) return toast.error("Amount must be greater than 0");
    const payload = { category: form.category, amount: Number(form.amount), expense_date: form.expense_date || selectedDate, farm_id: form.farm_id || null, notes: form.notes || null };
    const oldDate = editing?.expense_date;
    const newDate = payload.expense_date;
    console.log("[Expenses] save start", { recordId: editing?.id, oldDate, newDate, selectedDate, payload });
    const op = editing ? supabase.from("expenses").update(payload).eq("id", editing.id) : supabase.from("expenses").insert({ ...payload, tenant_id: tenant.id, created_by: user?.id });
    const { data, error } = await op.select("*").maybeSingle();
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Save failed: no row returned (permission or RLS).");
    const { data: freshRow, error: freshError } = await supabase.from("expenses").select("*, farms(name)").eq("id", data.id).maybeSingle();
    if (freshError) return toast.error(`Saved but reload failed: ${freshError.message}`);
    if (!freshRow) return toast.error("Save failed: updated row could not be reloaded from database.");
    const returnedDate = freshRow.expense_date;
    console.log("[Expenses] saved row", { recordId: freshRow.id, oldDate, newDate, returnedDate });
    if (returnedDate !== newDate) return toast.error(`Date mismatch: requested ${newDate}, DB returned ${returnedDate}`);
    setOpen(false);
    setEditing(null);
    setForm(empty(selectedDate));
    setRows((current) => [freshRow as E, ...current.filter((r) => r.id !== freshRow.id)]);
    setSelectedDate(returnedDate);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["expenses"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "all" }),
    ]);
    await load(returnedDate);
    toast.success(t("common.saved"));
    noteIfFinalizedDay(returnedDate);
  };
  const doDelete = async () => { if (!delTarget) return; const { error } = await supabase.from("expenses").delete().eq("id", delTarget.id); if (error) toast.error(error.message); else { toast.success(t("common.deleted")); noteIfFinalizedDay(delTarget.expense_date); load(selectedDate); } setDelTarget(null); };

  const openEdit = async (rowId: string) => {
    const { data, error } = await supabase.from("expenses").select("*, farms(name)").eq("id", rowId).maybeSingle();
    if (error || !data) return toast.error(error?.message ?? "Failed to load record");
    const r = data as E;
    setEditing(r);
    setForm({ ...r, amount: String(r.amount), farm_id: r.farm_id ?? "" });
    setOpen(true);
  };

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <CrudPage<E>
        title={t("expenses.title")} subtitle={t("expenses.subtitle_total", { value: fmtMoney(total) })}
        rows={rows} loading={loading} searchKeys={["category", "notes"]}
        onAdd={() => { setEditing(null); setForm(empty(selectedDate)); setOpen(true); }} addLabel={t("expenses.add")}
        columns={[
          { key: "date", label: t("common.date"), render: (r) => <span className="force-ltr">{r.expense_date}</span> },
          { key: "cat", label: t("expenses.category"), render: (r) => <span className="font-medium">{r.category}</span> },
          { key: "farm", label: t("suppliers.farm"), render: (r) => r.farms?.name || "—" },
          { key: "notes", label: t("common.notes"), render: (r) => <span className="text-muted-foreground">{r.notes || "—"}</span> },
          { key: "amt", label: t("common.amount"), className: "text-end font-semibold", render: (r) => fmtMoney(r.amount) },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => openEdit(r.id)}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <div className="flex items-end gap-2 -mt-2">
        <Button variant="outline" disabled={selectedDate === ledgerToday} onClick={() => setSelectedDate(ledgerToday)}>{t("dashboard.today_btn")}</Button>
        <Button variant="outline" onClick={() => printReport<E>({
          businessName: tenant?.company_name,
          title: "Expenses Report",
          dateLabel: selectedDate,
          columns: [
            { label: "Category", value: (r) => r.category },
            { label: "Farm", value: (r) => r.farms?.name ?? "—" },
            { label: "Notes", value: (r) => r.notes ?? "—" },
            { label: "Amount", value: (r) => fmtMoney(r.amount), align: "right" },
          ],
          rows,
          totals: [
            { label: "Total Amount", value: fmtMoney(total) },
          ],
          footer: `Printed by ${user?.email ?? ""}`,
        })}><Printer className="h-4 w-4" /> {t("common.print") || "Print"}</Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(empty(selectedDate)); } }}>
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