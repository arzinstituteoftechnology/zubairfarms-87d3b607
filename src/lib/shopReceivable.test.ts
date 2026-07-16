import { describe, it, expect } from "vitest";
import { computeShopBalances, totalReceivableFromShops } from "./shopReceivable";

describe("computeShopBalances / totalReceivableFromShops", () => {
  const shops = [
    { id: "s1", opening_balance: 1000 },
    { id: "s2", opening_balance: 0 },
    { id: "s3", opening_balance: 500 },
  ];

  it("reconciles opening + supplies − recoveries + adjustments across all shops", () => {
    const supplies = [
      { shop_id: "s1", total_amount: 5000, reversed_at: null, supply_date: "2026-07-10" },
      { shop_id: "s1", total_amount: 3000, reversed_at: "2026-07-11", supply_date: "2026-07-10" }, // reversed → skip
      { shop_id: "s2", total_amount: 2000, reversed_at: null, supply_date: "2026-07-10" },
    ];
    const ledger = [
      { id: "l1", shop_id: "s1", entry_type: "recovery",           amount: 1500, entry_date: "2026-07-12", reversed_at: null, reversal_entry_id: null, original_entry_id: null },
      { id: "l2", shop_id: "s1", entry_type: "recovery",           amount: 500,  entry_date: "2026-07-13", reversed_at: null, reversal_entry_id: null, original_entry_id: null },
      { id: "l3", shop_id: "s2", entry_type: "adjustment_increase",amount: 200,  entry_date: "2026-07-10", reversed_at: null, reversal_entry_id: null, original_entry_id: null },
      { id: "l4", shop_id: "s3", entry_type: "reversed_recovery",  amount: 100,  entry_date: "2026-07-10", reversed_at: null, reversal_entry_id: null, original_entry_id: null }, // audit only
    ];
    const balances = computeShopBalances(shops, supplies, ledger, [], null);
    // s1: 1000 + 5000 − (1500+500) = 4000
    // s2: 0 + 2000 + 200 = 2200
    // s3: 500 (reversed_recovery audit skipped)
    expect(balances.find(b => b.id === "s1")!.balance).toBe(4000);
    expect(balances.find(b => b.id === "s2")!.balance).toBe(2200);
    expect(balances.find(b => b.id === "s3")!.balance).toBe(500);
    expect(totalReceivableFromShops(balances)).toBe(6700);
  });

  it("excludes rows after the cutoff date", () => {
    const supplies = [
      { shop_id: "s1", total_amount: 5000, reversed_at: null, supply_date: "2026-07-10" },
      { shop_id: "s1", total_amount: 9000, reversed_at: null, supply_date: "2026-07-20" }, // future
    ];
    const ledger = [
      { id: "l1", shop_id: "s1", entry_type: "recovery", amount: 1000, entry_date: "2026-07-11", reversed_at: null, reversal_entry_id: null, original_entry_id: null },
      { id: "l2", shop_id: "s1", entry_type: "recovery", amount: 4000, entry_date: "2026-07-25", reversed_at: null, reversal_entry_id: null, original_entry_id: null }, // future
    ];
    const balances = computeShopBalances([{ id: "s1", opening_balance: 0 }], supplies, ledger, [], "2026-07-15");
    expect(balances[0].balance).toBe(4000); // 5000 − 1000
  });

  it("clamps overall negative total to 0", () => {
    const balances = computeShopBalances(
      [{ id: "s1", opening_balance: 0 }],
      [],
      [{ id: "l1", shop_id: "s1", entry_type: "recovery", amount: 500, entry_date: null, reversed_at: null, reversal_entry_id: null, original_entry_id: null }],
      [], null,
    );
    expect(balances[0].balance).toBe(-500);
    expect(totalReceivableFromShops(balances)).toBe(0);
  });

  it("honours opening_balance override and opening reversal", () => {
    const balances = computeShopBalances(
      [{ id: "s1", opening_balance: 1000 }, { id: "s2", opening_balance: 1000 }],
      [],
      [
        { id: "o1", shop_id: "s1", entry_type: "opening_balance", amount: 250, entry_date: null, reversed_at: null, reversal_entry_id: null, original_entry_id: null },
        { id: "o2", shop_id: "s2", entry_type: "opening_balance", amount: 750, entry_date: null, reversed_at: "2026-01-01", reversal_entry_id: null, original_entry_id: null },
      ],
      [], null,
    );
    expect(balances.find(b => b.id === "s1")!.opening).toBe(250);
    expect(balances.find(b => b.id === "s2")!.opening).toBe(0);
  });
});