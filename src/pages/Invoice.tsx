import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { fmtKg, fmtMoney } from "@/lib/constants";

type Sale = any; type Item = any;

const Invoice = () => {
  const { id } = useParams();
  const [sale, setSale] = useState<Sale | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [thermal, setThermal] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: s }, { data: it }] = await Promise.all([
        supabase.from("pos_sales").select("*, customers(name, phone, address)").eq("id", id).single(),
        supabase.from("pos_sale_items").select("*").eq("sale_id", id),
      ]);
      setSale(s); setItems(it ?? []);
    })();
  }, [id]);

  if (!sale) return <div className="p-8 text-center text-muted-foreground">Loading invoice…</div>;

  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex justify-between items-center mb-4 no-print">
          <Link to="/pos"><Button variant="outline"><ArrowLeft className="h-4 w-4" /> New sale</Button></Link>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setThermal(!thermal)}>{thermal ? "A4 layout" : "Thermal layout"}</Button>
            <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          </div>
        </div>

        <div className={`print-area bg-card border rounded-lg shadow-sm mx-auto ${thermal ? "thermal-print p-3" : "p-8"}`}>
          <div className="text-center border-b pb-3 mb-4">
            <div className={thermal ? "font-bold text-lg" : "text-2xl font-bold"}>MeatFlow</div>
            <div className="text-xs opacity-70">Sales Invoice</div>
          </div>
          <div className={`grid ${thermal ? "grid-cols-1" : "grid-cols-2"} gap-2 text-sm mb-3`}>
            <div><b>Invoice #:</b> {sale.invoice_no}</div>
            <div><b>Date:</b> {sale.sale_date}</div>
            <div><b>Customer:</b> {sale.customers?.name || "Walk-in"}</div>
            <div><b>Type:</b> {sale.sale_type}</div>
            {sale.customers?.phone && <div><b>Phone:</b> {sale.customers.phone}</div>}
          </div>
          <table className="w-full text-sm">
            <thead className="border-y">
              <tr><th className="text-left py-1">Item</th><th className="text-right">Wt</th><th className="text-right">Rate</th><th className="text-right">Faraq</th><th className="text-right">Final</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b">
                  <td className="py-1">{it.meat_type}</td>
                  <td className="text-right">{fmtKg(it.weight_kg)}</td>
                  <td className="text-right">{fmtMoney(it.rate_per_kg)}</td>
                  <td className="text-right">{fmtMoney(it.faraq)}</td>
                  <td className="text-right">{fmtMoney(it.final_rate)}</td>
                  <td className="text-right font-medium">{fmtMoney(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 ml-auto max-w-xs text-sm space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmtMoney(sale.subtotal)}</span></div>
            <div className="flex justify-between"><span>Discount</span><span>{fmtMoney(sale.discount)}</span></div>
            <div className="flex justify-between font-bold text-base border-t pt-1"><span>Total</span><span>{fmtMoney(sale.total)}</span></div>
            <div className="flex justify-between"><span>Paid ({sale.payment_method})</span><span>{fmtMoney(sale.paid)}</span></div>
            <div className="flex justify-between font-semibold"><span>Due</span><span>{fmtMoney(sale.due)}</span></div>
          </div>
          {sale.notes && <div className="mt-3 text-sm border-t pt-2"><b>Notes:</b> {sale.notes}</div>}
          <div className="text-center text-xs opacity-70 mt-6">Thank you for your business!</div>
        </div>
      </div>
    </div>
  );
};
export default Invoice;