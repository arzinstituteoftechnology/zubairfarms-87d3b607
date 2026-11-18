import { useEffect, useState } from "react";
import { noteIfFinalizedDay } from "@/lib/closingLockToast";
import { validateNonNegative } from "@/lib/formValidation";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { setLang, type Lang } from "@/i18n";
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
import { fmtKg, fmtMoney } from "@/lib/constants";
import { format } from "date-fns";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { printReport } from "@/lib/printReport";

type D = {
  id: string; truck_id: string | null; farm_id: string | null; destination: string | null;
  loading_date: string; loading_time: string | null; chickens_count: number; total_weight_kg: number;
  fuel_expense: number; labour_expense: number; other_expense: number; notes: string | null;
  trucks?: { number: string; driver_name: string | null } | null; farms?: { name: string } | null;
};
const empty = (date = format(new Date(), "yyyy-MM-dd")) => ({ truck_id: "", farm_id: "", destination: "", loading_date: date, loading_time: "", chickens_count: "0", total_weight_kg: "0", fuel_expense: "0", labour_expense: "0", other_expense: "0", notes: "" });

const Deliveries = () => {
  const { role, user, tenant } = useAuth();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<D[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]); const [farms, setFarms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false); const [form, setForm] = useState<any>(empty());
  const [editing, setEditing] = useState<D | null>(null); const [del, setDel] = useState<D | null>(null);
  const [printRow, setPrintRow] = useState<D | null>(null);
  const { selectedDate, setSelectedDate } = useLedgerDate();
  const ledgerToday = format(new Date(), "yyyy-MM-dd");

  const load = async (date = selectedDate) => {
    setLoading(true);
    setRows([]);
    const [{ data, error }, t, f] = await Promise.all([
      supabase.from("deliveries").select("*, trucks(number, driver_name), farms(name)").eq("loading_date", date).order("created_at", { ascending: false }),
      supabase.from("trucks").select("id, number, driver_name").order("number"),
      supabase.from("farms").select("id, name").is("deleted_at", null).order("name"),
    ]);
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setTrucks(t.data ?? []); setFarms(f.data ?? []); setLoading(false);
  };
  useEffect(() => { load(selectedDate); }, [selectedDate]);

  const save = async () => {
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    { const bad = validateNonNegative({ "Chickens": form.chickens_count, "Total weight": form.total_weight_kg, "Fuel expense": form.fuel_expense, "Labour expense": form.labour_expense, "Other expense": form.other_expense }); if (bad) return toast.error(bad); }
    const payload = {
      truck_id: form.truck_id || null, farm_id: form.farm_id || null, destination: form.destination || null,
      loading_date: form.loading_date || selectedDate, loading_time: form.loading_time || null,
      chickens_count: Number(form.chickens_count) || 0, total_weight_kg: Number(form.total_weight_kg) || 0,
      fuel_expense: Number(form.fuel_expense) || 0, labour_expense: Number(form.labour_expense) || 0, other_expense: Number(form.other_expense) || 0,
      notes: form.notes || null,
    };
    const oldDate = editing?.loading_date;
    const newDate = payload.loading_date;
    console.log("[Deliveries] save start", { recordId: editing?.id, oldDate, newDate, selectedDate, payload });
    const op = editing ? supabase.from("deliveries").update(payload).eq("id", editing.id) : supabase.from("deliveries").insert({ ...payload, tenant_id: tenant.id, created_by: user?.id });
    const { data, error } = await op.select("*").maybeSingle();
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Save failed: no row returned (permission or RLS).");
    const { data: freshRow, error: freshError } = await supabase.from("deliveries").select("*, trucks(number, driver_name), farms(name)").eq("id", data.id).maybeSingle();
    if (freshError) return toast.error(`Saved but reload failed: ${freshError.message}`);
    if (!freshRow) return toast.error("Save failed: updated row could not be reloaded from database.");
    const returnedDate = freshRow.loading_date;
    console.log("[Deliveries] saved row", { recordId: freshRow.id, oldDate, newDate, returnedDate });
    if (returnedDate !== newDate) return toast.error(`Date mismatch: requested ${newDate}, DB returned ${returnedDate}`);
    setOpen(false);
    setEditing(null);
    setForm(empty(selectedDate));
    setRows((current) => [freshRow as D, ...current.filter((r) => r.id !== freshRow.id)]);
    setSelectedDate(returnedDate);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["deliveries"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["inventory"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"], refetchType: "all" }),
    ]);
    await load(returnedDate);
    toast.success(t("common.saved"));
    noteIfFinalizedDay(returnedDate);
  };
  const doDelete = async () => { if (!del) return; const { error } = await supabase.from("deliveries").delete().eq("id", del.id); if (error) toast.error(error.message); else { toast.success(t("common.deleted")); load(selectedDate); } setDel(null); };

  const openEdit = async (rowId: string) => {
    const { data, error } = await supabase.from("deliveries").select("*, trucks(number, driver_name), farms(name)").eq("id", rowId).maybeSingle();
    if (error || !data) return toast.error(error?.message ?? "Failed to load record");
    const r = data as D;
    setEditing(r);
    setForm({ ...r, truck_id: r.truck_id ?? "", farm_id: r.farm_id ?? "", chickens_count: String(r.chickens_count), total_weight_kg: String(r.total_weight_kg), fuel_expense: String(r.fuel_expense), labour_expense: String(r.labour_expense), other_expense: String(r.other_expense) });
    setOpen(true);
  };

  const cur = (i18n.language as Lang) || "en";
  const togglePrintLang = () => setLang(cur === "ur" ? "en" : "ur");

  return (
    <>
      <CrudPage<D>
        title={t("deliveries.title")} subtitle={t("deliveries.subtitle")}
        rows={rows} loading={loading} searchKeys={["destination"]}
        onAdd={() => { setEditing(null); setForm(empty(selectedDate)); setOpen(true); }} addLabel={t("deliveries.add")}
        columns={[
          { key: "d", label: t("deliveries.date"), render: (r) => `${r.loading_date}${r.loading_time ? ` ${r.loading_time}` : ""}` },
          { key: "t", label: t("deliveries.truck"), render: (r) => r.trucks?.number ? <span className="font-medium">{r.trucks.number}{r.trucks.driver_name ? ` · ${r.trucks.driver_name}` : ""}</span> : "—" },
          { key: "f", label: t("deliveries.farm"), render: (r) => r.farms?.name || "—" },
          { key: "dest", label: t("deliveries.destination"), render: (r) => r.destination || "—" },
          { key: "c", label: t("deliveries.chickens"), className: "text-end", render: (r) => r.chickens_count },
          { key: "w", label: t("deliveries.weight"), className: "text-end", render: (r) => fmtKg(r.total_weight_kg) },
          { key: "exp", label: t("deliveries.expenses"), className: "text-end", render: (r) => fmtMoney(Number(r.fuel_expense) + Number(r.labour_expense) + Number(r.other_expense)) },
          { key: "actions", label: "", className: "text-right w-32", render: (r) => (
            <div className="flex justify-end gap-1">
              <Button size="icon" variant="ghost" onClick={() => setPrintRow(r)}><Printer className="h-4 w-4" /></Button>
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => openEdit(r.id)}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDel(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <div className="flex items-end gap-2 -mt-2">
        <Button variant="outline" disabled={selectedDate === ledgerToday} onClick={() => setSelectedDate(ledgerToday)}>{t("dashboard.today_btn")}</Button>
        <Button variant="outline" onClick={() => printReport<D>({
          businessName: tenant?.company_name,
          title: "Deliveries Report",
          dateLabel: selectedDate,
          columns: [
            { label: "Truck", value: (r) => r.trucks?.number ?? "—" },
            { label: "Driver", value: (r) => r.trucks?.driver_name ?? "—" },
            { label: "Farm", value: (r) => r.farms?.name ?? "—" },
            { label: "Destination", value: (r) => r.destination ?? "—" },
            { label: "Chickens", value: (r) => r.chickens_count, align: "right" },
            { label: "Weight (kg)", value: (r) => fmtKg(r.total_weight_kg), align: "right" },
            { label: "Expenses", value: (r) => fmtMoney(Number(r.fuel_expense) + Number(r.labour_expense) + Number(r.other_expense)), align: "right" },
          ],
          rows,
          totals: [
            { label: "Total Chickens", value: String(rows.reduce((s, r) => s + Number(r.chickens_count || 0), 0)) },
            { label: "Total Weight", value: fmtKg(rows.reduce((s, r) => s + Number(r.total_weight_kg || 0), 0)) },
            { label: "Total Expenses", value: fmtMoney(rows.reduce((s, r) => s + Number(r.fuel_expense || 0) + Number(r.labour_expense || 0) + Number(r.other_expense || 0), 0)) },
          ],
          footer: `Printed by ${user?.email ?? ""}`,
        })}><Printer className="h-4 w-4" /> {t("common.print") || "Print"}</Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(empty(selectedDate)); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? t("deliveries.edit") : t("deliveries.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("deliveries.truck")}</Label>
                <Select value={form.truck_id || "__none"} onValueChange={(v) => setForm({ ...form, truck_id: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder={t("deliveries.select_truck")} /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">{t("common.none")}</SelectItem>{trucks.map((tk) => <SelectItem key={tk.id} value={tk.id}>{tk.number}{tk.driver_name ? ` · ${tk.driver_name}` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{t("deliveries.farm")}</Label>
                <Select value={form.farm_id || "__none"} onValueChange={(v) => setForm({ ...form, farm_id: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder={t("deliveries.select_farm")} /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">{t("common.none")}</SelectItem>{farms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>{t("deliveries.loading_date")}</Label><Input type="date" value={form.loading_date} onChange={(e) => setForm({ ...form, loading_date: e.target.value })} /></div>
              <div><Label>{t("deliveries.loading_time")}</Label><Input type="time" value={form.loading_time} onChange={(e) => setForm({ ...form, loading_time: e.target.value })} /></div>
              <div><Label>{t("deliveries.destination")}</Label><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("deliveries.chickens_loaded")}</Label><Input type="number" value={form.chickens_count} onChange={(e) => setForm({ ...form, chickens_count: e.target.value })} /></div>
              <div><Label>{t("deliveries.total_weight_kg")}</Label><Input type="number" step="0.01" value={form.total_weight_kg} onChange={(e) => setForm({ ...form, total_weight_kg: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>{t("deliveries.fuel")}</Label><Input type="number" step="0.01" value={form.fuel_expense} onChange={(e) => setForm({ ...form, fuel_expense: e.target.value })} /></div>
              <div><Label>{t("deliveries.labour")}</Label><Input type="number" step="0.01" value={form.labour_expense} onChange={(e) => setForm({ ...form, labour_expense: e.target.value })} /></div>
              <div><Label>{t("deliveries.other")}</Label><Input type="number" step="0.01" value={form.other_expense} onChange={(e) => setForm({ ...form, other_expense: e.target.value })} /></div>
            </div>
            <div><Label>{t("common.notes")}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!printRow} onOpenChange={(o) => !o && setPrintRow(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle className="no-print flex items-center justify-between gap-2">
            <span>{t("deliveries.slip_heading")}</span>
            <Button variant="outline" size="sm" onClick={togglePrintLang}>{t("invoice.print_in")}: {cur === "ur" ? "EN" : "اردو"}</Button>
          </DialogTitle></DialogHeader>
          {printRow && (
            <>
              <div className="print-area p-6 border rounded-md">
                <div className="text-center border-b pb-3 mb-3">
                  <div className="text-xl font-bold">{t("deliveries.slip_title")}</div>
                  <div className="text-xs text-muted-foreground">{t("app.name")}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><b>{t("deliveries.date")}:</b> <span className="force-ltr">{printRow.loading_date}</span></div>
                  <div><b>{t("deliveries.time")}:</b> <span className="force-ltr">{printRow.loading_time || "—"}</span></div>
                  <div><b>{t("deliveries.truck")}:</b> {printRow.trucks?.number || "—"}</div>
                  <div><b>{t("trucks.driver")}:</b> {printRow.trucks?.driver_name || "—"}</div>
                  <div><b>{t("deliveries.farm")}:</b> {printRow.farms?.name || "—"}</div>
                  <div><b>{t("deliveries.destination")}:</b> {printRow.destination || "—"}</div>
                  <div><b>{t("deliveries.chickens")}:</b> <span className="force-ltr">{printRow.chickens_count}</span></div>
                  <div><b>{t("deliveries.total_weight_kg")}:</b> <span className="force-ltr">{fmtKg(printRow.total_weight_kg)}</span></div>
                </div>
                <div className="mt-4 border-t pt-2 text-sm">
                  <div className="flex justify-between"><span>{t("deliveries.fuel")}</span><span className="force-ltr">{fmtMoney(printRow.fuel_expense)}</span></div>
                  <div className="flex justify-between"><span>{t("deliveries.labour")}</span><span className="force-ltr">{fmtMoney(printRow.labour_expense)}</span></div>
                  <div className="flex justify-between"><span>{t("deliveries.other")}</span><span className="force-ltr">{fmtMoney(printRow.other_expense)}</span></div>
                  <div className="flex justify-between font-bold border-t mt-1 pt-1"><span>{t("deliveries.total_expenses")}</span><span className="force-ltr">{fmtMoney(Number(printRow.fuel_expense) + Number(printRow.labour_expense) + Number(printRow.other_expense))}</span></div>
                </div>
                <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
                  <div>{t("deliveries.driver_sig")}</div>
                  <div>{t("deliveries.receiver_sig")}</div>
                </div>
              </div>
              <DialogFooter className="no-print"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> {t("common.print")}</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("deliveries.delete_q")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={doDelete}>{t("common.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Deliveries;