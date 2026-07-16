// Total outstanding receivable across all shops, as-of an optional cutoff date.
//
// Mirrors the balance math used on the Shop Ledger page so the Dashboard KPI
// (Receivable from Shops) reconciles exactly to the sum of every shop's
// closing balance in Shop Ledger.
//
// Formula, per shop:
//   opening + supplied + adjustments − paid
//   where reversed rows and reversal audit rows are ignored on both sides.
// Final = clamp(Σ per-shop, min 0) — shops with credit balances contribute 0.

type Shop = { id: string; opening_balance?: number | null };
type Supply = { shop_id: string; total_amount: number | null; reversed_at: string | null; supply_date?: string | null };
type Ledger = {
  id: string;
  shop_id: string;
  entry_type: string;
  amount: number | null;
  entry_date?: string | null;
  reversed_at: string | null;
  reversal_entry_id: string | null;
  original_entry_id: string | null;
};
type Recovery = { ledger_entry_id: string | null; reversed_at: string | null };

export interface ShopBalance {
  id: string;
  opening: number;
  supplied: number;
  paid: number;
  adj: number;
  balance: number; // may be negative (credit)
}

export function computeShopBalances(
  shops: Shop[] | null | undefined,
  supplies: Supply[] | null | undefined,
  ledger: Ledger[] | null | undefined,
  reversedRecoveries: Recovery[] | null | undefined,
  cutoffDate?: string | null,
): ShopBalance[] {
  const supMap: Record<string, number> = {};
  const payMap: Record<string, number> = {};
  const adjMap: Record<string, number> = {};
  const openingOverride: Record<string, number> = {};
  const openingReversed: Record<string, boolean> = {};
  const reversedRecoveryLedgerIds = new Set(
    (reversedRecoveries ?? []).map((x) => x.ledger_entry_id).filter(Boolean) as string[],
  );

  (supplies ?? []).forEach((x) => {
    if (x.reversed_at) return;
    if (cutoffDate && x.supply_date && x.supply_date > cutoffDate) return;
    supMap[x.shop_id] = (supMap[x.shop_id] ?? 0) + Number(x.total_amount ?? 0);
  });
  (ledger ?? []).forEach((x) => {
    if (cutoffDate && x.entry_date && x.entry_date > cutoffDate) return;
    if (x.entry_type === "opening_balance" && x.reversed_at) openingReversed[x.shop_id] = true;
    if (x.reversed_at || x.reversal_entry_id || x.original_entry_id) return;
    if (x.entry_type === "recovery" && reversedRecoveryLedgerIds.has(x.id)) return;
    if (String(x.entry_type).startsWith("reversed_")) return;
    const amt = Number(x.amount ?? 0);
    const sid = x.shop_id;
    switch (x.entry_type) {
      case "opening_balance": openingOverride[sid] = amt; break;
      case "manual_supply":   supMap[sid] = (supMap[sid] ?? 0) + amt; break;
      case "adjustment_increase": adjMap[sid] = (adjMap[sid] ?? 0) + amt; break;
      case "adjustment_decrease": adjMap[sid] = (adjMap[sid] ?? 0) - amt; break;
      case "manual_payment":
      case "recovery":        payMap[sid] = (payMap[sid] ?? 0) + amt; break;
    }
  });

  return (shops ?? []).map((s) => {
    const opening = openingOverride[s.id] !== undefined
      ? openingOverride[s.id]
      : (openingReversed[s.id] ? 0 : Number(s.opening_balance ?? 0));
    const supplied = supMap[s.id] ?? 0;
    const paid = payMap[s.id] ?? 0;
    const adj = adjMap[s.id] ?? 0;
    return { id: s.id, opening, supplied, paid, adj, balance: opening + supplied - paid + adj };
  });
}

export function totalReceivableFromShops(balances: ShopBalance[]): number {
  const total = balances.reduce((a, b) => a + b.balance, 0);
  return total > 0 ? total : 0;
}