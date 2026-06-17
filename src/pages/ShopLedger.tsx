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

type Row = { id: string; name: string; phone: string | null; opening_balance: number; supplied: number; paid: number; balance: number };
type LedgerKind = "opening" | "supply" | "manual_supply" | "manual_payment" | "adjustment_increase" | "adjustment_decrease" | "recovery";
type LedgerEntry = {
  id: string;
  source: "supply" | "ledger";
  kind: LedgerKind;
  date: string;
  debit: number;
  credit: number;
  meta: string;
  editable: boolean;
  ledgerId?: string;
  ledgerType?: string;
  rawId?: string;
  raw?: any;
};

const KIND_LABEL: Record<LedgerKind, string> = {
  opening: "Opening Balance",
  supply: "Supply",
  manual_supply: "Previous Supply",
  manual_payment: "Previous Payment",
  adjustment_increase: "Adjustment (+)",
  adjustment_decrease: "Adjustment (-)",
  recovery: "Recovery",
};

type ManualForm = {
  id?: string;
  entry_type: "manual_supply" | "manual_payment" | "adjustment_increase" | "adjustment_decrease";
  entry_date: string;
  description: string;
  amount: string;
};

type SupplyForm = {
  id: string;
  supply_date: string;
  meat_type: string;
  weight_kg: string;
  rate_per_kg: string;
  notes: string;
};

