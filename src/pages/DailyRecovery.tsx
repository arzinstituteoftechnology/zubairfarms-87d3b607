import { mergeCollections, sumActive, type CollectionRow } from "@/lib/recoveries";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Printer, Pencil, Trash2, Wallet, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";
import { ReverseTransactionDialog } from "@/components/ReverseTransactionDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Shop = { id: string; name: string };
type Recovery = {
  id: string;
  shop_id: string;
  recovery_date: string;
  amount: number;
  payment_method: "cash" | "bank" | "jazzcash" | "easypaisa";
  notes: string | null;
  collected_by: string | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
};

const METHODS: Recovery["payment_method"][] = ["cash", "bank", "jazzcash", "easypaisa"];
const METHOD_LABEL: Record<Recovery["payment_method"], string> = {
  cash: "Cash", bank: "Bank", jazzcash: "JazzCash", easypaisa: "Easypaisa",
};

type Form = {
  id?: string;
  shop_id: string;
  recovery_date: string;
  amount: string;
  payment_method: Recovery["payment_method"];
  notes: string;
  collected_by: string;
};

const emptyForm = (): Form => ({
  shop_id: "",
  recovery_date: format(new Date(), "yyyy-MM-dd"),
  amount: "",
  payment_method: "cash",
  notes: "",
  collected_by: "",
});

