import { describe, it, expect } from "vitest";
import { allocateAging, collectionRate } from "./shopAging";

describe("allocateAging", () => {
  it("FIFO applies credits oldest-first and buckets remainder by age", () => {
    const r = allocateAging(
      [
        { date: "2026-06-01", amount: 1000 }, // 45 days old vs 2026-07-16
        { date: "2026-07-01", amount: 2000 }, // 15 days
        { date: "2026-07-15", amount: 500 },  //  1 day
      ],
      [{ date: "2026-07-10", amount: 1500 }],
      "2026-07-16",
    );
    // 1500 credit clears the 1000 (Jun 1) and 500 of the 2000 (Jul 1)
    // remaining: 1500 in 0-30 (Jul 1 = 15d) + 500 in 0-30 (Jul 15 = 1d) = 2000
    expect(r.buckets["0-30"]).toBe(2000);
    expect(r.buckets["31-60"]).toBe(0);
    expect(r.total).toBe(2000);
    expect(r.oldestUnpaidDate).toBe("2026-07-01");
  });

  it("puts remainder into correct age buckets", () => {
    const r = allocateAging(
      [
        { date: "2026-04-01", amount: 1000 }, // 106 d → 90+
        { date: "2026-05-15", amount: 1000 }, //  62 d → 61-90
        { date: "2026-06-10", amount: 1000 }, //  36 d → 31-60
        { date: "2026-07-05", amount: 1000 }, //  11 d → 0-30
      ],
      [],
      "2026-07-16",
    );
    expect(r.buckets["90+"]).toBe(1000);
    expect(r.buckets["61-90"]).toBe(1000);
    expect(r.buckets["31-60"]).toBe(1000);
    expect(r.buckets["0-30"]).toBe(1000);
    expect(r.total).toBe(4000);
  });

  it("returns zeros when credits fully cover debits", () => {
    const r = allocateAging(
      [{ date: "2026-06-01", amount: 500 }],
      [{ date: "2026-07-01", amount: 500 }],
      "2026-07-16",
    );
    expect(r.total).toBe(0);
    expect(r.oldestUnpaidDate).toBeNull();
  });
});

describe("collectionRate", () => {
  it("returns 0 when there are no debits", () => {
    expect(collectionRate(0, 500)).toBe(0);
  });
  it("clamps to 0..100", () => {
    expect(collectionRate(1000, 250)).toBe(25);
    expect(collectionRate(1000, 2000)).toBe(100);
    expect(collectionRate(1000, -50)).toBe(0);
  });
});