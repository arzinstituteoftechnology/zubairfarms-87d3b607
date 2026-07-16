// Per-farm outstanding payable balance, as-of an optional cutoff date.
// Mirrors Dashboard's payable-to-farms formula so per-farm totals reconcile
// exactly to the aggregate KPI.

type Farm = { id: string; opening_balance?: number | null };
type Purchase = {
  farm_id: string;
  total_amount: number | null;
  paid_amount: number | null;
  purchase_date?: string | null;
  reversed_at: string | null;
};
type FarmPayment = {
  farm_id: string;
  amount: number | null;
  payment_date?: string | null;
  reversed_at: string | null;
};
type SupplierLedger = {
  farm_id: string;
  entry_type: string;
  amount: number | null;
  entry_date?: string | null;
  reversed_at: string | null;
  original_entry_id: string | null;
};

export interface FarmBalance {
  id: string;
  opening: number;
  purchased: number;
  paid: number;
  adj: number;
  balance: number;
  lastPurchaseDate: string | null;
}

export function computeFarmBalances(
  farms: Farm[] | null | undefined,
  purchases: Purchase[] | null | undefined,
  payments: FarmPayment[] | null | undefined,
  ledger: SupplierLedger[] | null | undefined,
  cutoffDate?: string | null,
): FarmBalance[] {
  const purMap: Record<string, number> = {};
  const paidMap: Record<string, number> = {};
  const adjMap: Record<string, number> = {};
  const lastPur: Record<string, string> = {};

  (purchases ?? []).forEach((x) => {
    if (x.reversed_at) return;
    if (cutoffDate && x.purchase_date && x.purchase_date > cutoffDate) return;
    const id = x.farm_id;
    purMap[id] = (purMap[id] ?? 0) + Number(x.total_amount ?? 0);
    paidMap[id] = (paidMap[id] ?? 0) + Number(x.paid_amount ?? 0);
    if (x.purchase_date && (!lastPur[id] || x.purchase_date > lastPur[id])) {
      lastPur[id] = x.purchase_date;
    }
  });
  (payments ?? []).forEach((x) => {
    if (x.reversed_at) return;
    if (cutoffDate && x.payment_date && x.payment_date > cutoffDate) return;
    paidMap[x.farm_id] = (paidMap[x.farm_id] ?? 0) + Number(x.amount ?? 0);
  });
  (ledger ?? []).forEach((x) => {
    if (cutoffDate && x.entry_date && x.entry_date > cutoffDate) return;
    if (x.reversed_at || x.original_entry_id) return;
    const amt = Number(x.amount ?? 0);
    switch (x.entry_type) {
      case "manual_purchase":
      case "adjustment_increase":
        adjMap[x.farm_id] = (adjMap[x.farm_id] ?? 0) + amt; break;
      case "manual_payment":
      case "adjustment_decrease":
        adjMap[x.farm_id] = (adjMap[x.farm_id] ?? 0) - amt; break;
    }
  });

  return (farms ?? []).map((f) => {
    const opening = Number(f.opening_balance ?? 0);
    const purchased = purMap[f.id] ?? 0;
    const paid = paidMap[f.id] ?? 0;
    const adj = adjMap[f.id] ?? 0;
    return {
      id: f.id,
      opening,
      purchased,
      paid,
      adj,
      balance: opening + purchased - paid + adj,
      lastPurchaseDate: lastPur[f.id] ?? null,
    };
  });
}

export function totalPayableToFarms(balances: FarmBalance[]): number {
  const total = balances.reduce((a, b) => a + b.balance, 0);
  return total > 0 ? total : 0;
}