import { describe, it, expect } from "vitest";
import { mergeCollections, sumActive } from "./recoveries";

describe("collections = Daily Recovery + Shop Ledger payments", () => {
  const rec = [{ id: "r1", recovery_date: "2026-11-19", shop_id: "s", amount: 3000, payment_method: "jazzcash", reversed_at: null }];
  const ledger = [
    { id: "l1", entry_date: "2026-11-19", shop_id: "s", entry_type: "manual_payment", amount: 7000, reversed_at: null, original_entry_id: null },
    // recovery-generated ledger row must not be counted twice
    { id: "l2", entry_date: "2026-11-19", shop_id: "s", entry_type: "recovery", amount: 3000, reversed_at: null, original_entry_id: null },
  ];
  it("7,000 ledger payment + 3,000 JazzCash recovery = 10,000", () => {
    expect(sumActive(mergeCollections(rec, ledger))).toBe(10000);
  });
  it("reversed entries are excluded", () => {
    const rows = mergeCollections(rec, [{ ...ledger[0], reversed_at: "x" }]);
    expect(sumActive(rows)).toBe(3000);
  });
});
