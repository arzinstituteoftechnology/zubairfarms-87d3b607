import { useEffect, useMemo, useState } from "react";
import { validateNonNegative } from "@/lib/formValidation";
import { noteIfFinalizedDay } from "@/lib/closingLockToast";
import { LoadingValue } from "@/components/LoadingValue";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { CrudPage } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wallet, Printer, Pencil, Trash2, Plus, Undo2, Eye } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { ReverseTransactionDialog } from "@/components/ReverseTransactionDialog";
import { printReport } from "@/lib/printReport";
import {
  computeSupplierBalances,
  buildSupplierLedgerRows,
  type LedgerRow,
} from "@/lib/supplierLedger";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Row = {
  id: string; name: string; phone: string | null;
  opening_balance: number; purchased: number; paid: number; balance: number;
  reversedGross?: { openings: number; purchases: number; payments: number; adjustments: number };
};
type LedgerKind =
  | "opening" | "purchase" | "payment" | "manual_purchase" | "manual_payment"
  | "adjustment_increase" | "adjustment_decrease"
  | "reversed_purchase" | "reversed_payment" | "reversed_manual_purchase" | "reversed_manual_payment"
  | "reversed_adjustment_increase" | "reversed_adjustment_decrease" | "reversed_opening_balance";
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
  rawId?: string; // underlying purchases/farm_payments row id
  raw?: any;
  reversed?: boolean;
  isReversal?: boolean;
  running?: number;
};

const KIND_LABEL: Record<LedgerKind, string> = {
  opening: "Opening Balance",
  purchase: "Purchase",
  payment: "Payment",
  manual_purchase: "Previous Purchase",
  manual_payment: "Previous Payment",
  adjustment_increase: "Adjustment (+)",
  adjustment_decrease: "Adjustment (-)",
  reversed_purchase: "Reversed Purchase",
  reversed_payment: "Reversed Payment",
  reversed_manual_purchase: "Reversed Previous Purchase",
  reversed_manual_payment: "Reversed Previous Payment",
  reversed_adjustment_increase: "Reversed Adjustment (+)",
  reversed_adjustment_decrease: "Reversed Adjustment (-)",
  reversed_opening_balance: "Reversed Opening Balance",
};

type ManualForm = {
  id?: string;
  entry_type: "manual_purchase" | "manual_payment" | "adjustment_increase" | "adjustment_decrease";
  entry_date: string;
  description: string;
  amount: string;
};

type PurchaseForm = {
  id: string;
  purchase_date: string;
  meat_type: string;
  weight_kg: string;
  rate_per_kg: string;
  total_amount: string;
  paid_amount: string;
  payment_method: string;
};

type PaymentForm = {
  id: string;
  payment_date: string;
  amount: string;
  method: string;
};

