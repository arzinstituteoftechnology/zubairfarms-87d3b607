import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { computeBill, money2, kg3 } from "@/lib/posSales";
import { RecentInvoices } from "@/components/pos/RecentInvoices";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { useModuleFlags } from "@/hooks/useModuleFlags";
import { useSettingsLists, activeOnly } from "@/hooks/useSettingsLists";

type Item = { meat_type: string; weight_kg: string; rate_per_kg: string; faraq: string };
const newItem = (): Item => ({ meat_type: "Chicken", weight_kg: "", rate_per_kg: "", faraq: "0" });
const calc = (it: Item) => {
  const w = Number(it.weight_kg) || 0, r = Number(it.rate_per_kg) || 0, f = Number(it.faraq) || 0;
  const finalRate = money2(r - f);
  return { finalRate, total: money2(finalRate * kg3(w)), faraqTooHigh: f > r };
};

const POS = () => {
  const { user, tenant } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { customers_module_enabled: customersEnabled } = useModuleFlags();
  const { meatTypes, paymentMethods } = useSettingsLists();
  const activeMeats = activeOnly(meatTypes);
  const activePMs = activeOnly(paymentMethods);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [customerId, setCustomerId] = useState<string>("");
  const [saleType, setSaleType] = useState("retail");
  const { selectedDate: saleDate, setSelectedDate: setSaleDate } = useLedgerDate();
  const [discount, setDiscount] = useState("0");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useSearchParams();
  const editId = params.get("edit");
  const [editingNo, setEditingNo] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(!!editId);

  // Edit = load an invoice into the form; saving issues a new invoice and voids the old one.
  useEffect(() => {
    if (!editId) { setEditingNo(null); setEditLoading(false); return; }
    setEditLoading(true);
    (async () => {
      const [{ data: sale }, { data: its }] = await Promise.all([
        (supabase as any).from("pos_sales").select("*").eq("id", editId).maybeSingle(),
        supabase.from("pos_sale_items").select("*").eq("sale_id", editId),
      ]);
      if (!sale || sale.voided_at) { setEditLoading(false); toast.error("Invoice not found or already void"); setParams({}); return; }
      setEditingNo(sale.invoice_no);
      setCustomerId(sale.customer_id ?? ""); setSaleType(sale.sale_type ?? "retail"); setSaleDate(sale.sale_date);
      setDiscount(String(sale.discount ?? 0)); setPaid(String(sale.paid ?? "")); setMethod(sale.payment_method ?? "cash");
      // Drop figures written by the system on the old invoice; new ones are written on save.
      setNotes(String(sale.notes ?? "").replace(/^Change returned: [\d.,-]+\.\s*/, "").replace(/^Edited from invoice #\d+[^.]*\.\s*/, ""));
      setItems((its ?? []).map((i: any) => ({ meat_type: i.meat_type, weight_kg: String(i.weight_kg), rate_per_kg: String(i.rate_per_kg), faraq: String(i.faraq ?? 0) })));
      setEditLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  useEffect(() => {
    if (!customersEnabled) { setCustomers([]); setCustomerId(""); return; }
    supabase.from("customers").select("id, name").order("name").then(({ data }) => setCustomers(data ?? []));
  }, [customersEnabled]);

  const update = (i: number, k: keyof Item, v: string) => setItems((arr) => arr.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  // Due/change are derived on every render from total and paid, so they
  // always follow the auto-filled (blank = full payment) or typed Paid value.
  const bill = computeBill(
    items.map((it) => ({ weight: Number(it.weight_kg) || 0, rate: Number(it.rate_per_kg) || 0, faraq: Number(it.faraq) || 0 })),
    Number(discount) || 0,
    paid === "" ? null : Number(paid),
  );
  const { subtotal, total, due, change } = bill;
  const paidNum = bill.paid;

  const save = async () => {
    const valid = items.filter((it) => Number(it.weight_kg) > 0 && Number(it.rate_per_kg) > 0);
    if (valid.length === 0) return toast.error(t("pos.need_item"));
    if (bill.discountTooHigh) return toast.error("Discount is larger than the subtotal. Reduce the discount.");
    if (bill.anyFaraqTooHigh) return toast.error("Faraq is larger than the rate on a line. Final rate cannot be negative.");
    if (bill.negativeTotal) return toast.error("Total cannot be negative. Reduce the discount or Faraq.");
    if (!tenant?.id) return toast.error("Account is not linked to an active client. Please sign in again after the super admin creates your client account.");
    setSaving(true);
    const { data: sale, error } = await supabase.from("pos_sales").insert({
      customer_id: customerId || null, sale_date: saleDate, sale_type: saleType,
      subtotal, discount: money2(Number(discount) || 0), total, paid: money2(Math.min(paidNum, total)), due,
      payment_method: method, notes: (editingNo ? `Edited from invoice #${editingNo} — Paid ${money2(Math.min(paidNum, total)).toFixed(2)}, Due ${due.toFixed(2)}. ` : "") + (change > 0 ? `Change returned: ${change.toFixed(2)}. ` : "") + (notes || "") || null, tenant_id: tenant.id, created_by: user?.id,
    }).select().single();
    if (error || !sale) { setSaving(false); return toast.error(error?.message || t("pos.failed")); }
    const itemsPayload = valid.map((it) => {
      const c = calc(it);
      return { sale_id: sale.id, meat_type: it.meat_type, weight_kg: kg3(Number(it.weight_kg)), rate_per_kg: money2(Number(it.rate_per_kg)), faraq: money2(Number(it.faraq) || 0), final_rate: c.finalRate, line_total: c.total, tenant_id: tenant.id };
    });
    const { error: ie } = await supabase.from("pos_sale_items").insert(itemsPayload);
    setSaving(false);
    if (ie) return toast.error(ie.message);
    if (editId) {
      const { error: ve } = await (supabase as any).rpc("void_pos_sale", { p_id: editId, p_reason: `Edited — replaced by invoice #${sale.invoice_no}` });
      if (ve) toast.error("New invoice saved but the old one could not be voided: " + ve.message);
    }
    toast.success(t("pos.invoice_saved", { no: sale.invoice_no }));
    navigate(`/invoice/${sale.id}`);
  };

  if (editLoading) {
    return <div className="py-20 text-center text-muted-foreground">Loading invoice…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Receipt className="h-6 w-6 text-primary" /> {t("pos.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pos.subtitle")}</p>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div><Label>{t("pos.date")}</Label><Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></div>
            {customersEnabled && (
            <div><Label>{t("pos.customer_optional")}</Label>
              <Select value={customerId || "__walk"} onValueChange={(v) => setCustomerId(v === "__walk" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__walk">{t("pos.walk_in")}</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            )}
            <div><Label>{t("pos.type")}</Label>
              <Select value={saleType} onValueChange={setSaleType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="retail">{t("pos.retail")}</SelectItem><SelectItem value="wholesale">{t("pos.wholesale")}</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("pos.items")}</Label>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr><th className="text-start p-2">{t("pos.meat")}</th><th className="text-end p-2">{t("pos.weight_kg")}</th><th className="text-end p-2">{t("pos.rate")}</th><th className="text-end p-2">{t("pos.faraq")}</th><th className="text-end p-2">{t("pos.final_rate")}</th><th className="text-end p-2">{t("pos.total")}</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const c = calc(it);
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-1">
                          <Select value={it.meat_type} onValueChange={(v) => update(i, "meat_type", v)}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>{activeMeats.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="p-1"><Input className="h-9 text-end" type="number" step="0.001" value={it.weight_kg} onChange={(e) => update(i, "weight_kg", e.target.value)} /></td>
                        <td className="p-1"><Input className="h-9 text-end" type="number" step="0.01" value={it.rate_per_kg} onChange={(e) => update(i, "rate_per_kg", e.target.value)} /></td>
                        <td className="p-1"><Input className="h-9 text-end" type="number" step="0.01" value={it.faraq} onChange={(e) => update(i, "faraq", e.target.value)} /></td>
                        <td className={`p-2 text-end font-medium ${c.faraqTooHigh ? "text-destructive" : ""}`} title={c.faraqTooHigh ? "Faraq is larger than the rate" : undefined}>{fmtMoney(c.finalRate)}{c.faraqTooHigh && <AlertTriangle className="inline h-3.5 w-3.5 ms-1" />}</td>
                        <td className="p-2 text-end font-semibold">{fmtMoney(c.total)}</td>
                        <td className="p-1"><Button size="icon" variant="ghost" onClick={() => setItems((a) => a.length > 1 ? a.filter((_, x) => x !== i) : a)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button variant="outline" size="sm" onClick={() => setItems((a) => [...a, newItem()])}><Plus className="h-4 w-4" /> {t("pos.add_item")}</Button>
          </div>
          <div><Label>{t("pos.notes")}</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </Card>

        <Card className="p-4 space-y-3 h-fit lg:sticky lg:top-4">
          <div className="text-lg font-semibold">{t("pos.bill")}</div>
          <div className="flex justify-between text-sm"><span>{t("pos.subtotal")}</span><span className="font-medium">{fmtMoney(subtotal)}</span></div>
          <div className="flex items-center gap-2"><Label className="text-sm shrink-0">{t("pos.discount")}</Label><Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-9 text-end" /></div>
          {bill.discountTooHigh && <div className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Discount is larger than the subtotal.</div>}
          {bill.anyFaraqTooHigh && <div className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Faraq is larger than the rate on a line.</div>}
          <div className={`flex justify-between text-xl font-bold border-t pt-2 ${total < 0 ? "text-destructive" : ""}`}><span>{t("pos.total")}</span><span>{fmtMoney(total)}</span></div>
          <div className="flex items-center gap-2"><Label className="text-sm shrink-0">{t("pos.paid")}</Label><Input type="number" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} className="h-9 text-end" placeholder={String(total.toFixed(2))} /></div>
          <div className="flex items-center gap-2"><Label className="text-sm shrink-0">{t("pos.method")}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{activePMs.map(m => <SelectItem key={m.id} value={m.code}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className={`flex justify-between text-sm ${due > 0 ? "text-destructive" : "text-success"}`}><span>{t("pos.due")}</span><span className="font-semibold">{fmtMoney(due)}</span></div>
          {change > 0 && (
            <div className="flex justify-between text-sm rounded-md border border-warning/40 bg-warning/10 px-2 py-1">
              <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Overpaid — change to return</span>
              <span className="font-semibold">{fmtMoney(change)}</span>
            </div>
          )}
          {bill.negativeTotal && (
            <div className="text-xs rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-2 py-1 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Total is negative — this bill cannot be saved. Due and change are not calculated until the total is 0 or more.
            </div>
          )}
          {editingNo != null && <div className="text-xs text-muted-foreground">Editing invoice #{editingNo}. Saving creates a new invoice and voids #{editingNo}.</div>}
          <Button className="w-full" size="lg" onClick={save} disabled={saving || bill.negativeTotal}>{saving ? t("pos.saving") : t("pos.save_print")}</Button>
        </Card>
      </div>
      <RecentInvoices date={saleDate} />
    </div>
  );
};
export default POS;