const ShopLedger = () => {
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<Row | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [payAmt, setPayAmt] = useState("");
  const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payDesc, setPayDesc] = useState("");
  const [ledgerFilterDate, setLedgerFilterDate] = useState<string>("");
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualForm>({
    entry_type: "manual_supply",
    entry_date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    amount: "",
  });
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [supplyForm, setSupplyForm] = useState<SupplyForm | null>(null);

  const load = async () => {
    setLoading(true);
    setRows([]);
    const [{ data: shops }, { data: su }, { data: le }] = await Promise.all([
      supabase.from("shops").select("id, name, phone, opening_balance").order("name"),
      supabase.from("supplies").select("shop_id, total_amount"),
      supabase.from("shop_ledger_entries").select("shop_id, entry_type, amount"),
    ]);
    const supMap: Record<string, number> = {}, payMap: Record<string, number> = {}, adjMap: Record<string, number> = {};
    (su ?? []).forEach((x: any) => {
      supMap[x.shop_id] = (supMap[x.shop_id] ?? 0) + Number(x.total_amount ?? 0);
    });
    (le ?? []).forEach((x: any) => {
      const amt = Number(x.amount ?? 0);
      const sid = x.shop_id;
      if (x.entry_type === "manual_supply" || x.entry_type === "adjustment_increase") adjMap[sid] = (adjMap[sid] ?? 0) + amt;
      else if (x.entry_type === "manual_payment" || x.entry_type === "recovery") payMap[sid] = (payMap[sid] ?? 0) + amt;
      else if (x.entry_type === "adjustment_decrease") adjMap[sid] = (adjMap[sid] ?? 0) - amt;
      // opening_balance lives on shops.opening_balance
    });
    setRows((shops ?? []).map((s: any) => {
      const opening = Number(s.opening_balance ?? 0);
      const supplied = supMap[s.id] ?? 0;
      const paid = payMap[s.id] ?? 0;
      const adj = adjMap[s.id] ?? 0;
      return { id: s.id, name: s.name, phone: s.phone, opening_balance: opening, supplied, paid, balance: opening + supplied - paid + adj };
    }));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openLedger = async (r: Row) => {
    setLedger(r);
    setLedgerFilterDate("");
    setRangeFrom(""); setRangeTo("");
    await refreshLedger(r);
  };

  const refreshLedger = async (r: Row) => {
    const [{ data: su }, { data: le }] = await Promise.all([
      supabase.from("supplies").select("id, supply_date, total_amount, meat_type, weight_kg, rate_per_kg, notes").eq("shop_id", r.id),
      supabase.from("shop_ledger_entries").select("id, entry_date, entry_type, description, amount").eq("shop_id", r.id),
    ]);
    const list: LedgerEntry[] = [];
    (su ?? []).forEach((x: any) => {
      list.push({
        id: `su-${x.id}`, source: "supply", kind: "supply", date: x.supply_date,
        debit: Number(x.total_amount ?? 0), credit: 0,
        meta: `${x.meat_type} · ${Number(x.weight_kg).toFixed(2)}kg @ ${Number(x.rate_per_kg).toFixed(2)}`,
        editable: true, rawId: x.id, raw: x,
      });
    });
    (le ?? []).forEach((x: any) => {
      const amt = Number(x.amount ?? 0);
      const isDebit = x.entry_type === "opening_balance" || x.entry_type === "manual_supply" || x.entry_type === "adjustment_increase";
      const kind: LedgerKind = x.entry_type === "opening_balance" ? "opening" : (x.entry_type as LedgerKind);
      list.push({
        id: `le-${x.id}`, source: "ledger", kind, date: x.entry_date,
        debit: isDebit ? amt : 0, credit: isDebit ? 0 : amt,
        meta: x.description || KIND_LABEL[kind],
        editable: x.entry_type !== "opening_balance" && x.entry_type !== "recovery",
        ledgerId: x.id, ledgerType: x.entry_type,
      });
    });
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    setEntries(list);
  };

  const filteredEntries = useMemo(() => {
    let running = 0;
    const withBalance = entries.map((e) => {
      running += e.debit - e.credit;
      return { ...e, running };
    });
    let filtered = withBalance;
    if (ledgerFilterDate) filtered = filtered.filter(e => e.date === ledgerFilterDate);
    if (rangeFrom) filtered = filtered.filter(e => e.date >= rangeFrom);
    if (rangeTo) filtered = filtered.filter(e => e.date <= rangeTo);
    return [...filtered].reverse();
  }, [entries, ledgerFilterDate, rangeFrom, rangeTo]);

  const addPayment = async () => {
    if (!ledger || !payAmt) return;
    if (!tenant?.id) return toast.error("Account is not linked to an active client.");
    const { error } = await supabase.from("shop_ledger_entries").insert({
      shop_id: ledger.id, tenant_id: tenant.id, entry_type: "manual_payment",
      amount: Number(payAmt), entry_date: payDate, description: payDesc || "Payment received", created_by: user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPayAmt(""); setPayDesc("");
    await refreshLedger(ledger); load();
  };

  const openManual = (type: ManualForm["entry_type"]) => {
    setManualForm({ entry_type: type, entry_date: format(new Date(), "yyyy-MM-dd"), description: "", amount: "" });
    setManualOpen(true);
  };
  const editManual = (e: LedgerEntry) => {
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
      const { error } = await supabase.from("shop_ledger_entries").update({
        entry_type: manualForm.entry_type, entry_date: manualForm.entry_date,
        description: manualForm.description || null, amount: amt,
      }).eq("id", manualForm.id);
      if (error) return toast.error(error.message);
      toast.success("Entry updated");
    } else {
      const { error } = await supabase.from("shop_ledger_entries").insert({
        shop_id: ledger.id, tenant_id: tenant.id,
        entry_type: manualForm.entry_type, entry_date: manualForm.entry_date,
        description: manualForm.description || null, amount: amt, created_by: user?.id,
      });
      if (error) return toast.error(error.message);
      toast.success("Entry added");
    }
    setManualOpen(false);
    await refreshLedger(ledger); load();
  };
  const deleteManual = async (e: LedgerEntry) => {
    if (!ledger || !e.ledgerId) return;
    if (!confirm("Delete this entry?")) return;
    const { error } = await supabase.from("shop_ledger_entries").delete().eq("id", e.ledgerId);
    if (error) return toast.error(error.message);
    toast.success("Entry deleted");
    await refreshLedger(ledger); load();
  };

  const editEntry = (e: LedgerEntry) => {
    if (e.source === "ledger") return editManual(e);
    if (e.source === "supply" && e.raw) {
      setSupplyForm({
        id: e.raw.id,
        supply_date: e.raw.supply_date,
        meat_type: e.raw.meat_type ?? "",
        weight_kg: String(e.raw.weight_kg ?? ""),
        rate_per_kg: String(e.raw.rate_per_kg ?? ""),
        notes: e.raw.notes ?? "",
      });
      setSupplyOpen(true);
    }
  };

  const deleteEntry = async (e: LedgerEntry) => {
    if (!ledger) return;
    if (e.source === "ledger") return deleteManual(e);
    if (!e.rawId) return;
    if (!confirm("Delete this entry? This will recalculate the shop balance.")) return;
    const { error } = await supabase.from("supplies").delete().eq("id", e.rawId);
    if (error) return toast.error(error.message);
    toast.success("Entry deleted");
    await refreshLedger(ledger); load();
  };

  const saveSupply = async () => {
    if (!ledger || !supplyForm) return;
    const { error } = await supabase.from("supplies").update({
      supply_date: supplyForm.supply_date,
      meat_type: supplyForm.meat_type,
      weight_kg: Number(supplyForm.weight_kg) || 0,
      rate_per_kg: Number(supplyForm.rate_per_kg) || 0,
      notes: supplyForm.notes || null,
    }).eq("id", supplyForm.id);
    if (error) return toast.error(error.message);
    toast.success("Supply updated");
    setSupplyOpen(false);
    await refreshLedger(ledger); load();
  };

  return (
    <>
      <CrudPage<Row>
        title="Shop Ledger"
        subtitle="Running balance for each shop (supplies, payments, opening balance & adjustments)"
        rows={rows} loading={loading} searchKeys={["name", "phone"]}
        columns={[
          { key: "name", label: "Shop", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "phone", label: t("common.phone"), render: (r) => r.phone || "—" },
          { key: "op", label: "Opening", className: "text-end", render: (r) => fmtMoney(r.opening_balance) },
          { key: "s", label: "Supplied", className: "text-end", render: (r) => fmtMoney(r.supplied) },
          { key: "pa", label: "Paid", className: "text-end", render: (r) => fmtMoney(r.paid) },
          { key: "b", label: "Balance", className: "text-end", render: (r) => <span className={r.balance > 0 ? "text-destructive font-semibold" : "text-success font-semibold"}>{fmtMoney(r.balance)}</span> },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => <Button size="icon" variant="ghost" onClick={() => openLedger(r)}><Wallet className="h-4 w-4" /></Button> },
        ]}
      />
      <Dialog open={!!ledger} onOpenChange={(o) => !o && setLedger(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Ledger — {ledger?.name ?? ""}</span>
              <Button size="sm" variant="outline" onClick={() => window.print()} className="no-print">
                <Printer className="h-4 w-4" /> Print
              </Button>
            </DialogTitle>
          </DialogHeader>
          {ledger && (
            <div className="space-y-4 print-area">
              <div className="hidden print:block mb-2">
                <div className="text-xl font-bold">{ledger.name}</div>
                <div className="text-xs text-muted-foreground">{ledger.phone || ""}</div>
                <div className="text-xs">{new Date().toLocaleString()}</div>
                {(ledgerFilterDate || rangeFrom || rangeTo) && (
                  <div className="text-xs">
                    Range: <span className="force-ltr">{ledgerFilterDate || rangeFrom || "…"}</span> → <span className="force-ltr">{ledgerFilterDate || rangeTo || "…"}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Opening</div><div className="font-semibold">{fmtMoney(ledger.opening_balance)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Supplied</div><div className="font-semibold">{fmtMoney(ledger.supplied)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Paid</div><div className="font-semibold">{fmtMoney(ledger.paid)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Current Balance</div><div className="font-semibold text-destructive">{fmtMoney(ledger.balance)}</div></div>
              </div>
              <div className="flex flex-wrap gap-2 no-print">
                <Button size="sm" variant="outline" onClick={() => openManual("manual_supply")}><Plus className="h-4 w-4" /> Previous Supply</Button>
                <Button size="sm" variant="outline" onClick={() => openManual("manual_payment")}><Plus className="h-4 w-4" /> Previous Payment</Button>
                <Button size="sm" variant="outline" onClick={() => openManual("adjustment_increase")}><Plus className="h-4 w-4" /> Adjustment (+)</Button>
                <Button size="sm" variant="outline" onClick={() => openManual("adjustment_decrease")}><Plus className="h-4 w-4" /> Adjustment (-)</Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 no-print">
                <div>
                  <Label className="text-xs">Day</Label>
                  <Input type="date" value={ledgerFilterDate} onChange={(e) => { setLedgerFilterDate(e.target.value); setRangeFrom(""); setRangeTo(""); }} className="w-44" />
                </div>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={rangeFrom} onChange={(e) => { setRangeFrom(e.target.value); setLedgerFilterDate(""); }} className="w-44" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={rangeTo} onChange={(e) => { setRangeTo(e.target.value); setLedgerFilterDate(""); }} className="w-44" />
                </div>
                {(ledgerFilterDate || rangeFrom || rangeTo) && <Button variant="outline" size="sm" onClick={() => { setLedgerFilterDate(""); setRangeFrom(""); setRangeTo(""); }}>All</Button>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-end no-print">
                <div><Label>Record Payment</Label><Input type="number" placeholder="Amount" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></div>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                <Input placeholder="Note (optional)" value={payDesc} onChange={(e) => setPayDesc(e.target.value)} className="w-48" />
                <Button onClick={addPayment}>Record</Button>
              </div>
              <div>
                <div className="font-semibold mb-2 text-sm">Ledger</div>
                <div className="max-h-96 overflow-auto border rounded-md print:max-h-none print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase sticky top-0">
                      <tr>
                        <th className="text-start p-2">Date</th>
                        <th className="text-start p-2">Type</th>
                        <th className="text-start p-2">Description</th>
                        <th className="text-end p-2">Debit</th>
                        <th className="text-end p-2">Credit</th>
                        <th className="text-end p-2">Balance</th>
                        <th className="text-end p-2 no-print"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.length === 0 ? <tr><td colSpan={7} className="p-3 text-center text-muted-foreground">No entries</td></tr> : filteredEntries.map((e) => (
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
                                <Button size="icon" variant="ghost" onClick={() => editEntry(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => deleteEntry(e)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
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
          <DialogHeader><DialogTitle>{manualForm.id ? "Edit Ledger Entry" : "Add Manual Entry"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <select className="border rounded-md h-10 px-2 w-full bg-background" value={manualForm.entry_type}
                onChange={(e) => setManualForm({ ...manualForm, entry_type: e.target.value as ManualForm["entry_type"] })}>
                <option value="manual_supply">Previous Supply (Debit)</option>
                <option value="manual_payment">Previous Payment (Credit)</option>
                <option value="adjustment_increase">Adjustment Increase (+)</option>
                <option value="adjustment_decrease">Adjustment Decrease (-)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={manualForm.entry_date} onChange={(e) => setManualForm({ ...manualForm, entry_date: e.target.value })} /></div>
              <div><Label>Amount</Label><Input type="number" min="0" step="0.01" value={manualForm.amount} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} /></div>
            </div>
            <div><Label>Description</Label><Input value={manualForm.description} onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })} placeholder="Optional note" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button onClick={saveManual}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={supplyOpen} onOpenChange={setSupplyOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Supply</DialogTitle></DialogHeader>
          {supplyForm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={supplyForm.supply_date} onChange={(e) => setSupplyForm({ ...supplyForm, supply_date: e.target.value })} /></div>
                <div><Label>Meat Type</Label><Input value={supplyForm.meat_type} onChange={(e) => setSupplyForm({ ...supplyForm, meat_type: e.target.value })} /></div>
                <div><Label>Weight (kg)</Label><Input type="number" step="0.01" value={supplyForm.weight_kg} onChange={(e) => setSupplyForm({ ...supplyForm, weight_kg: e.target.value })} /></div>
                <div><Label>Rate / kg</Label><Input type="number" step="0.01" value={supplyForm.rate_per_kg} onChange={(e) => setSupplyForm({ ...supplyForm, rate_per_kg: e.target.value })} /></div>
                <div className="col-span-2"><Label>Notes</Label><Input value={supplyForm.notes} onChange={(e) => setSupplyForm({ ...supplyForm, notes: e.target.value })} /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplyOpen(false)}>Cancel</Button>
            <Button onClick={saveSupply}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default ShopLedger;