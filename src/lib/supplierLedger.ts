// Shared supplier-ledger calculation service.
// Used by: Suppliers list, Supplier Ledger dialog, Farm payable
// (via computeFarmBalances re-export), Reports, Print, Exports.
//
// Signed accounting model (positive = supplier is owed / payable):
//   opening_balance            +amount   (unless reversed → 0)
//   purchase / manual_purchase +amount
//   adjustment_increase        +amount
//   payment / manual_payment   -amount
//   adjustment_decrease        -amount
//   reversed_*                 exact opposite of the original leg
//
// Rules enforced:
//   1. Rows with reversed_at IS NOT NULL are ORIGINALS that were reversed.
//      They must NOT contribute to Active Totals; they remain in the
//      chronological table for audit (with visual "Reversed" flag).
//   2. Rows with original_entry_id IS NOT NULL are REVERSAL AUDIT ENTRIES.
//      They also must NOT contribute to Active Totals; the pair cancels.
//   3. Running balance is computed strictly chronologically
//      (entry_date asc, then created_at asc, then id asc) BEFORE any
//      newest-first display reversal.
//   4. Only the "effective" (surviving) legs move the running balance.
//      Reversed originals and reversal entries carry the balance of their
//      surrounding effective legs (so the audit column reads sensibly).

export type SupplierPurchase = {
  id: string;
  farm_id: string;
  total_amount: number | null;
  paid_amount: number | null;
  purchase_date?: string | null;
  created_at?: string | null;
  reversed_at: string | null;
};

export type SupplierPayment = {
  id: string;
  farm_id: string;
  amount: number | null;
  payment_date?: string | null;
  created_at?: string | null;
  reversed_at: string | null;
};

export type SupplierLedgerRow = {
  id: string;
  supplier_id: string;
  entry_type: string;
  entry_date?: string | null;
  amount: number | null;
  created_at?: string | null;
  reversed_at: string | null;
  original_entry_id: string | null;
};

export type SupplierFarm = {
  id: string;
  opening_balance?: number | null;
};

export interface SupplierBalance {
  id: string;
  opening: number;      // effective (0 if reversed)
  purchased: number;    // active purchases + active manual_purchase
  paid: number;         // active farm_payments + purchase.paid_amount + manual_payment
  adjustments: number;  // signed active adjustments
  balance: number;      // opening + purchased - paid + adjustments
  lastPurchaseDate: string | null;
  // Historical / audit-only totals (never mixed into balance)
  reversedGross: {
    openings: number;
    purchases: number;
    payments: number;
    adjustments: number;
  };
}

