import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { CrudPage } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";

type Row = { id: string; name: string; phone: string | null; purchased: number; paid: number; balance: number };
type LedgerEntry = {
  id: string; date: string; kind: "purchase" | "payment";
  debit: number; credit: number; meta: string;
};

const Suppliers = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<Row | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [payAmt, setPayAmt] = useState(""); const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payMethod, setPayMethod] = useState("cash");

  const load = async () => {
    setLoading(true);
    const [{ data: farms }, { data: pu }, { data: pa }] = await Promise.all([
      supabase.from("farms").select("id, name, phone").order("name"),
      supabase.from("purchases").select("farm_id, total_amount, paid_amount"),
      supabase.from("farm_payments").select("farm_id, amount"),
    ]);
    const purMap: Record<string, number> = {}, payMap: Record<string, number> = {};
    (pu ?? []).forEach((x: any) => {
      purMap[x.farm_id] = (purMap[x.farm_id] ?? 0) + Number(x.total_amount);
      payMap[x.farm_id] = (payMap[x.farm_id] ?? 0) + Number(x.paid_amount ?? 0);
    });
    (pa ?? []).forEach((x: any) => payMap[x.farm_id] = (payMap[x.farm_id] ?? 0) + Number(x.amount));
    setRows((farms ?? []).map((f: any) => ({ ...f, purchased: purMap[f.id] ?? 0, paid: payMap[f.id] ?? 0, balance: (purMap[f.id] ?? 0) - (payMap[f.id] ?? 0) })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openLedger = async (r: Row) => {
    setLedger(r);
    const [{ data: p }, { data: pr }] = await Promise.all([
      supabase.from("farm_payments").select("id, payment_date, amount, method").eq("farm_id", r.id).order("payment_date", { ascending: false }),
      supabase.from("purchases").select("id, purchase_date, total_amount, paid_amount, payment_method, meat_type, weight_kg, rate_per_kg").eq("farm_id", r.id).order("purchase_date", { ascending: false }),
    ]);
    const list: LedgerEntry[] = [];
    (pr ?? []).forEach((x: any) => {
      list.push({ id: `pu-${x.id}`, date: x.purchase_date, kind: "purchase", debit: Number(x.total_amount), credit: Number(x.paid_amount ?? 0), meta: `${x.meat_type} · ${Number(x.weight_kg).toFixed(2)}kg @ ${Number(x.rate_per_kg).toFixed(2)} · ${x.payment_method}` });
    });
    (p ?? []).forEach((x: any) => {
      list.push({ id: `pa-${x.id}`, date: x.payment_date, kind: "payment", debit: 0, credit: Number(x.amount), meta: `Payment · ${x.method}` });
    });
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    setEntries(list);
  };
  const addPayment = async () => {
    if (!ledger || !payAmt) return;
    const { error } = await supabase.from("farm_payments").insert({ farm_id: ledger.id, amount: Number(payAmt), payment_date: payDate, method: payMethod, created_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success(t("suppliers.payment_recorded")); setPayAmt(""); openLedger(ledger); load();
  };

  return (
    <>
      <CrudPage<Row>
        title={t("suppliers.title")} subtitle={t("suppliers.subtitle")}
        rows={rows} loading={loading} searchKeys={["name", "phone"]}
        columns={[
          { key: "name", label: t("suppliers.farm"), render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "phone", label: t("common.phone"), render: (r) => r.phone || "—" },
          { key: "p", label: t("suppliers.total_purchased"), className: "text-end", render: (r) => fmtMoney(r.purchased) },
          { key: "pa", label: t("suppliers.total_paid"), className: "text-end", render: (r) => fmtMoney(r.paid) },
          { key: "b", label: t("suppliers.balance_owed"), className: "text-end", render: (r) => <span className={r.balance > 0 ? "text-destructive font-semibold" : "text-success font-semibold"}>{fmtMoney(r.balance)}</span> },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => <Button size="icon" variant="ghost" onClick={() => openLedger(r)}><Wallet className="h-4 w-4" /></Button> },
        ]}
      />
      <Dialog open={!!ledger} onOpenChange={(o) => !o && setLedger(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t("suppliers.ledger_for", { name: ledger?.name ?? "" })}</DialogTitle></DialogHeader>
          {ledger && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("suppliers.purchased")}</div><div className="font-semibold">{fmtMoney(ledger.purchased)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("suppliers.paid")}</div><div className="font-semibold">{fmtMoney(ledger.paid)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("suppliers.owed")}</div><div className="font-semibold text-destructive">{fmtMoney(ledger.balance)}</div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                <div><Label>{t("suppliers.pay_farm")}</Label><Input type="number" placeholder={t("common.amount")} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></div>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                <select className="border rounded-md h-10 px-2" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">{t("pos.cash")}</option><option value="bank">{t("pos.bank")}</option>
                </select>
                <Button onClick={addPayment}>{t("suppliers.record")}</Button>
              </div>
              <div>
                <div className="font-semibold mb-2 text-sm">{t("suppliers.daily_ledger")}</div>
                <div className="max-h-80 overflow-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase sticky top-0">
                      <tr><th className="text-start p-2">{t("common.date")}</th><th className="text-start p-2">{t("suppliers.detail")}</th><th className="text-end p-2">{t("suppliers.debit")}</th><th className="text-end p-2">{t("suppliers.credit")}</th></tr>
                    </thead>
                    <tbody>
                      {entries.length === 0 ? <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">{t("suppliers.no_entries")}</td></tr> : entries.map((e) => (
                        <tr key={e.id} className="border-t">
                          <td className="p-2 force-ltr">{e.date}</td>
                          <td className="p-2">{e.meta}</td>
                          <td className="p-2 text-end force-ltr">{e.debit > 0 ? fmtMoney(e.debit) : "—"}</td>
                          <td className="p-2 text-end text-success force-ltr">{e.credit > 0 ? fmtMoney(e.credit) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Suppliers;