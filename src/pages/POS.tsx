import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { MEAT_TYPES, fmtMoney } from "@/lib/constants";
import { useLedgerDate } from "@/hooks/useLedgerDate";

type Item = { meat_type: string; weight_kg: string; rate_per_kg: string; faraq: string };
const newItem = (): Item => ({ meat_type: "Chicken", weight_kg: "", rate_per_kg: "", faraq: "0" });
const calc = (it: Item) => {
  const w = Number(it.weight_kg) || 0, r = Number(it.rate_per_kg) || 0, f = Number(it.faraq) || 0;
  const finalRate = Math.max(0, r - f);
  return { finalRate, total: finalRate * w };
};

const POS = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
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

  useEffect(() => { supabase.from("customers").select("id, name").order("name").then(({ data }) => setCustomers(data ?? [])); }, []);

  const update = (i: number, k: keyof Item, v: string) => setItems((arr) => arr.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const subtotal = items.reduce((s, it) => s + calc(it).total, 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const paidNum = Number(paid) || 0;
  const due = Math.max(0, total - paidNum);

  const save = async () => {
    const valid = items.filter((it) => Number(it.weight_kg) > 0 && Number(it.rate_per_kg) > 0);
    if (valid.length === 0) return toast.error(t("pos.need_item"));
    setSaving(true);
    const { data: sale, error } = await supabase.from("pos_sales").insert({
      customer_id: customerId || null, sale_date: saleDate, sale_type: saleType,
      subtotal, discount: Number(discount) || 0, total, paid: paidNum, due,
      payment_method: method, notes: notes || null, created_by: user?.id,
    }).select().single();
    if (error || !sale) { setSaving(false); return toast.error(error?.message || t("pos.failed")); }
    const itemsPayload = valid.map((it) => {
      const c = calc(it);
      return { sale_id: sale.id, meat_type: it.meat_type, weight_kg: Number(it.weight_kg), rate_per_kg: Number(it.rate_per_kg), faraq: Number(it.faraq) || 0, final_rate: c.finalRate, line_total: c.total };
    });
    const { error: ie } = await supabase.from("pos_sale_items").insert(itemsPayload);
    setSaving(false);
    if (ie) return toast.error(ie.message);
    toast.success(t("pos.invoice_saved", { no: sale.invoice_no }));
    navigate(`/invoice/${sale.id}`);
  };

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
            <div><Label>{t("pos.customer_optional")}</Label>
              <Select value={customerId || "__walk"} onValueChange={(v) => setCustomerId(v === "__walk" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__walk">{t("pos.walk_in")}</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
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
                            <SelectContent>{MEAT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="p-1"><Input className="h-9 text-end" type="number" step="0.001" value={it.weight_kg} onChange={(e) => update(i, "weight_kg", e.target.value)} /></td>
                        <td className="p-1"><Input className="h-9 text-end" type="number" step="0.01" value={it.rate_per_kg} onChange={(e) => update(i, "rate_per_kg", e.target.value)} /></td>
                        <td className="p-1"><Input className="h-9 text-end" type="number" step="0.01" value={it.faraq} onChange={(e) => update(i, "faraq", e.target.value)} /></td>
                        <td className="p-2 text-end font-medium">{fmtMoney(c.finalRate)}</td>
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
          <div className="flex justify-between text-xl font-bold border-t pt-2"><span>{t("pos.total")}</span><span>{fmtMoney(total)}</span></div>
          <div className="flex items-center gap-2"><Label className="text-sm shrink-0">{t("pos.paid")}</Label><Input type="number" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} className="h-9 text-end" placeholder={String(total.toFixed(2))} /></div>
          <div className="flex items-center gap-2"><Label className="text-sm shrink-0">{t("pos.method")}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="cash">{t("pos.cash")}</SelectItem><SelectItem value="card">{t("pos.card")}</SelectItem><SelectItem value="bank">{t("pos.bank")}</SelectItem><SelectItem value="credit">{t("pos.credit")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className={`flex justify-between text-sm ${due > 0 ? "text-destructive" : "text-success"}`}><span>{t("pos.due")}</span><span className="font-semibold">{fmtMoney(due)}</span></div>
          <Button className="w-full" size="lg" onClick={save} disabled={saving}>{saving ? t("pos.saving") : t("pos.save_print")}</Button>
        </Card>
      </div>
    </div>
  );
};
export default POS;