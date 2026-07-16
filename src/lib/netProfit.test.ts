import { describe, it, expect } from "vitest";
import { computeNetProfit, sumDeliveryExpense, sumGeneralExpense } from "./netProfit";

// Reversal/tenant filtering happens at the query layer (Supabase RLS +
// `.is("reversed_at", null)`); these tests exercise the pure math on the
// filtered rows the callers hand us.
describe("computeNetProfit", () => {
  it("Test A — gross 10,000 − expense 1,500 − delivery 1,000 = 7,500", () => {
    const supplies = [
      { weight_kg: 100, rate_per_kg: 500, cost_per_kg: 400 }, // 10,000
    ];
    const expenses = [{ amount: 1500 }];
    const deliveries = [{ fuel_expense: 500, labour_expense: 300, other_expense: 200 }];
    const r = computeNetProfit({ supplies, expenses, deliveries });
    expect(r.grossProfit).toBe(10_000);
    expect(r.generalExpense).toBe(1_500);
    expect(r.deliveryExpense).toBe(1_000);
    expect(r.netProfit).toBe(7_500);
  });

  it("Test B — no expenses & no deliveries → net = gross", () => {
    const r = computeNetProfit({
      supplies: [{ weight_kg: 50, rate_per_kg: 600, cost_per_kg: 500 }], // 5,000
      expenses: [],
      deliveries: [],
    });
    expect(r.netProfit).toBe(5_000);
    expect(r.netProfit).toBe(r.grossProfit);
  });

  it("Tests C/D — off-date rows filtered upstream do not reduce profit", () => {
    // Caller only passes today's rows. Off-date rows arrive as an empty array.
    const r = computeNetProfit({
      supplies: [{ weight_kg: 10, rate_per_kg: 100, cost_per_kg: 50 }], // 500
      expenses: [], // yesterday's expense excluded by query
      deliveries: [], // tomorrow's delivery excluded by query
    });
    expect(r.netProfit).toBe(500);
  });

  it("Tests E/F/G — reversed supplies / deliveries / expenses do not affect totals when excluded upstream", () => {
    // Only active rows reach the helper.
    const r = computeNetProfit({
      supplies: [{ weight_kg: 20, rate_per_kg: 200, cost_per_kg: 150 }], // 1,000
      expenses: [{ amount: 100 }],
      deliveries: [{ fuel_expense: 50, labour_expense: 0, other_expense: 0 }],
    });
    expect(r.netProfit).toBe(850);
  });

  it("handles null / string / mixed inputs safely", () => {
    expect(sumGeneralExpense(null)).toBe(0);
    expect(sumGeneralExpense([{ amount: "1200.5" }, { amount: null }])).toBe(1200.5);
    expect(sumDeliveryExpense(null)).toBe(0);
    expect(
      sumDeliveryExpense([
        { fuel_expense: "100", labour_expense: null, other_expense: 50 },
        { fuel_expense: 25, labour_expense: 25, other_expense: "0" },
      ]),
    ).toBe(200);
  });

  it("negative net profit surfaces when expenses exceed gross", () => {
    const r = computeNetProfit({
      supplies: [{ weight_kg: 1, rate_per_kg: 100, cost_per_kg: 90 }], // 10
      expenses: [{ amount: 50 }],
      deliveries: [{ fuel_expense: 10, labour_expense: 10, other_expense: 10 }],
    });
    expect(r.netProfit).toBe(-80);
  });
});