import { describe, it, expect } from "vitest";
import {
  computeState, isReadOnly, isValidLicenseKey, pickNotifyWindow,
  quotaUsage, validatePlanChange, trialEndsAt, NOTIFY_WINDOWS
} from "./subscription";

const NOW = new Date("2026-01-15T00:00:00Z");

describe("computeState", () => {
  it("returns none when no expires_at", () => {
    expect(computeState({}, NOW).state).toBe("none");
  });
  it("returns suspended when tenant suspended", () => {
    expect(computeState({ tenant_status: "suspended", expires_at: "2027-01-01" }, NOW).state).toBe("suspended");
  });
  it("returns cancelled when cancelled_at set", () => {
    expect(computeState({ expires_at: "2027-01-01", cancelled_at: "2026-01-01" }, NOW).state).toBe("cancelled");
  });
  it("returns trial for future expiry with is_trial", () => {
    const r = computeState({ expires_at: "2026-02-01", is_trial: true }, NOW);
    expect(r.state).toBe("trial");
    expect(r.readOnly).toBe(false);
  });
  it("returns active for future expiry", () => {
    expect(computeState({ expires_at: "2026-02-01" }, NOW).state).toBe("active");
  });
  it("returns grace within grace window", () => {
    const r = computeState({ expires_at: "2026-01-10", grace_period_days: 7 }, NOW);
    expect(r.state).toBe("grace");
    expect(r.readOnly).toBe(true);
  });
  it("returns expired after grace", () => {
    expect(computeState({ expires_at: "2026-01-01", grace_period_days: 7 }, NOW).state).toBe("expired");
  });
});

describe("isReadOnly", () => {
  it("only active and trial allow writes", () => {
    expect(isReadOnly("active")).toBe(false);
    expect(isReadOnly("trial")).toBe(false);
    for (const s of ["grace", "expired", "suspended", "cancelled", "none"] as const) {
      expect(isReadOnly(s)).toBe(true);
    }
  });
});

describe("isValidLicenseKey", () => {
  it("accepts a well-formed key", () => {
    expect(isValidLicenseKey("ABCDEF-234567-HJKLMN-PQRSTU")).toBe(true);
  });
  it("rejects lowercase/1/0/I/O", () => {
    expect(isValidLicenseKey("abcdef-234567-hjklmn-pqrstu")).toBe(false);
    expect(isValidLicenseKey("ABCDEF-234567-HJKLMN-PQRSTO")).toBe(false);
    expect(isValidLicenseKey("ABCDEF-234567-HJKLMN-PQRSTI")).toBe(false);
  });
  it("rejects wrong block count", () => {
    expect(isValidLicenseKey("ABCDEF-234567-HJKLMN")).toBe(false);
    expect(isValidLicenseKey(null)).toBe(false);
  });
});

describe("pickNotifyWindow", () => {
  it("returns 0 when already expired", () => { expect(pickNotifyWindow(0)).toBe(0); expect(pickNotifyWindow(-3)).toBe(0); });
  it("bucket boundaries", () => {
    expect(pickNotifyWindow(1)).toBe(1);
    expect(pickNotifyWindow(3)).toBe(3);
    expect(pickNotifyWindow(7)).toBe(7);
    expect(pickNotifyWindow(15)).toBe(15);
    expect(pickNotifyWindow(30)).toBe(30);
    expect(pickNotifyWindow(31)).toBeNull();
  });
  it("windows list matches spec", () => {
    expect(NOTIFY_WINDOWS).toEqual([30, 15, 7, 3, 1]);
  });
});

describe("quotaUsage", () => {
  it("handles no limit", () => {
    expect(quotaUsage(50, null)).toEqual({ pct: 0, overLimit: false, hasLimit: false });
  });
  it("calculates percentage", () => {
    expect(quotaUsage(5, 10).pct).toBe(50);
    expect(quotaUsage(11, 10).overLimit).toBe(true);
    expect(quotaUsage(1000, 10).pct).toBe(100);
  });
});

describe("validatePlanChange", () => {
  it("classifies transitions", () => {
    expect(validatePlanChange("starter", "business")).toBe("upgrade");
    expect(validatePlanChange("enterprise", "starter")).toBe("downgrade");
    expect(validatePlanChange("business", "business")).toBe("same");
    expect(validatePlanChange("xxx", "business")).toBe("invalid");
  });
});

describe("trialEndsAt", () => {
  it("adds trial days", () => {
    const end = trialEndsAt(new Date("2026-01-01T00:00:00Z"), 14);
    expect(end.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
});