const Suppliers = () => {
  const { user, tenant, role, isSuperAdmin } = useAuth();
  const canManage = isSuperAdmin || role === "admin";
  const canDelete = isSuperAdmin;
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<Row | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
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
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentForm | null>(null);
  const [reverseEntry, setReverseEntry] = useState<LedgerEntry | null>(null);
  const [confirmDel, setConfirmDel] = useState<LedgerEntry | null>(null);

  const load = async () => {
    setLoading(true);
    setRows([]);
    // Use the shared chronological ledger calculator so summary cards match
    // the ledger dialog, print, exports, and dashboard exactly. Reversed
    // originals and reversal audit entries are excluded from active totals.
    const [{ data: farms }, { data: pu }, { data: pa }, { data: le }] = await Promise.all([
      supabase.from("farms").select("id, name, phone, opening_balance").is("deleted_at", null).order("name"),
      supabase.from("purchases").select("id, farm_id, total_amount, paid_amount, purchase_date, created_at, reversed_at"),
      supabase.from("farm_payments").select("id, farm_id, amount, payment_date, created_at, reversed_at"),
      supabase.from("supplier_ledger_entries").select("id, supplier_id, entry_type, entry_date, amount, created_at, reversed_at, original_entry_id"),
    ]);
    const balances = computeSupplierBalances(farms as any, pu as any, pa as any, le as any);
    const byId: Record<string, typeof balances[number]> = {};
    balances.forEach((b) => (byId[b.id] = b));
    setRows((farms ?? []).map((f: any) => {
      const b = byId[f.id];
      return {
        id: f.id, name: f.name, phone: f.phone,
        opening_balance: b?.opening ?? 0,
        purchased: b?.purchased ?? 0,
        paid: b?.paid ?? 0,
        balance: b?.balance ?? 0,
        reversedGross: b?.reversedGross,
      };
    }));
    setLoading(false);
  };
  useEffect(() => { load(); }, [selectedDate]);

  // Keep the open ledger dialog's summary in sync with the freshly recalculated
  // row totals after any add/edit/delete/reverse operation.
  useEffect(() => {
    if (!ledger) return;
    const fresh = rows.find((r) => r.id === ledger.id);
    if (fresh && (
      fresh.opening_balance !== ledger.opening_balance ||
      fresh.purchased !== ledger.purchased ||
      fresh.paid !== ledger.paid ||
      fresh.balance !== ledger.balance
    )) {
      setLedger(fresh);
    }
  }, [rows, ledger]);

  const openLedger = async (r: Row) => {
    setLedger(r);
    setLedgerFilterDate("");
    setLedgerLoading(true);
    try { await refreshLedger(r); } finally { setLedgerLoading(false); }
  };

  const refreshLedger = async (r: Row) => {
    const [{ data: p }, { data: pr }, { data: le }] = await Promise.all([
      supabase.from("farm_payments").select("id, farm_id, payment_date, amount, method, created_at, reversed_at").eq("farm_id", r.id),
      supabase.from("purchases").select("id, farm_id, purchase_date, total_amount, paid_amount, payment_method, meat_type, weight_kg, rate_per_kg, created_at, reversed_at").eq("farm_id", r.id),
      supabase.from("supplier_ledger_entries").select("id, supplier_id, entry_date, entry_type, description, amount, created_at, reversed_at, original_entry_id").eq("supplier_id", r.id),
    ]);
    // Detect whether the opening_balance ledger row has been reversed —
    // if so, seed the running balance from 0 instead of farms.opening_balance.
    const openingReversed = (le ?? []).some(
      (x: any) => x.entry_type === "opening_balance" && x.reversed_at
    );
    const openingSeed = openingReversed ? 0 : Number(r.opening_balance ?? 0);
    const chrono = buildSupplierLedgerRows(
      openingSeed,
      (pr ?? []) as any,
      (p ?? []) as any,
      (le ?? []) as any,
    );
    // Adapt shared LedgerRow to the local LedgerEntry shape expected by the UI.
    const list: LedgerEntry[] = chrono.map((row) => {
      const meta = row.meta ?? {};
      let metaText = "";
      let kind: LedgerKind;
      if (row.source === "purchase") {
        kind = "purchase";
        metaText = `${meta.meat_type ?? ""} · ${Number(meta.weight_kg ?? 0).toFixed(2)}kg @ ${Number(meta.rate_per_kg ?? 0).toFixed(2)} · ${meta.payment_method ?? ""}`;
      } else if (row.source === "payment") {
        kind = "payment";
        metaText = `Payment · ${meta.method ?? ""}`;
      } else {
        kind = (row.ledgerType === "opening_balance" ? "opening" : (row.ledgerType as LedgerKind));
        metaText = meta.description || KIND_LABEL[kind];
      }
      const editable = !row.reversed && !row.isReversal
        && row.source !== "ledger" ? !row.reversed : (row.source === "ledger" && !row.isReversal && !row.reversed && row.ledgerType !== "opening_balance");
      return {
        id: row.key,
        source: row.source,
        kind,
        date: row.date,
        debit: row.debit,
        credit: row.credit,
        meta: metaText,
        editable,
        ledgerId: row.ledgerId,
        ledgerType: row.ledgerType,
        rawId: row.rawId,
        raw: meta,
        reversed: row.reversed,
        isReversal: row.isReversal,
        // Pass the pre-computed chronological running balance through so
        // the UI never recalculates on the newest-first array.
        ...( { running: row.running } as any ),
      };
    });
    setEntries(list);
  };

  // Running balance was already computed chronologically by
  // buildSupplierLedgerRows. Here we only filter and flip to newest-first.
  const filteredEntries = useMemo(() => {
    const filtered = ledgerFilterDate
      ? entries.filter(e => e.date === ledgerFilterDate)
      : entries;
    return [...filtered].reverse();
  }, [entries, ledgerFilterDate]);

  const addPayment = async () => {
    if (!ledger || !payAmt) return;
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    if (!(Number(payAmt) > 0)) return toast.error("Amount must be greater than 0");
    const { error } = await supabase.from("farm_payments").insert({ farm_id: ledger.id, amount: Number(payAmt), payment_date: payDate, method: payMethod, tenant_id: tenant.id, created_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success(t("suppliers.payment_recorded")); noteIfFinalizedDay(payDate); setPayAmt(""); await refreshLedger(ledger); load();
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
      toast.success("Entry updated"); noteIfFinalizedDay(manualForm.entry_date);
    } else {
      const { error } = await supabase.from("supplier_ledger_entries").insert({
        supplier_id: ledger.id, tenant_id: tenant.id,
        entry_type: manualForm.entry_type, entry_date: manualForm.entry_date,
        description: manualForm.description || null, amount: amt, created_by: user?.id,
      });
      if (error) return toast.error(error.message);
      toast.success("Entry added"); noteIfFinalizedDay(manualForm.entry_date);
    }
    setManualOpen(false);
    await refreshLedger(ledger);
    load();
  };
  const deleteManual = async (e: LedgerEntry) => {
    if (!ledger || !e.ledgerId) return;
    const { error } = await supabase.from("supplier_ledger_entries").delete().eq("id", e.ledgerId);
    if (error) { toast.error(error.message); return; }
    toast.success("Entry deleted");
    setConfirmDel(null);
    await refreshLedger(ledger);
    load();
  };

  const editEntry = (e: LedgerEntry) => {
    if (e.source === "ledger") return editManual(e);
    if (e.source === "purchase" && e.raw) {
      setPurchaseForm({
        id: e.raw.id,
        purchase_date: e.raw.purchase_date,
        meat_type: e.raw.meat_type ?? "",
        weight_kg: String(e.raw.weight_kg ?? ""),
        rate_per_kg: String(e.raw.rate_per_kg ?? ""),
        total_amount: String(e.raw.total_amount ?? ""),
        paid_amount: String(e.raw.paid_amount ?? ""),
        payment_method: e.raw.payment_method ?? "cash",
      });
      setPurchaseOpen(true);
    } else if (e.source === "payment" && e.raw) {
      setPaymentForm({
        id: e.raw.id,
        payment_date: e.raw.payment_date,
        amount: String(e.raw.amount ?? ""),
        method: e.raw.method ?? "cash",
      });
      setPaymentOpen(true);
    }
  };

  const deleteEntry = async (e: LedgerEntry) => {
    if (!ledger) return;
    if (!canDelete) { toast.error("Only Super Admin can delete. Use Reverse instead."); return; }
    if (e.source === "ledger") return deleteManual(e);
    if (!e.rawId) return;
    const table = e.source === "purchase" ? "purchases" : "farm_payments";
    const { error } = await supabase.from(table).delete().eq("id", e.rawId);
    if (error) { toast.error(error.message); return; }
    toast.success("Entry deleted");
    setConfirmDel(null);
    await refreshLedger(ledger);
    load();
  };

  const performReverse = async (e: LedgerEntry, reason: string, notes: string) => {
    if (!ledger) return;
    let res: { error: any } | undefined;
    if (e.source === "purchase" && e.rawId) {
      res = await supabase.rpc("reverse_purchase", { p_id: e.rawId, p_reason: reason, p_notes: notes });
    } else if (e.source === "payment" && e.rawId) {
      res = await supabase.rpc("reverse_farm_payment", { p_id: e.rawId, p_reason: reason, p_notes: notes });
    } else if (e.source === "ledger" && e.ledgerId) {
      res = await supabase.rpc("reverse_supplier_ledger_entry", { p_id: e.ledgerId, p_reason: reason, p_notes: notes });
    } else return;
    if (res?.error) { toast.error(res.error.message); return; }
    toast.success("Transaction reversed");
    setReverseEntry(null);
    await refreshLedger(ledger); load();
  };

  const savePurchase = async () => {
    if (!ledger || !purchaseForm) return;
    { const bad = validateNonNegative({ Weight: purchaseForm.weight_kg, "Rate per kg": purchaseForm.rate_per_kg, "Total amount": purchaseForm.total_amount, "Paid amount": purchaseForm.paid_amount }); if (bad) return toast.error(bad); }
    
    const { error } = await supabase.from("purchases").update({
      purchase_date: purchaseForm.purchase_date,
      meat_type: purchaseForm.meat_type,
      weight_kg: Number(purchaseForm.weight_kg) || 0,
      rate_per_kg: Number(purchaseForm.rate_per_kg) || 0,
      total_amount: Number(purchaseForm.total_amount) || 0,
      paid_amount: Number(purchaseForm.paid_amount) || 0,
      payment_method: purchaseForm.payment_method,
    }).eq("id", purchaseForm.id);
    if (error) return toast.error(error.message);
    toast.success("Purchase updated");
    setPurchaseOpen(false);
    await refreshLedger(ledger);
    load();
  };

  const savePayment = async () => {
    if (!ledger || !paymentForm) return;
    { const bad = validateNonNegative({ Amount: paymentForm.amount }); if (bad) return toast.error(bad); }
    if (!(Number(paymentForm.amount) > 0)) return toast.error("Amount must be greater than 0");
    const { error } = await supabase.from("farm_payments").update({
      payment_date: paymentForm.payment_date,
      amount: Number(paymentForm.amount) || 0,
      method: paymentForm.method,
    }).eq("id", paymentForm.id);
    if (error) return toast.error(error.message);
    toast.success("Payment updated"); noteIfFinalizedDay(paymentForm.payment_date);
    setPaymentOpen(false);
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
              <Button size="sm" variant="outline" className="no-print" onClick={() => ledger && printReport<any>({
                businessName: tenant?.company_name,
                title: `Supplier Ledger — ${ledger.name}`,
                subtitle: ledger.phone ?? "",
                dateLabel: ledgerFilterDate || "All",
                columns: [
                  { label: "Date", value: (e) => e.date },
                  { label: "Type", value: (e) => KIND_LABEL[e.kind as LedgerKind] ?? e.kind },
                  { label: "Detail", value: (e) => e.meta },
                  { label: "Debit", value: (e) => e.debit > 0 ? fmtMoney(e.debit) : "—", align: "right" },
                  { label: "Credit", value: (e) => e.credit > 0 ? fmtMoney(e.credit) : "—", align: "right" },
                  { label: "Balance", value: (e) => fmtMoney(e.running ?? 0), align: "right" },
                ],
                rows: filteredEntries as any,
                totals: [
                  { label: "Opening", value: fmtMoney(ledger.opening_balance) },
                  { label: "Active Purchased", value: fmtMoney(ledger.purchased) },
                  { label: "Active Paid", value: fmtMoney(ledger.paid) },
                  { label: "Current Balance", value: fmtMoney(ledger.balance) },
                ],
                footer: `Printed by ${user?.email ?? ""}`,
              })}>
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
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Opening</div><div className="font-semibold"><LoadingValue loading={ledgerLoading}>{fmtMoney(ledger.opening_balance)}</LoadingValue></div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("suppliers.purchased")}</div><div className="font-semibold"><LoadingValue loading={ledgerLoading}>{fmtMoney(ledger.purchased)}</LoadingValue></div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">{t("suppliers.paid")}</div><div className="font-semibold"><LoadingValue loading={ledgerLoading}>{fmtMoney(ledger.paid)}</LoadingValue></div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Current Balance</div><div className="font-semibold text-destructive"><LoadingValue loading={ledgerLoading}>{fmtMoney(ledger.balance)}</LoadingValue></div></div>
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
                            <div className="flex justify-end gap-1 items-center">
                              {canManage && e.editable && (
                                <Button size="icon" variant="ghost" onClick={() => editEntry(e)} title="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                              )}
                              {canManage && !e.isReversal && !e.reversed && (
                                <Button size="icon" variant="ghost" onClick={() => setReverseEntry(e)} title="Reverse Transaction">
                                  <Undo2 className="h-3.5 w-3.5 text-amber-600" />
                                </Button>
                              )}
                              {e.reversed && <span className="text-[10px] uppercase font-semibold text-amber-600 px-1">Reversed</span>}
                              {canDelete && !e.isReversal && (
                                <Button size="icon" variant="ghost" onClick={() => setConfirmDel(e)} title="Delete"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                              )}
                            </div>
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
      <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Purchase</DialogTitle></DialogHeader>
          {purchaseForm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={purchaseForm.purchase_date} onChange={(e) => setPurchaseForm({ ...purchaseForm, purchase_date: e.target.value })} /></div>
                <div><Label>Meat Type</Label><Input value={purchaseForm.meat_type} onChange={(e) => setPurchaseForm({ ...purchaseForm, meat_type: e.target.value })} /></div>
                <div><Label>Weight (kg)</Label><Input type="number" step="0.01" value={purchaseForm.weight_kg} onChange={(e) => setPurchaseForm({ ...purchaseForm, weight_kg: e.target.value })} /></div>
                <div><Label>Rate / kg</Label><Input type="number" step="0.01" value={purchaseForm.rate_per_kg} onChange={(e) => setPurchaseForm({ ...purchaseForm, rate_per_kg: e.target.value })} /></div>
                <div><Label>Total Amount</Label><Input type="number" step="0.01" value={purchaseForm.total_amount} onChange={(e) => setPurchaseForm({ ...purchaseForm, total_amount: e.target.value })} /></div>
                <div><Label>Paid Amount</Label><Input type="number" step="0.01" value={purchaseForm.paid_amount} onChange={(e) => setPurchaseForm({ ...purchaseForm, paid_amount: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label>Payment Method</Label>
                  <select className="border rounded-md h-10 px-2 w-full bg-background" value={purchaseForm.payment_method} onChange={(e) => setPurchaseForm({ ...purchaseForm, payment_method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="credit">Credit</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseOpen(false)}>Cancel</Button>
            <Button onClick={savePurchase}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Payment</DialogTitle></DialogHeader>
          {paymentForm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} /></div>
                <div><Label>Amount</Label><Input type="number" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label>Method</Label>
                  <select className="border rounded-md h-10 px-2 w-full bg-background" value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={savePayment}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReverseTransactionDialog
        open={!!reverseEntry}
        target={reverseEntry ? { label: `${KIND_LABEL[reverseEntry.kind]} — ${reverseEntry.meta}`, amount: reverseEntry.debit || reverseEntry.credit, date: reverseEntry.date } : null}
        onOpenChange={(o) => !o && setReverseEntry(null)}
        onConfirm={(reason, notes) => reverseEntry ? performReverse(reverseEntry, reason, notes) : Promise.resolve()}
      />
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this ledger entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Hard delete removes the record permanently. Prefer Reverse Transaction to preserve the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDel && deleteEntry(confirmDel)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Suppliers;