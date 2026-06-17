import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { MEAT_TYPES, fmtKg, fmtMoney } from "@/lib/constants";
import { format } from "date-fns";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { printReport } from "@/lib/printReport";

type Row = {
  id: string; shop_id: string; meat_type: string; weight_kg: number; rate_per_kg: number;
  cost_per_kg: number; total_amount: number; supply_date: string; notes: string | null;
  shops?: { name: string } | null;
};
type SupplyForm = {
  shop_id: string; meat_type: string; weight_kg: string; rate_per_kg: string; cost_per_kg: string;
  supply_date: string; notes: string;
};

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyForm = (): SupplyForm => ({ shop_id: "", meat_type: "Beef", weight_kg: "", rate_per_kg: "", cost_per_kg: "", supply_date: today(), notes: "" });

const Supplies = () => {
  const { role, user, tenant } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SupplyForm>(emptyForm());
  const [editing, setEditing] = useState<Row | null>(null);
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const { selectedDate: filterDate, setSelectedDate: setFilterDate, today: ledgerToday } = useLedgerDate();

  const suppliesQuery = useQuery({
    queryKey: ["supplies", filterDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplies")
        .select("*, shops(name)")
        .eq("supply_date", filterDate)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
    placeholderData: [],
  });

  const shopsQuery = useQuery({
    queryKey: ["shops", "supply-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shops").select("id, name").order("name");
      if (error) throw error;
      return (data as { id: string; name: string }[]) ?? [];
    },
    placeholderData: [],
  });

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["supplies", filterDate] });
  }, [filterDate, queryClient]);

  useEffect(() => {
    if (suppliesQuery.error) toast.error(suppliesQuery.error.message);
  }, [suppliesQuery.error]);

  useEffect(() => {
    if (shopsQuery.error) toast.error(shopsQuery.error.message);
  }, [shopsQuery.error]);

  const rows = suppliesQuery.data ?? [];
  const shops = shopsQuery.data ?? [];
  const loading = suppliesQuery.isPending || suppliesQuery.isFetching;

  // Auto-fill cost_per_kg from latest purchase of same meat type
  useEffect(() => {
    if (!form.meat_type || editing) return;
    supabase.from("purchases").select("rate_per_kg").eq("meat_type", form.meat_type)
      .lte("purchase_date", filterDate)
      .order("purchase_date", { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0] && !form.cost_per_kg) setForm((f) => ({ ...f, cost_per_kg: String(data[0].rate_per_kg) }));
      });
  }, [form.meat_type, form.cost_per_kg, editing, filterDate]);

  const save = async () => {
    if (!form.shop_id || !form.weight_kg || !form.rate_per_kg) return toast.error(t("supplies.required"));
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    const payload = {
      shop_id: editing ? editing.shop_id : form.shop_id,
      meat_type: form.meat_type,
      weight_kg: Number(form.weight_kg), rate_per_kg: Number(form.rate_per_kg),
      cost_per_kg: Number(form.cost_per_kg) || 0,
      supply_date: form.supply_date || filterDate, notes: form.notes || null,
    };
    const oldDate = editing?.supply_date;
    const newDate = payload.supply_date;
    console.log("[Supplies] save start", { recordId: editing?.id, oldDate, newDate, selectedDate: filterDate, payload });
    const op = editing
      ? supabase.from("supplies").update(payload).eq("id", editing.id)
      : supabase.from("supplies").insert({ ...payload, tenant_id: tenant.id, created_by: user?.id });
    const { data, error } = await op.select("*").maybeSingle();
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Save failed: no row returned (permission or RLS).");
    const { data: freshRow, error: freshError } = await supabase.from("supplies").select("*, shops(name)").eq("id", data.id).maybeSingle();
    if (freshError) return toast.error(`Saved but reload failed: ${freshError.message}`);
    if (!freshRow) return toast.error("Save failed: updated row could not be reloaded from database.");
    const returnedDate = freshRow.supply_date;
    console.log("[Supplies] saved row", { recordId: freshRow.id, oldDate, newDate, returnedDate });
    if (returnedDate !== newDate) {
      return toast.error(`Date mismatch: requested ${newDate}, DB returned ${returnedDate}`);
    }
    setOpen(false);
    setEditing(null);
    setForm(emptyForm());
    if (oldDate) queryClient.setQueryData<Row[]>(["supplies", oldDate], (oldRows = []) => oldRows.filter((r) => r.id !== freshRow.id));
    queryClient.setQueryData<Row[]>(["supplies", returnedDate], (currentRows = []) => [freshRow as Row, ...currentRows.filter((r) => r.id !== freshRow.id)]);
    setFilterDate(returnedDate);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["supplies"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["inventory"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["customer_payments"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "all" }),
    ]);
    await queryClient.refetchQueries({ queryKey: ["supplies", returnedDate], type: "all" });
    toast.success(editing ? t("supplies.updated") : t("supplies.recorded"));
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("supplies").delete().eq("id", delTarget.id);
    if (error) toast.error(error.message); else { toast.success(t("common.deleted")); queryClient.invalidateQueries({ queryKey: ["supplies", filterDate] }); }
    setDelTarget(null);
  };

  const openEdit = async (rowId: string) => {
    const { data, error } = await supabase.from("supplies").select("*, shops(name)").eq("id", rowId).maybeSingle();
    if (error || !data) return toast.error(error?.message ?? "Failed to load record");
    const r = data as Row;
    setEditing(r);
    setForm({ shop_id: r.shop_id, meat_type: r.meat_type, supply_date: r.supply_date, weight_kg: String(r.weight_kg), rate_per_kg: String(r.rate_per_kg), cost_per_kg: String(r.cost_per_kg), notes: r.notes ?? "" });
    setOpen(true);
  };

  const w = Number(form.weight_kg) || 0;
  const r = Number(form.rate_per_kg) || 0;
  const c = Number(form.cost_per_kg) || 0;
  const profit = w * (r - c);

  return (
    <>
      <CrudPage<Row>
        title={t("supplies.title")}
        subtitle={t("supplies.subtitle")}
        rows={rows} loading={loading}
        searchKeys={["meat_type"]}
        onAdd={() => { setEditing(null); setForm({ ...emptyForm(), supply_date: filterDate }); setOpen(true); }}
        addLabel={t("supplies.add")}
        columns={[
          { key: "date", label: t("common.date"), render: (r) => <span className="force-ltr">{r.supply_date}</span> },
          { key: "shop", label: t("nav.shops"), render: (r) => <span className="font-medium">{r.shops?.name ?? "—"}</span> },
          { key: "meat", label: t("purchases.meat_col"), render: (r) => r.meat_type },
          { key: "weight", label: t("purchases.weight_col"), className: "text-end", render: (r) => fmtKg(r.weight_kg) },
          { key: "rate", label: t("purchases.rate_col"), className: "text-end", render: (r) => fmtMoney(r.rate_per_kg) },
          { key: "total", label: t("common.total"), className: "text-end font-medium", render: (r) => fmtMoney(r.total_amount) },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => openEdit(r.id)}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <div className="flex items-end gap-2 -mt-2">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("common.date")}</Label>
          <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value || ledgerToday)} className="force-ltr w-[180px]" />
        </div>
        <Button variant="outline" disabled={filterDate === ledgerToday} onClick={() => setFilterDate(ledgerToday)}>{t("dashboard.today_btn")}</Button>
        <Button variant="outline" onClick={() => printReport<Row>({
          businessName: tenant?.company_name,
          title: "Supplies Report",
          dateLabel: filterDate,
          columns: [
            { label: "Shop", value: (r) => r.shops?.name ?? "—" },
            { label: "Meat Type", value: (r) => r.meat_type },
            { label: "Weight (kg)", value: (r) => fmtKg(r.weight_kg), align: "right" },
            { label: "Rate/kg", value: (r) => fmtMoney(r.rate_per_kg), align: "right" },
            { label: "Total Amount", value: (r) => fmtMoney(r.total_amount), align: "right" },
          ],
          rows,
          totals: [
            { label: "Total Weight", value: fmtKg(rows.reduce((s, r) => s + Number(r.weight_kg || 0), 0)) },
            { label: "Total Amount", value: fmtMoney(rows.reduce((s, r) => s + Number(r.total_amount || 0), 0)) },
          ],
          footer: `Printed by ${user?.email ?? ""}`,
        })}><Printer className="h-4 w-4" /> {t("common.print") || "Print"}</Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(emptyForm()); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? t("supplies.edit") : t("supplies.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("common.date")}</Label><Input type="date" value={form.supply_date} onChange={(e) => setForm({ ...form, supply_date: e.target.value })} /></div>
              <div><Label>{t("supplies.shop")}</Label>
                {editing ? (
                  <Input
                    value={shops.find((s) => s.id === editing.shop_id)?.name ?? editing.shops?.name ?? ""}
                    readOnly
                    disabled
                    className="cursor-not-allowed opacity-70"
                  />
                ) : (
                  <Select value={form.shop_id} onValueChange={(v) => setForm({ ...form, shop_id: v })}>
                    <SelectTrigger><SelectValue placeholder={t("supplies.select_shop")} /></SelectTrigger>
                    <SelectContent>
                      {shops.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("purchases.meat_type")}</Label>
                <Select value={form.meat_type} onValueChange={(v) => setForm({ ...form, meat_type: v, cost_per_kg: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MEAT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{t("purchases.weight")}</Label><Input type="number" step="0.001" min="0" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("supplies.sale_rate")}</Label><Input type="number" step="0.01" min="0" value={form.rate_per_kg} onChange={(e) => setForm({ ...form, rate_per_kg: e.target.value })} /></div>
              <div><Label>{t("supplies.cost_per_kg")}</Label><Input type="number" step="0.01" min="0" value={form.cost_per_kg} onChange={(e) => setForm({ ...form, cost_per_kg: e.target.value })} /></div>
            </div>
            <div className="text-sm flex justify-between bg-muted rounded-md px-3 py-2">
              <span>{t("common.total")}: <span className="font-semibold text-foreground force-ltr">{fmtMoney(w * r)}</span></span>
              <span>{t("supplies.profit")}: <span className={`font-semibold force-ltr ${profit >= 0 ? "text-success" : "text-destructive"}`}>{fmtMoney(profit)}</span></span>
            </div>
            <div><Label>{t("common.notes")}</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("supplies.delete_q")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={doDelete}>{t("common.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Supplies;