import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
type Pay = { id: string; payment_date: string; amount: number; method: string };
type Pur = { id: string; purchase_date: string; total_amount: number; meat_type: string };

const Suppliers = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<Row | null>(null);
  const [pays, setPays] = useState<Pay[]>([]);
  const [purs, setPurs] = useState<Pur[]>([]);
  const [payAmt, setPayAmt] = useState(""); const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payMethod, setPayMethod] = useState("cash");

  const load = async () => {
    setLoading(true);
    const [{ data: farms }, { data: pu }, { data: pa }] = await Promise.all([
      supabase.from("farms").select("id, name, phone").order("name"),
      supabase.from("purchases").select("farm_id, total_amount"),
      supabase.from("farm_payments").select("farm_id, amount"),
    ]);
    const purMap: Record<string, number> = {}, payMap: Record<string, number> = {};
    (pu ?? []).forEach((x: any) => purMap[x.farm_id] = (purMap[x.farm_id] ?? 0) + Number(x.total_amount));
    (pa ?? []).forEach((x: any) => payMap[x.farm_id] = (payMap[x.farm_id] ?? 0) + Number(x.amount));
    setRows((farms ?? []).map((f: any) => ({ ...f, purchased: purMap[f.id] ?? 0, paid: payMap[f.id] ?? 0, balance: (purMap[f.id] ?? 0) - (payMap[f.id] ?? 0) })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openLedger = async (r: Row) => {
    setLedger(r);
    const [{ data: p }, { data: pr }] = await Promise.all([
      supabase.from("farm_payments").select("id, payment_date, amount, method").eq("farm_id", r.id).order("payment_date", { ascending: false }),
      supabase.from("purchases").select("id, purchase_date, total_amount, meat_type").eq("farm_id", r.id).order("purchase_date", { ascending: false }),
    ]);
    setPays((p as any) ?? []); setPurs((pr as any) ?? []);
  };
  const addPayment = async () => {
    if (!ledger || !payAmt) return;
    const { error } = await supabase.from("farm_payments").insert({ farm_id: ledger.id, amount: Number(payAmt), payment_date: payDate, method: payMethod, created_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success("Payment recorded"); setPayAmt(""); openLedger(ledger); load();
  };

  return (
    <>
      <CrudPage<Row>
        title="Suppliers Ledger" subtitle="Farm-wise dues and payments"
        rows={rows} loading={loading} searchKeys={["name", "phone"]}
        columns={[
          { key: "name", label: "Farm", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
          { key: "p", label: "Total purchased", className: "text-right", render: (r) => fmtMoney(r.purchased) },
          { key: "pa", label: "Total paid", className: "text-right", render: (r) => fmtMoney(r.paid) },
          { key: "b", label: "Balance owed", className: "text-right", render: (r) => <span className={r.balance > 0 ? "text-destructive font-semibold" : "text-success font-semibold"}>{fmtMoney(r.balance)}</span> },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => <Button size="icon" variant="ghost" onClick={() => openLedger(r)}><Wallet className="h-4 w-4" /></Button> },
        ]}
      />
      <Dialog open={!!ledger} onOpenChange={(o) => !o && setLedger(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Supplier ledger — {ledger?.name}</DialogTitle></DialogHeader>
          {ledger && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Purchased</div><div className="font-semibold">{fmtMoney(ledger.purchased)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Paid</div><div className="font-semibold">{fmtMoney(ledger.paid)}</div></div>
                <div className="rounded-md border p-3"><div className="text-muted-foreground">Owed</div><div className="font-semibold text-destructive">{fmtMoney(ledger.balance)}</div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                <div><Label>Pay farm</Label><Input type="number" placeholder="Amount" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></div>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                <select className="border rounded-md h-10 px-2" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">Cash</option><option value="bank">Bank</option>
                </select>
                <Button onClick={addPayment}>Record</Button>
              </div>
              <div className="grid md:grid-cols-2 gap-3 text-sm">
                <div><div className="font-semibold mb-2">Purchases</div><div className="max-h-64 overflow-auto border rounded-md divide-y">
                  {purs.length === 0 ? <div className="p-3 text-muted-foreground">None</div> : purs.map((p) => <div key={p.id} className="p-2 flex justify-between"><span>{p.purchase_date} · {p.meat_type}</span><span>{fmtMoney(p.total_amount)}</span></div>)}
                </div></div>
                <div><div className="font-semibold mb-2">Payments</div><div className="max-h-64 overflow-auto border rounded-md divide-y">
                  {pays.length === 0 ? <div className="p-3 text-muted-foreground">None</div> : pays.map((p) => <div key={p.id} className="p-2 flex justify-between"><span>{p.payment_date} ({p.method})</span><span className="text-success">{fmtMoney(p.amount)}</span></div>)}
                </div></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Suppliers;