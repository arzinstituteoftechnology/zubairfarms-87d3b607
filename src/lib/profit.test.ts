import { describe, it, expect } from "vitest";
import { calcRealizedProfit } from "./profit";

describe("calcRealizedProfit", () => {
  it("matches the user's worked example (Purchase 150,000 / Supply 152,220 → 2,220)", () => {
    expect(calcRealizedProfit(152220, 150000)).toBe(2220);
  });

  it("returns 0 when supply equals purchase", () => {
    expect(calcRealizedProfit(100000, 100000)).toBe(0);
  });

  it("returns negative when purchases exceed supply revenue", () => {
    expect(calcRealizedProfit(80000, 100000)).toBe(-20000);
  });

  it("treats null/undefined as zero", () => {
    expect(calcRealizedProfit(null, undefined)).toBe(0);
    expect(calcRealizedProfit(5000, null)).toBe(5000);
    expect(calcRealizedProfit(undefined, 3000)).toBe(-3000);
  });

  it("ignores inventory/adjustments — inputs must already be date-scoped totals", () => {
    // Simulates: 500kg purchased @ 300 = 150,000; 490kg supplied for 152,220.
    // Remaining 10kg inventory value must NOT enter profit.
    const purchaseAmt = 150000;
    const supplyAmt = 152220;
    expect(calcRealizedProfit(supplyAmt, purchaseAmt)).toBe(2220);
  });
});