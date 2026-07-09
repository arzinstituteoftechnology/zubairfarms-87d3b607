import { describe, it, expect } from "vitest";
import { calcRealizedProfit, calcSupplyLineProfit } from "./profit";

describe("calcRealizedProfit", () => {
  it("worked example: 215.5kg × (304 − 294) = 2,155 (not −328,448)", () => {
    // Purchase 1340kg @ 294 = 393,960 (irrelevant — inventory is NOT loss)
    // Supply 215.5kg @ sale 304, cost 294 → profit 2,155
    expect(calcRealizedProfit([{ weight_kg: 215.5, rate_per_kg: 304, cost_per_kg: 294 }])).toBeCloseTo(2155, 6);
  });

  it("sums profit across multiple supply lines", () => {
    expect(calcRealizedProfit([
      { weight_kg: 100, rate_per_kg: 310, cost_per_kg: 300 }, // 1000
      { weight_kg: 50,  rate_per_kg: 320, cost_per_kg: 300 }, // 1000
    ])).toBe(2000);
  });

  it("returns 0 when sale rate equals cost", () => {
    expect(calcRealizedProfit([{ weight_kg: 100, rate_per_kg: 300, cost_per_kg: 300 }])).toBe(0);
  });

  it("returns negative when sale rate < cost", () => {
    expect(calcRealizedProfit([{ weight_kg: 100, rate_per_kg: 290, cost_per_kg: 300 }])).toBe(-1000);
  });

  it("treats null/undefined as zero", () => {
    expect(calcRealizedProfit(null)).toBe(0);
    expect(calcRealizedProfit(undefined)).toBe(0);
    expect(calcRealizedProfit([])).toBe(0);
    expect(calcSupplyLineProfit({ weight_kg: null, rate_per_kg: 100, cost_per_kg: 50 })).toBe(0);
  });

  it("ignores remaining inventory — only supplied weight generates profit", () => {
    // 500kg purchased @ 300 = 150,000 cost; 490kg supplied @ 310.65 sale, 300 cost
    // Profit = 490 × (310.65 − 300) = 5,218.5 — remaining 10kg does NOT count
    expect(calcRealizedProfit([{ weight_kg: 490, rate_per_kg: 310.65, cost_per_kg: 300 }])).toBeCloseTo(5218.5, 6);
  });
});