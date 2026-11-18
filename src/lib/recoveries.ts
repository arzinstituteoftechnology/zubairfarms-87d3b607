import { supabase } from "@/integrations/supabase/client";

/**
 * Single source of truth for money collected from shops:
 *  - Daily Recovery entries (shop_recoveries, not reversed)
 *  - Payments typed directly into the Shop Ledger (entry_type manual_payment,
 *    not reversed, not themselves a reversal row)
 * Recoveries already create their own "recovery" ledger rows, which are NOT
 * counted again here, so nothing is double-counted.
 */
export type CollectionRow = {
  id: string; source: "recovery" | "ledger_payment"; date: string; shop_id: string;
  amount: number; method: string; notes: string | null; collected_by: string | null;
  created_by: string | null; reversed_at: string | null; created_at?: string;
};

export const mergeCollections = (recoveries: any[], ledgerPayments: any[]): CollectionRow[] => {
  const a: CollectionRow[] = (recoveries ?? []).map((r) => ({
    id: r.id, source: "recovery", date: r.recovery_date, shop_id: r.shop_id, amount: Number(r.amount || 0),
    method: r.payment_method ?? "", notes: r.notes ?? null, collected_by: r.collected_by ?? null,
    created_by: r.created_by ?? null, reversed_at: r.reversed_at ?? null, created_at: r.created_at,
  }));
  const b: CollectionRow[] = (ledgerPayments ?? [])
    .filter((e) => e.entry_type === "manual_payment" && !e.original_entry_id)
    .map((e) => ({
      id: e.id, source: "ledger_payment", date: e.entry_date, shop_id: e.shop_id, amount: Number(e.amount || 0),
      method: "Shop Ledger", notes: e.description ?? null, collected_by: null,
      created_by: e.created_by ?? null, reversed_at: e.reversed_at ?? null, created_at: e.created_at,
    }));
  return [...a, ...b].sort((x, y) => (y.date.localeCompare(x.date)) || String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")));
};

export const sumActive = (rows: CollectionRow[], pred: (r: CollectionRow) => boolean = () => true) =>
  Math.round(rows.filter((r) => !r.reversed_at && pred(r)).reduce((s, r) => s + r.amount, 0) * 100) / 100;

export const fetchCollections = async (opts: { from?: string; to?: string; shopId?: string } = {}) => {
  let rq = supabase.from("shop_recoveries").select("*");
  let lq = (supabase as any).from("shop_ledger_entries")
    .select("id, shop_id, entry_date, entry_type, amount, description, created_by, created_at, reversed_at, original_entry_id")
    .eq("entry_type", "manual_payment");
  if (opts.from) { rq = rq.gte("recovery_date", opts.from); lq = lq.gte("entry_date", opts.from); }
  if (opts.to) { rq = rq.lte("recovery_date", opts.to); lq = lq.lte("entry_date", opts.to); }
  if (opts.shopId) { rq = rq.eq("shop_id", opts.shopId); lq = lq.eq("shop_id", opts.shopId); }
  const [{ data: r }, { data: l }] = await Promise.all([rq, lq]);
  return mergeCollections(r ?? [], l ?? []);
};
