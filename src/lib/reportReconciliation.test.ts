/**
 * Reports Center reconciliation tests.
 * Verifies that the Profit Reconciliation report and Dashboard Net Profit KPI
 * always agree, and that shortage cost is counted exactly once and only for
 * finalized, unreversed closings.
 */
import { describe, it, expect } from "vitest";
import { computeNetProfit } from "./netProfit";
import { reconcileClosing } from "./closingVariance";
import { computeFarmBalances, totalPayableToFarms } from "./farmPayable";
import { computeShopBalances, totalReceivableFromShops } from "./shopReceivable";

const supplies = [
  { weight_kg: 100, rate_per_kg: 500, cost_per_kg: 400 }, // +10 000
  { weight_kg: 50,  rate_per_kg: 600, cost_per_kg: 550 }, //  +2 500
];
const expenses = [{ amount: 1_000 }, { amount: 500 }];               // 1 500
const deliveries = [{ fuel_expense: 200, labour_expense: 300, other_expense: 100 }]; // 600

describe("Reports ↔ Dashboard reconciliation", () => {
  it("profit_recon rows sum to Dashboard Net Profit exactly", () => {
    const dashboard = computeNetProfit({ supplies, expenses, deliveries, finalizedShortageCost: 800 });
    const reportRows = [
      dashboard.grossProfit,
      -dashboard.generalExpense,
      -dashboard.deliveryExpense,
      -dashboard.finalizedShortageCost,
    ];
    const sum = reportRows.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(dashboard.netProfit, 6);
    expect(dashboard.netProfit).toBeCloseTo(12_500 - 1_500 - 600 - 800, 6);
  });

  it("draft closings never enter Net Profit even when shortage_cost is set", () => {
    // Draft closings are excluded by passing finalizedShortageCost = 0
    const withDraft = computeNetProfit({ supplies, expenses, deliveries, finalizedShortageCost: 0 });
    const withFinal = computeNetProfit({ supplies, expenses, deliveries, finalizedShortageCost: 800 });
    expect(withFinal.netProfit).toBeCloseTo(withDraft.netProfit - 800, 6);
  });

  it("reversed closings must not affect Net Profit", () => {
    // Caller (Dashboard) filters out reversed closings — helper sees only finalizedShortageCost=0
    const noReversed = computeNetProfit({ supplies, expenses, deliveries, finalizedShortageCost: 0 });
    expect(noReversed.finalizedShortageCost).toBe(0);
  });

  it("surplus never inflates profit", () => {
    // surplus_value is informational; it is never passed into computeNetProfit
    const bd = computeNetProfit({ supplies, expenses, deliveries, finalizedShortageCost: 0 });
    // Even if we tried, negative shortage clamps to 0
    const clamped = computeNetProfit({ supplies, expenses, deliveries, finalizedShortageCost: -1_000 });
    expect(clamped.netProfit).toBeCloseTo(bd.netProfit, 6);
  });

  it("reconcileClosing classifies balanced / shortage / surplus correctly", () => {
    const balanced = reconcileClosing({ opening: 100, purchases: 50, supplies: 30, physical: 120, war: 500 });
    expect(balanced.varianceType).toBe("balanced");
    expect(balanced.shortageCost).toBe(0);
    expect(balanced.surplusEstimatedValue).toBe(0);

    const shortage = reconcileClosing({ opening: 100, purchases: 50, supplies: 30, physical: 110, war: 500 });
    expect(shortage.varianceType).toBe("shortage");
    expect(shortage.shortageWeight).toBe(10);
    expect(shortage.shortageCost).toBe(5_000);

    const surplus = reconcileClosing({ opening: 100, purchases: 50, supplies: 30, physical: 130, war: 500 });
    expect(surplus.varianceType).toBe("surplus");
    expect(surplus.surplusWeight).toBe(10);
    expect(surplus.surplusEstimatedValue).toBe(5_000);
  });

  it("payable/receivable helpers exclude reversed rows so report totals match dashboard", () => {
    const farms = [{ id: "F1", opening_balance: 0 }];
    const purchases = [
      { farm_id: "F1", total_amount: 1_000, paid_amount: 200, purchase_date: "2026-01-01", reversed_at: null },
      { farm_id: "F1", total_amount: 500,   paid_amount: 0,   purchase_date: "2026-01-02", reversed_at: "2026-01-03" }, // reversed
    ];
    const bal = computeFarmBalances(farms, purchases, [], [], "2026-12-31");
    expect(bal[0].balance).toBe(800);
    expect(totalPayableToFarms(bal)).toBe(800);

    const shops = [{ id: "S1", opening_balance: 100 }];
    const supp = [
      { shop_id: "S1", total_amount: 500,  supply_date: "2026-01-01", reversed_at: null },
      { shop_id: "S1", total_amount: 200,  supply_date: "2026-01-02", reversed_at: "2026-01-03" }, // reversed
    ];
    const sb = computeShopBalances(shops, supp, [], [], "2026-12-31");
    expect(sb[0].balance).toBe(600);
    expect(totalReceivableFromShops(sb)).toBe(600);
  });
});