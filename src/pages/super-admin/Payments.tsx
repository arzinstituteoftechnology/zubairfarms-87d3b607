import { useEffect, useState } from "react";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Payments = () => {
  const [rows, setRows] = useState<any[]>([]);
  const load = async () => {
    const { data } = await supabase
      .from("payments")
      .select("id, invoice_number, plan_name, amount, payment_date, expiry_date, status, tenants(company_name)")
      .order("payment_date", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);
  const setStatus = async (id: string, status: string) => {
    await supabase.from("payments").update({ status }).eq("id", id);
    load();
  };
  return (
    <div className="space-y-4 text-zinc-100">
      <h1 className="text-2xl font-bold">Payments</h1>
      <Card className="bg-zinc-900 border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm text-zinc-100">
          <thead className="bg-zinc-800/50 text-zinc-100 text-left">
            <tr><th className="p-3">Invoice</th><th className="p-3">Client</th><th className="p-3">Plan</th><th className="p-3">Amount</th><th className="p-3">Paid</th><th className="p-3">Expiry</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-zinc-800">
                <td className="p-3 font-mono text-xs">{r.invoice_number}</td>
                <td className="p-3">{r.tenants?.company_name ?? "—"}</td>
                <td className="p-3">{r.plan_name}</td>
                <td className="p-3">${Number(r.amount).toFixed(2)}</td>
                <td className="p-3 text-zinc-300">{r.payment_date}</td>
                <td className="p-3 text-zinc-300">{r.expiry_date ?? "—"}</td>
                <td className="p-3">
                  <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">paid</SelectItem><SelectItem value="pending">pending</SelectItem>
                      <SelectItem value="overdue">overdue</SelectItem><SelectItem value="cancelled">cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="p-6 text-center text-zinc-300">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
export default Payments;