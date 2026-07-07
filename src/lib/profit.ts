/**
 * Realized Profit for a selected date =
 *   Total Supply Revenue (that date) − Cost of Goods Sold (that date's purchases)
 *
 * Excludes opening stock, remaining inventory value, inventory adjustments,
 * and any transactions outside the selected date. Inventory valuation is
 * reported separately, never inside profit.
 */
export const calcRealizedProfit = (
  supplyRevenue: number | string | null | undefined,
  purchaseCost: number | string | null | undefined,
): number => Number(supplyRevenue ?? 0) - Number(purchaseCost ?? 0);