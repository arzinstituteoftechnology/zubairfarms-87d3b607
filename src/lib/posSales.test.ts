import { describe, it, expect } from "vitest";
import { computeBill, posProfitLines, posTotals, money2 } from "./posSales";
import { calcRealizedProfit } from "./profit";

describe("POS bill", () => {
  it("blank Paid means full payment, so Due is 0", () => {
    const b = computeBill([{ weight: 5, rate: 500, faraq: 0 }], 0, null);
    expect(b.total).toBe(2500);
    expect(b.paid).toBe(2500);
    expect(b.due).toBe(0);
  });
  it("Due recomputes from Paid", () => {
    const b = computeBill([{ weight: 5, rate: 500, faraq: 0 }], 0, 1000);
    expect(b.due).toBe(1500);
  });
  it("overpayment shows change instead of hiding it (paid 4,800 vs total 25)", () => {
    const b = computeBill([{ weight: 1, rate: 25, faraq: 0 }], 0, 4800);
    expect(b.due).toBe(0);
    expect(b.change).toBe(4775);
  });
  it("discount larger than subtotal is flagged, not clamped to 0", () => {
    const b = computeBill([{ weight: 1, rate: 100, faraq: 0 }], 150, null);
    expect(b.discountTooHigh).toBe(true);
    expect(b.total).toBe(-50);
  });
  it("faraq larger than rate is flagged", () => {
    const b = computeBill([{ weight: 1, rate: 100, faraq: 120 }], 0, null);
    expect(b.anyFaraqTooHigh).toBe(true);
    expect(b.items[0].finalRate).toBe(-20);
  });
  it("rounds away float artifacts", () => {
    expect(money2(333.3299865722656)).toBe(333.33);
  });
});

describe("POS in profit and totals", () => {
  const sales: any[] = [
    { id: "a", invoice_no: 5, sale_date: "2026-11-19", total: 2500, paid: 2500, due: 0, discount: 0, subtotal: 2500, payment_method: "cash", voided_at: null,
      pos_sale_items: [{ meat_type: "Chicken", weight_kg: 5, final_rate: 500, line_total: 2500, cost_per_kg: 400 }] },
    { id: "b", invoice_no: 6, sale_date: "2026-11-19", total: 1000, paid: 0, due: 1000, discount: 0, subtotal: 1000, payment_method: "cash", voided_at: "2026-11-19T10:00:00Z",
      pos_sale_items: [{ meat_type: "Chicken", weight_kg: 2, final_rate: 500, line_total: 1000, cost_per_kg: 400 }] },
  ];
  it("invoice #5 (5 kg @ 500, cost 400) adds Rs 500 profit; void invoices add nothing", () => {
    expect(calcRealizedProfit(posProfitLines(sales))).toBe(500);
  });
  it("totals skip voided invoices", () => {
    const t = posTotals(sales);
    expect(t.count).toBe(1);
    expect(t.total).toBe(2500);
    expect(t.kg).toBe(5);
    expect(t.due).toBe(0);
  });
});
