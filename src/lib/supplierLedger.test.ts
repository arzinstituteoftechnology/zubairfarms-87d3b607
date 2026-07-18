import { describe, it, expect } from "vitest";
import { computeSupplierBalances, buildSupplierLedgerRows } from "./supplierLedger";

const farm = { id: "f1", opening_balance: 550000 };

// Mandatory acceptance test: fully reversed ledger for Almas Farm
describe("supplierLedger — fully reversed Almas Farm scenario", () => {
  const purchases = [{
    id: "pu1", farm_id: "f1", total_amount: 40000, paid_amount: 0,
    purchase_date: "2026-07-18", created_at: "2026-07-18T17:28:28Z",
    reversed_at: "2026-07-18T18:11:00Z",
  }];
  const payments = [{
    id: "pa1", farm_id: "f1", amount: 90000,
    payment_date: "2026-07-18", created_at: "2026-07-18T18:07:17Z",
    reversed_at: "2026-07-18T18:10:58Z",
  }];
  const ledger = [
    { id: "l1", supplier_id: "f1", entry_type: "opening_balance", entry_date: "2026-07-18",
      amount: 550000, created_at: "2026-07-18T17:21:03Z",
      reversed_at: "2026-07-18T18:07:34Z", original_entry_id: null },
    { id: "l2", supplier_id: "f1", entry_type: "reversed_opening_balance", entry_date: "2026-07-18",
      amount: 550000, created_at: "2026-07-18T18:07:34Z",
      reversed_at: null, original_entry_id: "l1" },
    { id: "l3", supplier_id: "f1", entry_type: "reversed_payment", entry_date: "2026-07-18",
      amount: 90000, created_at: "2026-07-18T18:10:58Z",
      reversed_at: null, original_entry_id: null },
    { id: "l4", supplier_id: "f1", entry_type: "reversed_purchase", entry_date: "2026-07-18",
      amount: 40000, created_at: "2026-07-18T18:11:19Z",
      reversed_at: null, original_entry_id: null },
  ];

  it("summary cards read 0/0/0/0 — Settled", () => {
    const [b] = computeSupplierBalances([farm], purchases, payments, ledger);
    expect(b.opening).toBe(0);
    expect(b.purchased).toBe(0);
    expect(b.paid).toBe(0);
    expect(b.balance).toBe(0);
  });

  it("audit rows survive in the chronological ledger with correct 0 running balance", () => {
    const rows = buildSupplierLedgerRows(0 /* opening reversed */, purchases, payments, ledger);
    // Sorted by (date, created_at). All same date so created_at wins:
    // opening (17:21) → purchase (17:28) → payment (18:07:17) →
    // reversed_opening (18:07:34) → reversed_payment (18:10:58) →
    // reversed_purchase (18:11:19)
    expect(rows.map(r => r.kind)).toEqual([
      "opening", "purchase", "payment",
      "reversed_opening_balance", "reversed_payment", "reversed_purchase",
    ]);
    // Every running balance must be 0 because opening was reversed and
    // every subsequent original was reversed.
    for (const r of rows) expect(r.running).toBe(0);
  });

  it("historical/reversed gross totals are surfaced separately", () => {
    const [b] = computeSupplierBalances([farm], purchases, payments, ledger);
    expect(b.reversedGross).toEqual({
      openings: 550000, purchases: 40000, payments: 90000, adjustments: 0,
    });
  });
});

describe("supplierLedger — running balance mechanics", () => {
  it("chronological order uses created_at as tie-breaker on same date", () => {
    const rows = buildSupplierLedgerRows(
      0,
      [{ id: "pu", farm_id: "f1", total_amount: 100, paid_amount: 0,
         purchase_date: "2026-01-01", created_at: "2026-01-01T09:00:00Z", reversed_at: null }],
      [{ id: "pa", farm_id: "f1", amount: 40,
         payment_date: "2026-01-01", created_at: "2026-01-01T10:00:00Z", reversed_at: null }],
      [],
    );
    expect(rows.map(r => r.running)).toEqual([100, 60]);
  });

  it("opening + purchase + partial payment", () => {
    const rows = buildSupplierLedgerRows(
      1000,
      [{ id: "pu", farm_id: "f1", total_amount: 500, paid_amount: 200,
         purchase_date: "2026-02-01", created_at: "2026-02-01T00:00:00Z", reversed_at: null }],
      [{ id: "pa", farm_id: "f1", amount: 300,
         payment_date: "2026-02-02", created_at: "2026-02-02T00:00:00Z", reversed_at: null }],
      [],
    );
    // 1000 + (500 - 200) → 1300, then -300 → 1000
    expect(rows[0].running).toBe(1300);
    expect(rows[1].running).toBe(1000);
  });

  it("overpayment produces a supplier advance (negative balance)", () => {
    const [b] = computeSupplierBalances(
      [{ id: "f1", opening_balance: 0 }],
      [{ id: "pu", farm_id: "f1", total_amount: 100, paid_amount: 0,
         purchase_date: "2026-03-01", created_at: "2026-03-01T00:00:00Z", reversed_at: null }],
      [{ id: "pa", farm_id: "f1", amount: 250,
         payment_date: "2026-03-02", created_at: "2026-03-02T00:00:00Z", reversed_at: null }],
      [],
    );
    expect(b.balance).toBe(-150);
  });

  it("active adjustments (both signs) flow through", () => {
    const [b] = computeSupplierBalances(
      [{ id: "f1", opening_balance: 0 }], [], [],
      [
        { id: "a1", supplier_id: "f1", entry_type: "adjustment_increase", entry_date: "2026-04-01",
          amount: 500, created_at: "2026-04-01T00:00:00Z", reversed_at: null, original_entry_id: null },
        { id: "a2", supplier_id: "f1", entry_type: "adjustment_decrease", entry_date: "2026-04-02",
          amount: 200, created_at: "2026-04-02T00:00:00Z", reversed_at: null, original_entry_id: null },
      ],
    );
    expect(b.adjustments).toBe(300);
    expect(b.balance).toBe(300);
  });

  it("cutoffDate ignores events after the cutoff", () => {
    const [b] = computeSupplierBalances(
      [{ id: "f1", opening_balance: 100 }],
      [{ id: "pu", farm_id: "f1", total_amount: 50, paid_amount: 0,
         purchase_date: "2026-05-10", created_at: "2026-05-10T00:00:00Z", reversed_at: null }],
      [],
      [],
      "2026-05-01",
    );
    // Purchase on 05-10 excluded from opening-as-of 05-01.
    expect(b.balance).toBe(100);
  });

  it("does not double-count opening_balance from the ledger entry", () => {
    const [b] = computeSupplierBalances(
      [{ id: "f1", opening_balance: 550000 }], [], [],
      [{ id: "l1", supplier_id: "f1", entry_type: "opening_balance", entry_date: "2026-01-01",
         amount: 550000, created_at: "2026-01-01T00:00:00Z",
         reversed_at: null, original_entry_id: null }],
    );
    expect(b.opening).toBe(550000);
    expect(b.balance).toBe(550000);
  });
});