const DailyRecovery = () => {
  const { user, tenant, role, isSuperAdmin } = useAuth();
  const canManage = isSuperAdmin || role === "admin";
  const canDelete = isSuperAdmin;
  const [shops, setShops] = useState<Shop[]>([]);
  const [rows, setRows] = useState<Recovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm());
  const [filterDate, setFilterDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [reverseTarget, setReverseTarget] = useState<Recovery | null>(null);
  const [confirmDel, setConfirmDel] = useState<Recovery | null>(null);
  const [ledgerPays, setLedgerPays] = useState<CollectionRow[]>([]);

  const load = async () => {
    setLoading(true);
    const [{ data: sh }, { data: rc }, { data: lp }] = await Promise.all([
      supabase.from("shops").select("id, name").is("deleted_at", null).order("name"),
      supabase.from("shop_recoveries").select("*").order("recovery_date", { ascending: false }).order("created_at", { ascending: false }),
      (supabase as any).from("shop_ledger_entries")
        .select("id, shop_id, entry_date, entry_type, amount, description, created_by, created_at, reversed_at, original_entry_id")
        .eq("entry_type", "manual_payment"),
    ]);
    setShops((sh ?? []) as Shop[]);
    setRows((rc ?? []) as Recovery[]);
    // Shop Ledger payments are part of the same collections source (see lib/recoveries).
    setLedgerPays(mergeCollections([], lp ?? []));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? "—";

  const openNew = () => {
    setForm(emptyForm());
    setOpen(true);
  };
  const openEdit = (r: Recovery) => {
    setForm({
      id: r.id,
      shop_id: r.shop_id,
      recovery_date: r.recovery_date,
      amount: String(r.amount),
      payment_method: r.payment_method,
      notes: r.notes ?? "",
      collected_by: r.collected_by ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!tenant?.id) return toast.error("Account is not linked to an active client.");
    if (!form.shop_id) return toast.error("Select a shop");
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    const payload = {
      shop_id: form.shop_id,
      recovery_date: form.recovery_date,
      amount: amt,
      payment_method: form.payment_method,
      notes: form.notes || null,
      collected_by: form.collected_by || null,
    };
    if (form.id) {
      const { error } = await supabase.from("shop_recoveries").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success("Recovery updated");
    } else {
      const { error } = await supabase.from("shop_recoveries").insert({ ...payload, tenant_id: tenant.id, created_by: user?.id });
      if (error) return toast.error(error.message);
      toast.success("Recovery saved");
    }
    setOpen(false);
    load();
  };

  const remove = async (r: Recovery) => {
    if (!canDelete) { toast.error("Only Super Admin can delete. Use Reverse instead."); return; }
    const { error } = await supabase.from("shop_recoveries").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Recovery deleted");
    setConfirmDel(null);
    load();
  };

  const performReverse = async (r: Recovery, reason: string, notes: string) => {
    const { error } = await supabase.rpc("reverse_shop_recovery", { p_id: r.id, p_reason: reason, p_notes: notes });
    if (error) { toast.error(error.message); return; }
    toast.success("Recovery reversed");
    setReverseTarget(null);
    load();
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterDate && r.recovery_date !== filterDate) return false;
      if (rangeFrom && r.recovery_date < rangeFrom) return false;
      if (rangeTo && r.recovery_date > rangeTo) return false;
      return true;
    });
  }, [rows, filterDate, rangeFrom, rangeTo]);

  const filteredLedger = useMemo(() => ledgerPays.filter((r) => {
    if (filterDate && r.date !== filterDate) return false;
    if (rangeFrom && r.date < rangeFrom) return false;
    if (rangeTo && r.date > rangeTo) return false;
    return true;
  }), [ledgerPays, filterDate, rangeFrom, rangeTo]);

  const totals = useMemo(() => {
    const t = { total: 0, cash: 0, bank: 0, jazzcash: 0, easypaisa: 0, ledger: 0 } as Record<string, number>;
    filtered.forEach((r) => {
      if (r.reversed_at) return;
      t.total += Number(r.amount);
      t[r.payment_method] = (t[r.payment_method] ?? 0) + Number(r.amount);
    });
    t.ledger = sumActive(filteredLedger);
    t.total = Math.round((t.total + t.ledger) * 100) / 100;
    return t;
  }, [filtered, filteredLedger]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Recovery</h1>
          <p className="text-sm text-muted-foreground">Record money collected from shops — automatically posted to the shop ledger.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          <Button onClick={openNew}><Plus className="h-4 w-4" /> New Recovery</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 print-area">
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Total</div><div className="text-xl font-bold">{loading ? "…" : fmtMoney(totals.total)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Cash</div><div className="text-lg font-semibold">{loading ? "…" : fmtMoney(totals.cash)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Bank</div><div className="text-lg font-semibold">{loading ? "…" : fmtMoney(totals.bank)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">JazzCash</div><div className="text-lg font-semibold">{loading ? "…" : fmtMoney(totals.jazzcash)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Easypaisa</div><div className="text-lg font-semibold">{loading ? "…" : fmtMoney(totals.easypaisa)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Shop Ledger payments</div><div className="text-lg font-semibold">{loading ? "…" : fmtMoney(totals.ledger)}</div></CardContent></Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3 mb-3 no-print">
          <div>
            <Label className="text-xs">Day</Label>
            <Input type="date" value={filterDate} onChange={(e) => { setFilterDate(e.target.value); setRangeFrom(""); setRangeTo(""); }} className="w-44" />
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={rangeFrom} onChange={(e) => { setRangeFrom(e.target.value); setFilterDate(""); }} className="w-44" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={rangeTo} onChange={(e) => { setRangeTo(e.target.value); setFilterDate(""); }} className="w-44" />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setFilterDate(""); setRangeFrom(""); setRangeTo(""); }}>All</Button>
        </div>
        <div className="rounded-md border overflow-x-auto print-area">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead className="text-end">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Collected By</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-end no-print"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center p-6 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 && filteredLedger.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center p-6 text-muted-foreground">No recoveries</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="force-ltr">{r.recovery_date}</TableCell>
                  <TableCell className="font-medium">{shopName(r.shop_id)}</TableCell>
                  <TableCell className="text-end force-ltr">{fmtMoney(Number(r.amount))}</TableCell>
                  <TableCell>{METHOD_LABEL[r.payment_method]}</TableCell>
                  <TableCell>{r.collected_by || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.notes || "—"}</TableCell>
                  <TableCell className="text-end no-print">
                    <div className="flex justify-end gap-1 items-center">
                      {canManage && !r.reversed_at && (
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                      )}
                      {canManage && !r.reversed_at && (
                        <Button size="icon" variant="ghost" onClick={() => setReverseTarget(r)} title="Reverse Transaction">
                          <Undo2 className="h-3.5 w-3.5 text-amber-600" />
                        </Button>
                      )}
                      {r.reversed_at && <span className="text-[10px] uppercase font-semibold text-amber-600 px-1">Reversed</span>}
                      {canDelete && (
                        <Button size="icon" variant="ghost" onClick={() => setConfirmDel(r)} title="Delete"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filteredLedger.map((r) => (
                <TableRow key={"l-" + r.id} className={r.reversed_at ? "opacity-60" : ""}>
                  <TableCell className="force-ltr">{r.date}</TableCell>
                  <TableCell className="font-medium">{shopName(r.shop_id)}</TableCell>
                  <TableCell className="text-end force-ltr">{fmtMoney(r.amount)}</TableCell>
                  <TableCell><Badge variant="secondary">Shop Ledger payment</Badge></TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.notes || "—"}</TableCell>
                  <TableCell className="text-end no-print text-xs text-muted-foreground">
                    {r.reversed_at ? <span className="text-[10px] uppercase font-semibold text-amber-600 px-1">Reversed</span> : "Edit in Shop Ledger"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Edit Recovery" : "New Recovery"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Shop</Label>
              <select className="border rounded-md h-10 px-2 w-full bg-background" value={form.shop_id} onChange={(e) => setForm({ ...form, shop_id: e.target.value })}>
                <option value="">Select a shop…</option>
                {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={form.recovery_date} onChange={(e) => setForm({ ...form, recovery_date: e.target.value })} /></div>
              <div><Label>Amount Received</Label><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div>
              <Label>Payment Method</Label>
              <select className="border rounded-md h-10 px-2 w-full bg-background" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as Recovery["payment_method"] })}>
                {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </div>
            <div>
              <Label>Collected By</Label>
              <Input
                value={form.collected_by}
                onChange={(e) => setForm({ ...form, collected_by: e.target.value })}
                placeholder="e.g. Zeeshan, Driver Ahmed, Salesman Bilal"
              />
            </div>
            <div><Label>Reference Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Reference / remarks" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}><Wallet className="h-4 w-4" /> Save Recovery</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReverseTransactionDialog
        open={!!reverseTarget}
        target={reverseTarget ? { label: `Recovery — ${shopName(reverseTarget.shop_id)}`, amount: Number(reverseTarget.amount), date: reverseTarget.recovery_date } : null}
        onOpenChange={(o) => !o && setReverseTarget(null)}
        onConfirm={(reason, notes) => reverseTarget ? performReverse(reverseTarget, reason, notes) : Promise.resolve()}
      />
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this recovery?</AlertDialogTitle>
            <AlertDialogDescription>
              Hard delete removes the record permanently. Prefer Reverse Transaction to preserve the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDel && remove(confirmDel)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DailyRecovery;