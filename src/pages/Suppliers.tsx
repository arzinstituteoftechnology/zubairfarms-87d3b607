import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { CrudPage } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wallet, Printer, Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";
import { useLedgerDate } from "@/hooks/useLedgerDate";

type Row = { id: string; name: string; phone: string | null; opening_balance: number; purchased: number; paid: number; balance: number };
type LedgerKind = "opening" | "purchase" | "payment" | "manual_purchase" | "manual_payment" | "adjustment_increase" | "adjustment_decrease";
type LedgerEntry = {
  id: string;
  source: "purchase" | "payment" | "ledger";
  kind: LedgerKind;
  date: string;
  debit: number;
  credit: number;
  meta: string;
  editable: boolean;
  ledgerId?: string;
  ledgerType?: string;
};

const KIND_LABEL: Record<LedgerKind, string> = {
  opening: "Opening Balance",
  purchase: "Purchase",
  payment: "Payment",
  manual_purchase: "Previous Purchase",
  manual_payment: "Previous Payment",
  adjustment_increase: "Adjustment (+)",
  adjustment_decrease: "Adjustment (-)",
};

type ManualForm = {
  id?: string;
  entry_type: "manual_purchase" | "manual_payment" | "adjustment_increase" | "adjustment_decrease";
  entry_date: string;
  description: string;
  amount: string;
};

