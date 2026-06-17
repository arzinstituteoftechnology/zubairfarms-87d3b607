import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Printer, Pencil, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { format } from "date-fns";

type Shop = { id: string; name: string };
type Profile = { id: string; full_name: string | null };
type Recovery = {
  id: string;
  shop_id: string;
  recovery_date: string;
  amount: number;
  payment_method: "cash" | "bank" | "jazzcash" | "easypaisa";
  notes: string | null;
  collected_by: string | null;
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
  const { user, tenant } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rows, setRows] = useState<Recovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm());
  const [filterDate, setFilterDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: sh }, { data: pr }, { data: rc }] = await Promise.all([
      supabase.from("shops").select("id, name").order("name"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("shop_recoveries").select("*").order("recovery_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    setShops((sh ?? []) as Shop[]);
    setProfiles((pr ?? []) as Profile[]);
    setRows((rc ?? []) as Recovery[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? "—";
  const userName = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.full_name || "—" : "—");

  const openNew = () => {
    setForm({ ...emptyForm(), collected_by: user?.id ?? "" });
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
      collected_by: form.collected_by || user?.id || null,
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
    if (!confirm("Delete this recovery? Shop ledger will be recalculated.")) return;
    const { error } = await supabase.from("shop_recoveries").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Recovery deleted");
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

  const totals = useMemo(() => {
    const t = { total: 0, cash: 0, bank: 0, jazzcash: 0, easypaisa: 0 } as Record<string, number>;
    filtered.forEach((r) => {
      t.total += Number(r.amount);
      t[r.payment_method] += Number(r.amount);
    });
    return t;
  }, [filtered]);

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 print-area">
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Total</div><div className="text-xl font-bold">{fmtMoney(totals.total)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Cash</div><div className="text-lg font-semibold">{fmtMoney(totals.cash)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Bank</div><div className="text-lg font-semibold">{fmtMoney(totals.bank)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">JazzCash</div><div className="text-lg font-semibold">{fmtMoney(totals.jazzcash)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Easypaisa</div><div className="text-lg font-semibold">{fmtMoney(totals.easypaisa)}</div></CardContent></Card>
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
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center p-6 text-muted-foreground">No recoveries</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="force-ltr">{r.recovery_date}</TableCell>
                  <TableCell className="font-medium">{shopName(r.shop_id)}</TableCell>
                  <TableCell className="text-end force-ltr">{fmtMoney(Number(r.amount))}</TableCell>
                  <TableCell>{METHOD_LABEL[r.payment_method]}</TableCell>
                  <TableCell>{userName(r.collected_by)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.notes || "—"}</TableCell>
                  <TableCell className="text-end no-print">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
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
              <select className="border rounded-md h-10 px-2 w-full bg-background" value={form.collected_by} onChange={(e) => setForm({ ...form, collected_by: e.target.value })}>
                <option value="">— current user —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0, 8)}</option>)}
              </select>
            </div>
            <div><Label>Reference Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Reference / remarks" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}><Wallet className="h-4 w-4" /> Save Recovery</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DailyRecovery;