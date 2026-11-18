import { describe, it, expect } from "vitest";
import { validateNonNegative, friendlyDbError } from "./formValidation";

describe("negative amount validation", () => {
  it("rejects a negative expense amount", () => {
    expect(validateNonNegative({ Amount: "-500" })).toBe("Amount cannot be negative");
  });
  it("rejects a negative purchase rate", () => {
    expect(validateNonNegative({ Weight: "10", "Rate per kg": "-400" })).toBe("Rate per kg cannot be negative");
  });
  it("accepts zero and positive values", () => {
    expect(validateNonNegative({ Amount: "0", Weight: "5.5" })).toBeNull();
  });
  it("maps a raw check-constraint error to a friendly message", () => {
    expect(friendlyDbError('new row for relation "purchases" violates check constraint "purchases_rate_per_kg_check"'))
      .toBe("Rate cannot be negative or invalid. Please correct it and save again.");
  });
});
