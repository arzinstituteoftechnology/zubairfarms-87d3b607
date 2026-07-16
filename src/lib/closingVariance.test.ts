import { describe, it, expect } from "vitest";
import {
  computeExpectedClosing, classifyVariance, valuedVariance, reconcileClosing,
} from "./closingVariance";

describe("closingVariance", () => {
  it("Test 1 — 100 kg expected, 94 kg physical → 6 kg shortage", () => {
    const r = reconcileClosing({
      opening: 20, purchases: 120, supplies: 40,
      positiveAdjustments: 0, negativeAdjustments: 0, mortality: 0,
      physical: 94, war: 500,
    });
    expect(r.expected).toBe(100);
    expect(r.varianceType).toBe("shortage");
    expect(r.shortageWeight).toBe(6);
    expect(r.surplusWeight).toBe(0);
    expect(r.shortageCost).toBe(3000);
  });

  it("Test 2 — 100 kg expected, 106 kg physical → 6 kg surplus (informational)", () => {
    const r = reconcileClosing({
      opening: 20, purchases: 120, supplies: 40,
      physical: 106, war: 500,
    });
    expect(r.varianceType).toBe("surplus");
    expect(r.surplusWeight).toBe(6);
    expect(r.shortageWeight).toBe(0);
    expect(r.shortageCost).toBe(0);
    expect(r.surplusEstimatedValue).toBe(3000);
  });

  it("Test 3 — balanced closing", () => {
    const r = reconcileClosing({ opening: 50, purchases: 50, supplies: 50, physical: 50, war: 400 });
    expect(r.varianceType).toBe("balanced");
    expect(r.shortageCost).toBe(0);
    expect(r.surplusEstimatedValue).toBe(0);
  });

  it("mortality is subtracted from expected (not double-counted with negative adjustments)", () => {
    // Opening 100, purchases 0, supplies 0, mortality 5 → expected 95
    // Physical 95 → balanced (mortality already inside expected)
    const r = reconcileClosing({ opening: 100, purchases: 0, supplies: 0, mortality: 5, physical: 95, war: 100 });
    expect(r.expected).toBe(95);
    expect(r.varianceType).toBe("balanced");
    expect(r.shortageCost).toBe(0);
  });

  it("negative adjustments reduce expected (no separate profit deduction)", () => {
    const r = reconcileClosing({ opening: 100, purchases: 0, supplies: 0, negativeAdjustments: 10, physical: 90, war: 100 });
    expect(r.expected).toBe(90);
    expect(r.varianceType).toBe("balanced");
  });

  it("classifyVariance rounds and handles string inputs", () => {
    const v = classifyVariance("94.00", 100);
    expect(v.varianceWeight).toBe(-6);
    expect(v.varianceType).toBe("shortage");
  });

  it("valuedVariance with zero war returns zero cost", () => {
    const v = valuedVariance(10, 5, 0);
    expect(v.shortageCost).toBe(0);
    expect(v.surplusEstimatedValue).toBe(0);
  });

  it("computeExpectedClosing null-safe", () => {
    expect(computeExpectedClosing({ opening: null, purchases: undefined, supplies: "" as any })).toBe(0);
  });
});