/** Round to 2 decimals using bankers-safe arithmetic (avoids FP creep). */
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeSupplierBalances(
  farms: SupplierFarm[] | null | undefined,
  purchases: SupplierPurchase[] | null | undefined,
  payments: SupplierPayment[] | null | undefined,
  ledger: SupplierLedgerRow[] | null | undefined,
  cutoffDate?: string | null,
): SupplierBalance[] {
  const pur: Record<string, number> = {};
  const paid: Record<string, number> = {};
  const adj: Record<string, number> = {};
  const lastPur: Record<string, string> = {};
  const openingReversed: Record<string, boolean> = {};
  const revGross: Record<string, SupplierBalance["reversedGross"]> = {};

  const bumpRev = (id: string) =>
    (revGross[id] ??= { openings: 0, purchases: 0, payments: 0, adjustments: 0 });

  (purchases ?? []).forEach((x) => {
    if (cutoffDate && x.purchase_date && x.purchase_date > cutoffDate) return;
    const id = x.farm_id;
    const total = Number(x.total_amount ?? 0);
    const pd = Number(x.paid_amount ?? 0);
    if (x.reversed_at) {
      bumpRev(id).purchases += total;
      bumpRev(id).payments += pd;
      return;
    }
    pur[id] = (pur[id] ?? 0) + total;
    paid[id] = (paid[id] ?? 0) + pd;
    if (x.purchase_date && (!lastPur[id] || x.purchase_date > lastPur[id])) {
      lastPur[id] = x.purchase_date;
    }
  });

  (payments ?? []).forEach((x) => {
    if (cutoffDate && x.payment_date && x.payment_date > cutoffDate) return;
    const id = x.farm_id;
    const amt = Number(x.amount ?? 0);
    if (x.reversed_at) {
      bumpRev(id).payments += amt;
      return;
    }
    paid[id] = (paid[id] ?? 0) + amt;
  });

  (ledger ?? []).forEach((x) => {
    if (cutoffDate && x.entry_date && x.entry_date > cutoffDate) return;
    const id = x.supplier_id;
    const amt = Number(x.amount ?? 0);
    const isReversal = !!x.original_entry_id || String(x.entry_type).startsWith("reversed_");

    // Track opening reversal so we can zero the seed even if the effective
    // opening still lives on farms.opening_balance.
    if (x.entry_type === "opening_balance" && x.reversed_at) {
      openingReversed[id] = true;
      bumpRev(id).openings += amt;
      return;
    }

    // Reversal audit rows never add to active totals — they only mirror the
    // canceled original for the audit trail.
    if (isReversal) {
      // Classify into "reversedGross" bucket by the mirrored type.
      const t = x.entry_type;
      if (t === "reversed_opening_balance") bumpRev(id).openings += amt;
      else if (t === "reversed_purchase" || t === "reversed_manual_purchase")
        bumpRev(id).purchases += amt;
      else if (t === "reversed_payment" || t === "reversed_manual_payment")
        bumpRev(id).payments += amt;
      else bumpRev(id).adjustments += amt;
      return;
    }

    // Originals that were later reversed → audit only.
    if (x.reversed_at) {
      if (x.entry_type === "manual_purchase") bumpRev(id).purchases += amt;
      else if (x.entry_type === "manual_payment") bumpRev(id).payments += amt;
      else bumpRev(id).adjustments += amt;
      return;
    }

    switch (x.entry_type) {
      case "opening_balance":
        // Already accounted for via farms.opening_balance seed.
        break;
      case "manual_purchase":
        pur[id] = (pur[id] ?? 0) + amt; break;
      case "manual_payment":
        paid[id] = (paid[id] ?? 0) + amt; break;
      case "adjustment_increase":
        adj[id] = (adj[id] ?? 0) + amt; break;
      case "adjustment_decrease":
        adj[id] = (adj[id] ?? 0) - amt; break;
    }
  });

  return (farms ?? []).map((f) => {
    const opening = openingReversed[f.id] ? 0 : Number(f.opening_balance ?? 0);
    const purchased = pur[f.id] ?? 0;
    const paidAmt = paid[f.id] ?? 0;
    const adjAmt = adj[f.id] ?? 0;
    const rg = revGross[f.id] ?? { openings: 0, purchases: 0, payments: 0, adjustments: 0 };
    return {
      id: f.id,
      opening: money(opening),
      purchased: money(purchased),
      paid: money(paidAmt),
      adjustments: money(adjAmt),
      balance: money(opening + purchased - paidAmt + adjAmt),
      lastPurchaseDate: lastPur[f.id] ?? null,
      reversedGross: {
        openings: money(rg.openings),
        purchases: money(rg.purchases),
        payments: money(rg.payments),
        adjustments: money(rg.adjustments),
      },
    };
  });
}

// ------------------------------------------------------------------
// Ledger row expansion for the transaction table.
// ------------------------------------------------------------------

export type LedgerRowKind =
  | "opening" | "purchase" | "payment"
  | "manual_purchase" | "manual_payment"
  | "adjustment_increase" | "adjustment_decrease"
  | "reversed_opening_balance"
  | "reversed_purchase" | "reversed_payment"
  | "reversed_manual_purchase" | "reversed_manual_payment"
  | "reversed_adjustment_increase" | "reversed_adjustment_decrease";

