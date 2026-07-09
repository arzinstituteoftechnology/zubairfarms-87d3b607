/**
 * Realized Profit for a selected date is calculated PER SUPPLY LINE:
 *   profit = Σ supplied_weight_kg × (sale_rate_per_kg − cost_per_kg_for_profit)
 *
 * We only realize profit on meat that was actually supplied — remaining
 * inventory is NOT a loss, and full purchase value must NOT be subtracted
 * from supply revenue. This matches the profit shown in each supply row.
 *
 * Excludes opening stock, remaining inventory value, inventory adjustments,
 * and any transactions outside the selected date.
 */
export type SupplyProfitLine = {
  weight_kg: number | string | null | undefined;
  rate_per_kg: number | string | null | undefined;
  cost_per_kg: number | string | null | undefined;
};

const num = (v: unknown) => Number(v ?? 0);

export const calcSupplyLineProfit = (line: SupplyProfitLine): number =>
  num(line.weight_kg) * (num(line.rate_per_kg) - num(line.cost_per_kg));

export const calcRealizedProfit = (
  supplies: SupplyProfitLine[] | null | undefined,
): number => (supplies ?? []).reduce((sum, line) => sum + calcSupplyLineProfit(line), 0);