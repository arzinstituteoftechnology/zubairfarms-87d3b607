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
import { Pencil, Trash2, Printer } from "lucide-react";
import { toast } from "sonner";
import { MEAT_TYPES, fmtKg, fmtMoney } from "@/lib/constants";
import { format } from "date-fns";

type Row = {
  id: string; farm_id: string; meat_type: string; weight_kg: number; rate_per_kg: number;
  total_amount: number; purchase_date: string; notes: string | null; faraq: number;
  paid_amount: number; payment_method: string;
  farms?: { name: string } | null;
};

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyForm = () => ({ farm_id: "", meat_type: "Beef", weight_kg: "", rate_per_kg: "", faraq: "0", purchase_date: today(), notes: "", paid_amount: "", payment_method: "credit" });
const calcTotal = (f: any) => {
  const w = Number(f.weight_kg) || 0, r = Number(f.rate_per_kg) || 0, fa = Number(f.faraq) || 0;
  const finalRate = Math.max(0, r - fa);
  return { finalRate, total: finalRate * w };
};

const Purchases = () => {
  const { role, user } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm());
  const [editing, setEditing] = useState<Row | null>(null);
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [filterDate, setFilterDate] = useState<string>(today());

  const load = async (date = filterDate) => {
    setLoading(true);
    const [{ data, error }, fr] = await Promise.all([
      supabase.from("purchases").select("*, farms(name)").eq("purchase_date", date).order("created_at", { ascending: false }),
      supabase.from("farms").select("id, name").order("name"),
    ]);
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setFarms((fr.data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(filterDate); }, [filterDate]);

  const save = async () => {
    if (!form.farm_id || !form.weight_kg || !form.rate_per_kg) return toast.error(t("purchases.required"));
    const { total } = calcTotal(form);
    const paid = form.payment_method === "credit" ? 0 : (Number(form.paid_amount) || (form.payment_method === "cash" || form.payment_method === "bank" ? total : 0));
    const payload = {
      farm_id: editing ? editing.farm_id : form.farm_id,
      meat_type: form.meat_type,
      weight_kg: Number(form.weight_kg), rate_per_kg: Number(form.rate_per_kg),
      faraq: Number(form.faraq) || 0,
      purchase_date: form.purchase_date, notes: form.notes || null,
      paid_amount: paid, payment_method: form.payment_method,
    };
    const op = editing
      ? supabase.from("purchases").update(payload).eq("id", editing.id)
      : supabase.from("purchases").insert({ ...payload, created_by: user?.id });
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success(editing ? t("purchases.updated") : t("purchases.recorded"));
    setOpen(false); load(filterDate);
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("purchases").delete().eq("id", delTarget.id);
    if (error) toast.error(error.message); else { toast.success(t("common.deleted")); load(filterDate); }
    setDelTarget(null);
  };

  return (
    <>
      <div className="print-area">
        <div className="hidden print:block mb-3">
          <div className="text-xl font-bold">{t("purchases.title")}</div>
          <div className="text-sm">{t("common.date")}: <span className="force-ltr">{filterDate}</span></div>
        </div>
        <div className="no-print flex flex-wrap items-end gap-2 mb-3">
          <div>
            <Label className="text-xs">{t("common.date")}</Label>
            <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-44" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setFilterDate(today())}>{t("dashboard.today_btn")}</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> {t("common.print")}</Button>
        </div>
      <CrudPage<Row>
        title={t("purchases.title")}
        subtitle={t("purchases.subtitle")}
        rows={rows} loading={loading}
        searchKeys={["meat_type"]}
        onAdd={() => { setEditing(null); setForm(emptyForm()); setOpen(true); }}
        addLabel={t("purchases.add")}
        columns={[
          { key: "date", label: t("common.date"), render: (r) => <span className="force-ltr">{r.purchase_date}</span> },
          { key: "farm", label: t("suppliers.farm"), render: (r) => <span className="font-medium">{r.farms?.name ?? "—"}</span> },
          { key: "meat", label: t("purchases.meat_col"), render: (r) => r.meat_type },
          { key: "weight", label: t("purchases.weight_col"), className: "text-end", render: (r) => fmtKg(r.weight_kg) },
          { key: "rate", label: t("purchases.rate_col"), className: "text-end", render: (r) => fmtMoney(r.rate_per_kg) },
          { key: "total", label: t("common.total"), className: "text-end font-medium", render: (r) => fmtMoney(r.total_amount) },
          { key: "paid", label: t("common.paid"), className: "text-end", render: (r) => <span className="text-success">{fmtMoney(r.paid_amount)}</span> },
          { key: "bal", label: t("purchases.balance"), className: "text-end", render: (r) => {
            const bal = Number(r.total_amount) - Number(r.paid_amount);
            return <span className={bal > 0 ? "text-destructive font-semibold" : "text-success"}>{fmtMoney(bal)}</span>;
          }},
          { key: "method", label: t("purchases.method"), render: (r) => <span className="text-xs uppercase">{r.payment_method}</span> },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ ...r, purchase_date: r.purchase_date, weight_kg: String(r.weight_kg), rate_per_kg: String(r.rate_per_kg), faraq: String(r.faraq ?? 0), paid_amount: String(r.paid_amount ?? 0), payment_method: r.payment_method ?? "credit" }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? t("purchases.edit") : t("purchases.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("common.date")}</Label><Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
              <div><Label>{t("purchases.farm")}</Label>
                {editing ? (
                  <Input
                    value={farms.find((f) => f.id === editing.farm_id)?.name ?? editing.farms?.name ?? ""}
                    readOnly
                    disabled
                    className="cursor-not-allowed opacity-70"
                  />
                ) : (
                  <Select value={form.farm_id} onValueChange={(v) => setForm({ ...form, farm_id: v })}>
                    <SelectTrigger><SelectValue placeholder={t("purchases.select_farm")} /></SelectTrigger>
                    <SelectContent>{farms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("purchases.meat_type")}</Label>
                <Select value={form.meat_type} onValueChange={(v) => setForm({ ...form, meat_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MEAT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{t("purchases.weight")}</Label><Input type="number" step="0.001" min="0" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>{t("purchases.rate")}</Label><Input type="number" step="0.01" min="0" value={form.rate_per_kg} onChange={(e) => setForm({ ...form, rate_per_kg: e.target.value })} /></div>
              <div><Label>{t("pos.faraq")}</Label><Input type="number" step="0.01" min="0" value={form.faraq} onChange={(e) => setForm({ ...form, faraq: e.target.value })} /></div>
              <div><Label>{t("pos.final_rate")}</Label><Input readOnly value={calcTotal(form).finalRate.toFixed(2)} className="force-ltr bg-muted/40" /></div>
            </div>
            <div className="text-sm text-muted-foreground">{t("purchases.total")}: <span className="font-semibold text-foreground force-ltr">{fmtMoney(calcTotal(form).total)}</span></div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div><Label>{t("purchases.payment_method")}</Label>
                <Select value={form.payment_method} onValueChange={(v) => {
                  const { total } = calcTotal(form);
                  setForm({ ...form, payment_method: v, paid_amount: v === "credit" ? "0" : v === "partial" ? form.paid_amount : String(total.toFixed(2)) });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">{t("purchases.udhaar")}</SelectItem>
                    <SelectItem value="cash">{t("purchases.naqd")}</SelectItem>
                    <SelectItem value="bank">{t("purchases.bank")}</SelectItem>
                    <SelectItem value="partial">{t("purchases.partial")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>{t("purchases.paid_now")}</Label>
                <Input type="number" step="0.01" min="0" value={form.paid_amount}
                  disabled={form.payment_method === "credit"}
                  onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
              </div>
            </div>
            {(() => {
              const { total } = calcTotal(form);
              const paid = form.payment_method === "credit" ? 0 : Number(form.paid_amount) || 0;
              const bal = total - paid;
              return <div className="text-sm flex justify-between bg-muted/40 rounded-md px-3 py-2">
                <span>{t("purchases.balance_udhaar")}: <b className={bal > 0 ? "text-destructive" : "text-success"}>{fmtMoney(bal)}</b></span>
              </div>;
            })()}
            <div><Label>{t("common.notes")}</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("purchases.delete_q")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={doDelete}>{t("common.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Purchases;