/**
 * Shared Daily Closing Variance calculation. Single source of truth used by:
 *  - StockClosing form live preview
 *  - Dashboard KPI cards
 *  - Reports Center variance report
 *  - Net Profit (finalized shortage cost)
 *
 * Formulas:
 *   expectedClosingStock = opening + purchases − supplies
 *                          + positiveAdjustments − negativeAdjustments − mortality
 *   varianceWeight       = physical − expected
 *   shortageWeight       = |min(variance, 0)|
 *   surplusWeight        = max(variance, 0)
 *   shortageCost         = shortageWeight × weightedAvgPurchaseRate
 *   surplusEstimatedVal  = surplusWeight  × weightedAvgPurchaseRate   (informational only)
 *
 * Surplus never increases profit. Only the finalized (non-reversed) shortageCost
 * feeds Net Profit (see src/lib/netProfit.ts).
 */

export type VarianceType = "balanced" | "shortage" | "surplus";

export interface ExpectedInput {
  opening: number | string | null | undefined;
  purchases: number | string | null | undefined;
  supplies: number | string | null | undefined;
  positiveAdjustments?: number | string | null | undefined;
  negativeAdjustments?: number | string | null | undefined;
  mortality?: number | string | null | undefined;
}

export interface VarianceBreakdown {
  expected: number;
  physical: number;
  varianceWeight: number;
  varianceType: VarianceType;
  shortageWeight: number;
  surplusWeight: number;
}

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
export const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeExpectedClosing(i: ExpectedInput): number {
  return round2(
    n(i.opening) + n(i.purchases) - n(i.supplies)
    + n(i.positiveAdjustments) - n(i.negativeAdjustments) - n(i.mortality),
  );
}

export function classifyVariance(physical: number | string | null | undefined, expected: number): VarianceBreakdown {
  const p = round2(n(physical));
  const e = round2(expected);
  const v = round2(p - e);
  const type: VarianceType = Math.abs(v) < 0.001 ? "balanced" : v < 0 ? "shortage" : "surplus";
  return {
    expected: e,
    physical: p,
    varianceWeight: v,
    varianceType: type,
    shortageWeight: v < 0 ? round2(Math.abs(v)) : 0,
    surplusWeight: v > 0 ? round2(v) : 0,
  };
}

export function valuedVariance(shortageKg: number, surplusKg: number, war: number | string | null | undefined) {
  const rate = n(war);
  return {
    shortageCost: round2(shortageKg * rate),
    surplusEstimatedValue: round2(surplusKg * rate),
    weightedAvgPurchaseRate: round2(rate),
  };
}

/** One-shot: expected + variance + valuation. Pass war=0 to skip valuation. */
export function reconcileClosing(input: ExpectedInput & { physical: number | string | null | undefined; war?: number | string | null }) {
  const expected = computeExpectedClosing(input);
  const variance = classifyVariance(input.physical, expected);
  const valued = valuedVariance(variance.shortageWeight, variance.surplusWeight, input.war ?? 0);
  return { ...variance, ...valued };
}