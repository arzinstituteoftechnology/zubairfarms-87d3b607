import { supabase } from "@/integrations/supabase/client";
import type { SupplyProfitLine } from "@/lib/profit";

/** Money rounding to 2 dp without float artifacts (e.g. 333.3299865722656). */
export const money2 = (n: number) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
export const kg3 = (n: number) => Math.round((Number(n) || 0) * 1000 + Number.EPSILON) / 1000;

export type PosItemRow = { meat_type: string; weight_kg: number | string; final_rate: number | string; line_total: number | string; cost_per_kg: number | string | null };
export type PosSaleRow = {
  id: string; invoice_no: number; sale_date: string; total: number | string; paid: number | string; due: number | string;
  discount: number | string; subtotal: number | string; payment_method: string | null; voided_at: string | null;
  void_reason?: string | null; customer_id?: string | null; created_by?: string | null;
  pos_sale_items?: PosItemRow[];
};

/** Active (not voided) sales only. */
export const activeSales = (rows: PosSaleRow[] | null | undefined) => (rows ?? []).filter((s) => !s.voided_at);

/**
 * POS sales as profit lines in the same shape as supply lines, so the shared
 * net-profit formula treats them identically: weight × (final_rate − cost).
 * An invoice discount is a negative revenue line with no cost.
 */
export const posProfitLines = (rows: PosSaleRow[] | null | undefined): SupplyProfitLine[] => {
  const out: SupplyProfitLine[] = [];
  for (const s of activeSales(rows)) {
    for (const it of s.pos_sale_items ?? []) {
      out.push({ weight_kg: Number(it.weight_kg), rate_per_kg: Number(it.final_rate), cost_per_kg: Number(it.cost_per_kg ?? 0) });
    }
    const d = Number(s.discount) || 0;
    if (d) out.push({ weight_kg: 1, rate_per_kg: -d, cost_per_kg: 0 });
  }
  return out;
};

export const posTotals = (rows: PosSaleRow[] | null | undefined) => {
  const a = activeSales(rows);
  return {
    count: a.length,
    total: money2(a.reduce((x, s) => x + Number(s.total || 0), 0)),
    paid: money2(a.reduce((x, s) => x + Math.min(Number(s.paid || 0), Number(s.total || 0)), 0)),
    due: money2(a.reduce((x, s) => x + Number(s.due || 0), 0)),
    kg: kg3(a.reduce((x, s) => x + (s.pos_sale_items ?? []).reduce((y, i) => y + Number(i.weight_kg || 0), 0), 0)),
  };
};

export const fetchPosSales = async (from: string, to: string): Promise<PosSaleRow[]> => {
  const { data } = await (supabase as any)
    .from("pos_sales")
    .select("id, invoice_no, sale_date, total, paid, due, discount, subtotal, payment_method, voided_at, void_reason, customer_id, created_by, pos_sale_items(meat_type, weight_kg, final_rate, line_total, cost_per_kg)")
    .gte("sale_date", from).lte("sale_date", to)
    .order("sale_date", { ascending: false }).order("invoice_no", { ascending: false });
  return (data ?? []) as PosSaleRow[];
};

/** Bill maths for the POS screen. Never clamps silently: callers show warnings. */
export const computeBill = (lines: { weight: number; rate: number; faraq: number }[], discount: number, paid: number | null) => {
  const items = lines.map((l) => {
    const finalRate = money2(l.rate - l.faraq);
    return { finalRate, total: money2(finalRate * kg3(l.weight)), faraqTooHigh: l.faraq > l.rate };
  });
  const subtotal = money2(items.reduce((a, i) => a + i.total, 0));
  const total = money2(subtotal - discount);
  const paidAmt = paid == null ? Math.max(0, total) : money2(paid);
  const balance = money2(total - paidAmt); // >0 due, <0 change to return
  return {
    items, subtotal, total, paid: paidAmt,
    due: Math.max(0, balance), change: Math.max(0, -balance),
    discountTooHigh: discount > subtotal,
    anyFaraqTooHigh: items.some((i) => i.faraqTooHigh),
  };
};