const Suppliers = () => {
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<Row | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [payAmt, setPayAmt] = useState(""); const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payMethod, setPayMethod] = useState("cash");
  const { selectedDate } = useLedgerDate();
  const [ledgerFilterDate, setLedgerFilterDate] = useState<string>("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualForm>({
    entry_type: "manual_purchase",
    entry_date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    amount: "",
  });

  const load = async () => {
    setLoading(true);
    setRows([]);
    // Aggregate the full lifetime balance from purchases, payments, and the manual ledger
    const [{ data: farms }, { data: pu }, { data: pa }, { data: le }] = await Promise.all([
      supabase.from("farms").select("id, name, phone, opening_balance").order("name"),
      supabase.from("purchases").select("farm_id, total_amount, paid_amount"),
      supabase.from("farm_payments").select("farm_id, amount"),
      supabase.from("supplier_ledger_entries").select("supplier_id, entry_type, amount"),
    ]);
    const purMap: Record<string, number> = {}, payMap: Record<string, number> = {}, adjMap: Record<string, number> = {};
    (pu ?? []).forEach((x: any) => {
      purMap[x.farm_id] = (purMap[x.farm_id] ?? 0) + Number(x.total_amount ?? 0);
      payMap[x.farm_id] = (payMap[x.farm_id] ?? 0) + Number(x.paid_amount ?? 0);
    });
    (pa ?? []).forEach((x: any) => payMap[x.farm_id] = (payMap[x.farm_id] ?? 0) + Number(x.amount));
    (le ?? []).forEach((x: any) => {
      const amt = Number(x.amount ?? 0);
      const sid = x.supplier_id;
      if (x.entry_type === "manual_purchase" || x.entry_type === "adjustment_increase") adjMap[sid] = (adjMap[sid] ?? 0) + amt;
      else if (x.entry_type === "manual_payment" || x.entry_type === "adjustment_decrease") adjMap[sid] = (adjMap[sid] ?? 0) - amt;
      // opening_balance is already stored on farms.opening_balance — don't double count
    });
    setRows((farms ?? []).map((f: any) => {
      const opening = Number(f.opening_balance ?? 0);
      const purchased = purMap[f.id] ?? 0;
      const paid = payMap[f.id] ?? 0;
      const adj = adjMap[f.id] ?? 0;
      return { id: f.id, name: f.name, phone: f.phone, opening_balance: opening, purchased, paid, balance: opening + purchased - paid + adj };
    }));
    setLoading(false);
  };
  useEffect(() => { load(); }, [selectedDate]);

  const openLedger = async (r: Row) => {
    setLedger(r);
    setLedgerFilterDate("");
    await refreshLedger(r);
  };

  const refreshLedger = async (r: Row) => {
    const [{ data: p }, { data: pr }, { data: le }] = await Promise.all([
      supabase.from("farm_payments").select("id, payment_date, amount, method").eq("farm_id", r.id),
      supabase.from("purchases").select("id, purchase_date, total_amount, paid_amount, payment_method, meat_type, weight_kg, rate_per_kg").eq("farm_id", r.id),
      supabase.from("supplier_ledger_entries").select("id, entry_date, entry_type, description, amount").eq("supplier_id", r.id),
    ]);
    const list: LedgerEntry[] = [];
    (pr ?? []).forEach((x: any) => {
      list.push({
        id: `pu-${x.id}`, source: "purchase", kind: "purchase", date: x.purchase_date,
        debit: Number(x.total_amount ?? 0), credit: Number(x.paid_amount ?? 0),
        meta: `${x.meat_type} · ${Number(x.weight_kg).toFixed(2)}kg @ ${Number(x.rate_per_kg).toFixed(2)} · ${x.payment_method}`,
        editable: false,
      });
    });
    (p ?? []).forEach((x: any) => {
      list.push({
        id: `pa-${x.id}`, source: "payment", kind: "payment", date: x.payment_date,
        debit: 0, credit: Number(x.amount), meta: `Payment · ${x.method}`,
        editable: false,
      });
    });
    (le ?? []).forEach((x: any) => {
      const amt = Number(x.amount ?? 0);
      const isDebit = x.entry_type === "opening_balance" || x.entry_type === "manual_purchase" || x.entry_type === "adjustment_increase";
      const kind: LedgerKind = x.entry_type === "opening_balance" ? "opening" : (x.entry_type as LedgerKind);
      list.push({
        id: `le-${x.id}`, source: "ledger", kind, date: x.entry_date,
        debit: isDebit ? amt : 0, credit: isDebit ? 0 : amt,
        meta: x.description || KIND_LABEL[kind],
        editable: x.entry_type !== "opening_balance",
        ledgerId: x.id, ledgerType: x.entry_type,
      });
    });
    // Sort oldest first so we can compute a running balance, then reverse for display
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    setEntries(list);
  };

  // Running balance (oldest -> newest), shown newest first
  const filteredEntries = useMemo(() => {
    let running = 0;
    const withBalance = entries.map((e) => {
      running += e.debit - e.credit;
      return { ...e, running };
    });
    const filtered = ledgerFilterDate ? withBalance.filter(e => e.date === ledgerFilterDate) : withBalance;
    return [...filtered].reverse();
  }, [entries, ledgerFilterDate]);

  const addPayment = async () => {
    if (!ledger || !payAmt) return;
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    const { error } = await supabase.from("farm_payments").insert({ farm_id: ledger.id, amount: Number(payAmt), payment_date: payDate, method: payMethod, tenant_id: tenant.id, created_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success(t("suppliers.payment_recorded")); setPayAmt(""); await refreshLedger(ledger); load();
  };

  const openManual = (type: ManualForm["entry_type"]) => {
    setManualForm({ entry_type: type, entry_date: format(new Date(), "yyyy-MM-dd"), description: "", amount: "" });
    setManualOpen(true);
  };
  const editManual = (e: LedgerEntry & { running?: number }) => {
    if (!e.ledgerId || !e.ledgerType || e.ledgerType === "opening_balance") return;
    setManualForm({
      id: e.ledgerId,
      entry_type: e.ledgerType as ManualForm["entry_type"],
      entry_date: e.date,
      description: e.meta,
      amount: String(e.debit || e.credit),
    });
    setManualOpen(true);
  };
  const saveManual = async () => {
    if (!ledger) return;
    if (!tenant?.id) return toast.error("Not linked to a client account.");
    const amt = Number(manualForm.amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (manualForm.id) {
      const { error } = await supabase.from("supplier_ledger_entries").update({
        entry_type: manualForm.entry_type, entry_date: manualForm.entry_date,
        description: manualForm.description || null, amount: amt,
      }).eq("id", manualForm.id);
      if (error) return toast.error(error.message);
      toast.success("Entry updated");
    } else {
      const { error } = await supabase.from("supplier_ledger_entries").insert({
        supplier_id: ledger.id, tenant_id: tenant.id,
        entry_type: manualForm.entry_type, entry_date: manualForm.entry_date,
        description: manualForm.description || null, amount: amt, created_by: user?.id,
      });
      if (error) return toast.error(error.message);
      toast.success("Entry added");
    }
    setManualOpen(false);
    await refreshLedger(ledger);
    load();
  };
  const deleteManual = async (e: LedgerEntry) => {
    if (!ledger || !e.ledgerId) return;
    if (!confirm("Delete this entry?")) return;
    const { error } = await supabase.from("supplier_ledger_entries").delete().eq("id", e.ledgerId);
    if (error) return toast.error(error.message);
    toast.success("Entry deleted");
    await refreshLedger(ledger);
    load();
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
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>{t("suppliers.ledger_for", { name: ledger?.name ?? "" })}</span>
              <Button size="sm" variant="outline" onClick={() => window.print()} className="no-print">
                <Printer className="h-4 w-4" /> {t("common.print") || "Print"}
              </Button>
            </DialogTitle>
          </DialogHeader>
          {ledger && (
            <div className="space-y-4 print-area">
              <div className="hidden print:block mb-2">
                <div className="text-xl font-bold">{ledger.name}</div>
                <div className="text-xs text-muted-foreground">{ledger.phone || ""}</div>
                <div className="text-xs">{new Date().toLocaleString()}</div>
                {ledgerFilterDate && <div className="text-xs">{t("common.date")}: <span className="force-ltr">{ledgerFilterDate}</span></div>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Opening</div><div className="font-semibold">{fmtMoney(ledger.opening_balance)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("suppliers.purchased")}</div><div className="font-semibold">{fmtMoney(ledger.purchased)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("suppliers.paid")}</div><div className="font-semibold">{fmtMoney(ledger.paid)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Current Balance</div><div className="font-semibold text-destructive">{fmtMoney(ledger.balance)}</div></div>
              </div>
              <div className="flex flex-wrap gap-2 no-print">
                <Button size="sm" variant="outline" onClick={() => openManual("manual_purchase")}><Plus className="h-4 w-4" /> Previous Purchase</Button>
                <Button size="sm" variant="outline" onClick={() => openManual("manual_payment")}><Plus className="h-4 w-4" /> Previous Payment</Button>
                <Button size="sm" variant="outline" onClick={() => openManual("adjustment_increase")}><Plus className="h-4 w-4" /> Adjustment (+)</Button>
                <Button size="sm" variant="outline" onClick={() => openManual("adjustment_decrease")}><Plus className="h-4 w-4" /> Adjustment (-)</Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 no-print">
                <div>
                  <Label className="text-xs">{t("common.date")}</Label>
                  <Input type="date" value={ledgerFilterDate} onChange={(e) => setLedgerFilterDate(e.target.value)} className="w-44" />
                </div>
                {ledgerFilterDate && <Button variant="outline" size="sm" onClick={() => setLedgerFilterDate("")}>All</Button>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-end no-print">
                <div><Label>{t("suppliers.pay_farm")}</Label><Input type="number" placeholder={t("common.amount")} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></div>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                <select className="border rounded-md h-10 px-2" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">{t("pos.cash")}</option><option value="bank">{t("pos.bank")}</option>
                </select>
                <Button onClick={addPayment}>{t("suppliers.record")}</Button>
              </div>
              <div>
                <div className="font-semibold mb-2 text-sm">{t("suppliers.daily_ledger")}</div>
                <div className="max-h-96 overflow-auto border rounded-md print:max-h-none print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase sticky top-0">
                      <tr>
                        <th className="text-start p-2">{t("common.date")}</th>
                        <th className="text-start p-2">Type</th>
                        <th className="text-start p-2">{t("suppliers.detail")}</th>
                        <th className="text-end p-2">{t("suppliers.debit")}</th>
                        <th className="text-end p-2">{t("suppliers.credit")}</th>
                        <th className="text-end p-2">Balance</th>
                        <th className="text-end p-2 no-print"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.length === 0 ? <tr><td colSpan={7} className="p-3 text-center text-muted-foreground">{t("suppliers.no_entries")}</td></tr> : filteredEntries.map((e) => (
                        <tr key={e.id} className="border-t">
                          <td className="p-2 force-ltr">{e.date}</td>
                          <td className="p-2 text-xs text-muted-foreground">{KIND_LABEL[e.kind]}</td>
                          <td className="p-2">{e.meta}</td>
                          <td className="p-2 text-end force-ltr">{e.debit > 0 ? fmtMoney(e.debit) : "—"}</td>
                          <td className="p-2 text-end text-success force-ltr">{e.credit > 0 ? fmtMoney(e.credit) : "—"}</td>
                          <td className="p-2 text-end force-ltr font-medium">{fmtMoney((e as any).running ?? 0)}</td>
                          <td className="p-2 text-end no-print">
                            {e.editable && (
                              <div className="flex justify-end gap-1">
                                <Button size="icon" variant="ghost" onClick={() => editManual(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => deleteManual(e)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                              </div>
                            )}
                          </td>
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
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{manualForm.id ? "Edit Ledger Entry" : "Add Manual Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <select className="border rounded-md h-10 px-2 w-full bg-background" value={manualForm.entry_type}
                onChange={(e) => setManualForm({ ...manualForm, entry_type: e.target.value as ManualForm["entry_type"] })}>
                <option value="manual_purchase">Previous Purchase (Debit)</option>
                <option value="manual_payment">Previous Payment (Credit)</option>
                <option value="adjustment_increase">Adjustment Increase (+)</option>
                <option value="adjustment_decrease">Adjustment Decrease (-)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={manualForm.entry_date} onChange={(e) => setManualForm({ ...manualForm, entry_date: e.target.value })} />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={manualForm.amount} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={manualForm.description} onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })} placeholder="Optional note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button onClick={saveManual}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Suppliers;