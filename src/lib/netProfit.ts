/**
 * Shared Net Profit calculation for the selected Dashboard date.
 *
 *   Gross Profit    = Σ per-supply-line (weight × (sale_rate − cost_per_kg))
 *                     — see `calcRealizedProfit` in ./profit.ts
 *   General Expense = Σ expenses.amount for the date (active/non-reversed)
 *   Delivery Expense= Σ (fuel_expense + labour_expense + other_expense)
 *                     from deliveries whose loading_date matches the date
 *   Shortage Cost   = Σ finalized-unreversed stock_closings.shortage_cost for the date
 *   Net Profit      = Gross − General − Delivery − Shortage Cost
 *
 * The helper is pure — callers pass in already-filtered rows so the same
 * math works in the UI, in tests, and in reports/exports. This is the
 * single source of truth for Net Profit; do NOT duplicate the formula
 * anywhere else.
 *
 * NOTE: only finalized (non-reversed) closings contribute shortageCost.
 * Draft closings must pass `finalizedShortageCost = 0` — they display as
 * "Provisional" in the UI but do not lock profit. Surplus never inflates
 * profit. Mortality and negative adjustments are already reflected in the
 * expected-stock formula so they do not double-count here.
 */
import { calcRealizedProfit, type SupplyProfitLine } from "./profit";

export interface ExpenseRow { amount: number | string | null | undefined }
export interface DeliveryExpenseRow {
  fuel_expense?: number | string | null;
  labour_expense?: number | string | null;
  other_expense?: number | string | null;
}

export interface NetProfitBreakdown {
  grossProfit: number;
  generalExpense: number;
  deliveryExpense: number;
  finalizedShortageCost: number;
  netProfit: number;
}

const n = (v: unknown) => Number(v ?? 0);

export function sumGeneralExpense(rows: ExpenseRow[] | null | undefined): number {
  return (rows ?? []).reduce((a, r) => a + n(r.amount), 0);
}

export function sumDeliveryExpense(rows: DeliveryExpenseRow[] | null | undefined): number {
  return (rows ?? []).reduce(
    (a, r) => a + n(r.fuel_expense) + n(r.labour_expense) + n(r.other_expense),
    0,
  );
}

export function computeNetProfit(input: {
  supplies: SupplyProfitLine[] | null | undefined;
  expenses: ExpenseRow[] | null | undefined;
  deliveries: DeliveryExpenseRow[] | null | undefined;
  finalizedShortageCost?: number | string | null | undefined;
}): NetProfitBreakdown {
  const grossProfit = calcRealizedProfit(input.supplies ?? []);
  const generalExpense = sumGeneralExpense(input.expenses ?? []);
  const deliveryExpense = sumDeliveryExpense(input.deliveries ?? []);
  const finalizedShortageCost = Math.max(0, n(input.finalizedShortageCost));
  return {
    grossProfit,
    generalExpense,
    deliveryExpense,
    finalizedShortageCost,
    netProfit: grossProfit - generalExpense - deliveryExpense - finalizedShortageCost,
  };
}