export interface LedgerRow {
  key: string;
  source: "purchase" | "payment" | "ledger";
  kind: LedgerRowKind;
  date: string;                 // entry/tx date (YYYY-MM-DD)
  createdAt: string;            // ISO for stable ordering
  debit: number;
  credit: number;
  reversed: boolean;            // original that was later reversed
  isReversal: boolean;          // reversal audit entry
  effectiveDelta: number;       // signed contribution to running balance (0 if reversed/isReversal)
  running: number;              // filled in after chronological pass
  rawId?: string;
  ledgerId?: string;
  ledgerType?: string;
  meta?: any;
}

/**
 * Expand raw purchase / payment / ledger rows into a chronological ledger
 * with running balances. Result is oldest→newest. Callers must reverse
 * the array themselves for "newest first" display.
 *
 * openingSeed is the surviving farms.opening_balance (0 if the opening
 * ledger entry has been reversed).
 */
export function buildSupplierLedgerRows(
  openingSeed: number,
  purchases: SupplierPurchase[],
  payments: SupplierPayment[],
  ledger: SupplierLedgerRow[],
): LedgerRow[] {
  const rows: LedgerRow[] = [];

  const push = (r: Omit<LedgerRow, "running" | "effectiveDelta"> & { effectiveDelta?: number }) => {
    rows.push({ ...r, running: 0, effectiveDelta: r.effectiveDelta ?? 0 });
  };

  for (const x of purchases ?? []) {
    const total = Number(x.total_amount ?? 0);
    const paid = Number(x.paid_amount ?? 0);
    const reversed = !!x.reversed_at;
    // A purchase row is both a debit (total) and a credit (paid). If reversed,
    // it contributes zero to the running balance; the surrounding reversal
    // ledger entries also contribute zero (they mirror the same numbers).
    push({
      key: `pu-${x.id}`,
      source: "purchase",
      kind: "purchase",
      date: x.purchase_date ?? "",
      createdAt: x.created_at ?? x.purchase_date ?? "",
      debit: total, credit: paid,
      reversed, isReversal: false,
      effectiveDelta: reversed ? 0 : total - paid,
      rawId: x.id, meta: x,
    });
  }

  for (const x of payments ?? []) {
    const amt = Number(x.amount ?? 0);
    const reversed = !!x.reversed_at;
    push({
      key: `pa-${x.id}`,
      source: "payment",
      kind: "payment",
      date: x.payment_date ?? "",
      createdAt: x.created_at ?? x.payment_date ?? "",
      debit: 0, credit: amt,
      reversed, isReversal: false,
      effectiveDelta: reversed ? 0 : -amt,
      rawId: x.id, meta: x,
    });
  }

  const debitTypes = new Set([
    "opening_balance", "manual_purchase", "adjustment_increase",
    "reversed_payment", "reversed_manual_payment", "reversed_adjustment_decrease",
  ]);

  for (const x of ledger ?? []) {
    const amt = Number(x.amount ?? 0);
    const isDebit = debitTypes.has(x.entry_type);
    const isReversal = !!x.original_entry_id || String(x.entry_type).startsWith("reversed_");
    const reversed = !!x.reversed_at;
    let delta = 0;
    if (!isReversal && !reversed) {
      switch (x.entry_type) {
        case "opening_balance": delta = 0; break; // seeded separately
        case "manual_purchase": delta = +amt; break;
        case "manual_payment": delta = -amt; break;
        case "adjustment_increase": delta = +amt; break;
        case "adjustment_decrease": delta = -amt; break;
      }
    }
    push({
      key: `le-${x.id}`,
      source: "ledger",
      kind: (x.entry_type === "opening_balance" ? "opening" : x.entry_type) as LedgerRowKind,
      date: x.entry_date ?? "",
      createdAt: x.created_at ?? x.entry_date ?? "",
      debit: isDebit ? amt : 0, credit: isDebit ? 0 : amt,
      reversed, isReversal,
      effectiveDelta: delta,
      ledgerId: x.id, ledgerType: x.entry_type, meta: x,
    });
  }

  // Chronological sort: date asc, created_at asc, key asc as tie-breaker.
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  // Running balance: seed with surviving opening, apply effectiveDelta only.
  let running = openingSeed;
  for (const r of rows) {
    running += r.effectiveDelta;
    r.running = money(running);
  }
  return rows;
}

export const _test = { money };
