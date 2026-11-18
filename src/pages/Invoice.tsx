import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { setLang, type Lang } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { fmtKg, fmtMoney } from "@/lib/constants";

type Sale = any; type Item = any;

const Invoice = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
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

  if (!sale) return <div className="p-8 text-center text-muted-foreground">{t("invoice.loading")}</div>;

  const cur = (i18n.language as Lang) || "en";
  const toggleLang = () => setLang(cur === "ur" ? "en" : "ur");

  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex justify-between items-center mb-4 no-print">
          <Link to="/pos"><Button variant="outline"><ArrowLeft className="h-4 w-4" /> {t("invoice.new_sale")}</Button></Link>
          <div className="flex gap-2">
            <Button variant="outline" onClick={toggleLang}>{t("invoice.print_in")}: {cur === "ur" ? "EN" : "اردو"}</Button>
            <Button variant="outline" onClick={() => setThermal(!thermal)}>{thermal ? t("invoice.a4") : t("invoice.thermal")}</Button>
            <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> {t("common.print")}</Button>
          </div>
        </div>

        <div className={`print-area bg-card border rounded-lg shadow-sm mx-auto ${thermal ? "thermal-print p-3" : "p-8"}`}>
          <div className="text-center border-b pb-3 mb-4">
            <div className={thermal ? "font-bold text-lg" : "text-2xl font-bold"}>{t("app.name")}</div>
            <div className="text-xs opacity-70">{t("invoice.title")}</div>
          </div>
          <div className={`grid ${thermal ? "grid-cols-1" : "grid-cols-2"} gap-2 text-sm mb-3`}>
            <div><b>{t("invoice.invoice_no")}:</b> <span className="force-ltr">{sale.invoice_no}</span></div>
            <div><b>{t("common.date")}:</b> <span className="force-ltr">{sale.sale_date}</span></div>
            <div><b>{t("invoice.customer")}:</b> {sale.customers?.name || t("invoice.walk_in")}</div>
            <div><b>{t("invoice.type")}:</b> {sale.sale_type === "wholesale" ? t("pos.wholesale") : t("pos.retail")}</div>
            {sale.customers?.phone && <div><b>{t("invoice.phone")}:</b> <span className="force-ltr">{sale.customers.phone}</span></div>}
          </div>
          <table className="w-full text-sm">
            <thead className="border-y">
              <tr><th className="text-start py-1">{t("invoice.item")}</th><th className="text-end">{t("invoice.wt")}</th><th className="text-end">{t("invoice.rate")}</th><th className="text-end">{t("invoice.faraq")}</th><th className="text-end">{t("invoice.final")}</th><th className="text-end">{t("invoice.total")}</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b">
                  <td className="py-1">{it.meat_type}</td>
                  <td className="text-end force-ltr">{fmtKg(it.weight_kg)}</td>
                  <td className="text-end force-ltr">{fmtMoney(it.rate_per_kg)}</td>
                  <td className="text-end force-ltr">{fmtMoney(it.faraq)}</td>
                  <td className="text-end force-ltr">{fmtMoney(it.final_rate)}</td>
                  <td className="text-end force-ltr font-medium">{fmtMoney(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 ms-auto max-w-xs text-sm space-y-1">
            <div className="flex justify-between"><span>{t("invoice.subtotal")}</span><span className="force-ltr">{fmtMoney(sale.subtotal)}</span></div>
            <div className="flex justify-between"><span>{t("invoice.discount")}</span><span className="force-ltr">{fmtMoney(sale.discount)}</span></div>
            <div className="flex justify-between font-bold text-base border-t pt-1"><span>{t("invoice.total")}</span><span className="force-ltr">{fmtMoney(sale.total)}</span></div>
            <div className="flex justify-between"><span>{t("invoice.paid")} ({sale.payment_method})</span><span className="force-ltr">{fmtMoney(sale.paid)}</span></div>
            <div className="flex justify-between font-semibold"><span>{t("invoice.due")}</span><span className="force-ltr">{fmtMoney(sale.due)}</span></div>
            {sale.voided_at && <div className="mt-2 rounded border border-destructive text-destructive text-center font-bold py-1">VOID{sale.void_reason ? ` — ${sale.void_reason}` : ""}</div>}
          </div>
          {sale.notes && <div className="mt-3 text-sm border-t pt-2"><b>{t("invoice.notes")}:</b> {sale.notes}</div>}
          <div className="text-center text-xs opacity-70 mt-6">{t("invoice.thanks")}</div>
        </div>
      </div>
    </div>
  );
};
export default Invoice;