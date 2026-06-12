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
import { Pencil, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";
import { useLedgerDate } from "@/hooks/useLedgerDate";

type C = { id: string; name: string; phone: string | null; address: string | null; credit_limit: number; notes: string | null };
type Sale = { id: string; sale_date: string; total: number; paid: number; due: number };
type Pay = { id: string; payment_date: string; amount: number; method: string; notes: string | null };

const empty = { name: "", phone: "", address: "", credit_limit: "0", notes: "" };

const Customers = () => {
  const { role, user, tenant } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<C[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [editing, setEditing] = useState<C | null>(null);
  const [delTarget, setDelTarget] = useState<C | null>(null);
  const [ledger, setLedger] = useState<C | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [payAmt, setPayAmt] = useState(""); const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payMethod, setPayMethod] = useState("cash");
  const { selectedDate } = useLedgerDate();

  const load = async () => {
    setLoading(true);
    setRows([]);
    setBalances({});
    const [{ data: cs, error }, { data: salesAll }, { data: paysAll }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("pos_sales").select("customer_id, due").eq("sale_date", selectedDate),
      supabase.from("customer_payments").select("customer_id, amount").eq("payment_date", selectedDate),
    ]);
    if (error) toast.error(error.message);
    const bal: Record<string, number> = {};
    (salesAll ?? []).forEach((s: any) => { if (s.customer_id) bal[s.customer_id] = (bal[s.customer_id] ?? 0) + Number(s.due); });
    (paysAll ?? []).forEach((p: any) => { bal[p.customer_id] = (bal[p.customer_id] ?? 0) - Number(p.amount); });
    setBalances(bal); setRows((cs as any) ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, [selectedDate]);

  const save = async () => {
    if (!form.name?.trim()) return toast.error(t("customers.name_required"));
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    const payload = { name: form.name, phone: form.phone || null, address: form.address || null, credit_limit: Number(form.credit_limit) || 0, notes: form.notes || null };
    const op = editing ? supabase.from("customers").update(payload).eq("id", editing.id) : supabase.from("customers").insert({ ...payload, tenant_id: tenant.id, created_by: user?.id });
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success(t("common.saved")); setOpen(false); load();
  };
  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("customers").delete().eq("id", delTarget.id);
    if (error) toast.error(error.message); else { toast.success(t("common.deleted")); load(); }
    setDelTarget(null);
  };
  const openLedger = async (c: C) => {
    setLedger(c);
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("pos_sales").select("id, sale_date, total, paid, due").eq("customer_id", c.id).eq("sale_date", selectedDate).order("sale_date", { ascending: false }),
      supabase.from("customer_payments").select("id, payment_date, amount, method, notes").eq("customer_id", c.id).eq("payment_date", selectedDate).order("payment_date", { ascending: false }),
    ]);
    setSales((s as any) ?? []); setPays((p as any) ?? []);
  };
  const addPayment = async () => {
    if (!ledger || !payAmt) return;
    const { error } = await supabase.from("customer_payments").insert({ customer_id: ledger.id, amount: Number(payAmt), payment_date: payDate, method: payMethod, created_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success(t("customers.payment_recorded")); setPayAmt(""); openLedger(ledger); load();
  };

  return (
    <>
      <CrudPage<C>
        title={t("customers.title")} subtitle={t("customers.subtitle")}
        rows={rows} loading={loading} searchKeys={["name", "phone"]}
        onAdd={() => { setEditing(null); setForm(empty); setOpen(true); }} addLabel={t("customers.add")}
        columns={[
          { key: "name", label: t("common.name"), render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "phone", label: t("common.phone"), render: (r) => r.phone || "—" },
          { key: "credit", label: t("customers.credit_limit"), className: "text-end", render: (r) => fmtMoney(r.credit_limit) },
          { key: "bal", label: t("customers.balance_due"), className: "text-end", render: (r) => <span className={(balances[r.id] ?? 0) > 0 ? "text-destructive font-semibold" : ""}>{fmtMoney(balances[r.id] ?? 0)}</span> },
          { key: "actions", label: "", className: "text-right w-32", render: (r) => (
            <div className="flex justify-end gap-1">
              <Button size="icon" variant="ghost" onClick={() => openLedger(r)} title={t("customers.ledger")}><Wallet className="h-4 w-4" /></Button>
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ ...r, credit_limit: String(r.credit_limit) }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? t("customers.edit") : t("customers.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("farms.name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("common.phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>{t("customers.credit_limit")}</Label><Input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></div>
            </div>
            <div><Label>{t("common.address")}</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>{t("common.notes")}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button onClick={save}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!ledger} onOpenChange={(o) => !o && setLedger(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t("customers.ledger_for", { name: ledger?.name ?? "" })}</DialogTitle></DialogHeader>
          {ledger && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("customers.total_billed")}</div><div className="font-semibold">{fmtMoney(sales.reduce((s, x) => s + Number(x.total), 0))}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("customers.paid")}</div><div className="font-semibold">{fmtMoney(sales.reduce((s, x) => s + Number(x.paid), 0) + pays.reduce((s, x) => s + Number(x.amount), 0))}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("customers.balance_due")}</div><div className="font-semibold text-destructive">{fmtMoney(balances[ledger.id] ?? 0)}</div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                <div><Label>{t("customers.add_payment")}</Label><Input type="number" placeholder={t("common.amount")} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></div>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                <select className="border rounded-md h-10 px-2" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">{t("pos.cash")}</option><option value="bank">{t("pos.bank")}</option><option value="card">{t("pos.card")}</option>
                </select>
                <Button onClick={addPayment}>{t("customers.record")}</Button>
              </div>
              <div className="grid md:grid-cols-2 gap-3 text-sm">
                <div><div className="font-semibold mb-2">{t("customers.sales")}</div><div className="max-h-64 overflow-auto border rounded-md divide-y">
                  {sales.length === 0 ? <div className="p-3 text-muted-foreground">{t("customers.no_sales")}</div> : sales.map((s) => (
                    <div key={s.id} className="p-2 flex justify-between"><span className="force-ltr">{s.sale_date}</span><span className="force-ltr">{fmtMoney(s.total)} <span className="text-destructive">({t("common.due")} {fmtMoney(s.due)})</span></span></div>
                  ))}
                </div></div>
                <div><div className="font-semibold mb-2">{t("customers.payments")}</div><div className="max-h-64 overflow-auto border rounded-md divide-y">
                  {pays.length === 0 ? <div className="p-3 text-muted-foreground">{t("customers.no_payments")}</div> : pays.map((p) => (
                    <div key={p.id} className="p-2 flex justify-between"><span className="force-ltr">{p.payment_date} <span className="text-muted-foreground">({p.method})</span></span><span className="text-success font-medium force-ltr">{fmtMoney(p.amount)}</span></div>
                  ))}
                </div></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("customers.delete_q")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={doDelete}>{t("common.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Customers;