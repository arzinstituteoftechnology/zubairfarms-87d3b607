import { describe, it, expect } from "vitest";
import { nextRunAt, formatSize } from "./backupSchedule";

const t0 = new Date("2026-01-15T12:00:00Z");

describe("nextRunAt", () => {
  it("returns null for off", () => {
    expect(nextRunAt("off", t0)).toBeNull();
  });
  it("adds 1 hour for hourly", () => {
    expect(nextRunAt("hourly", t0)?.toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });
  it("adds 6 hours for every_6h", () => {
    expect(nextRunAt("every_6h", t0)?.toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });
  it("adds 1 day for daily", () => {
    expect(nextRunAt("daily", t0)?.toISOString()).toBe("2026-01-16T12:00:00.000Z");
  });
  it("adds 7 days for weekly", () => {
    expect(nextRunAt("weekly", t0)?.toISOString()).toBe("2026-01-22T12:00:00.000Z");
  });
  it("adds 1 month for monthly", () => {
    expect(nextRunAt("monthly", t0)?.toISOString()).toBe("2026-02-15T12:00:00.000Z");
  });
});

describe("formatSize", () => {
  it("handles null", () => expect(formatSize(null)).toBe("—"));
  it("bytes", () => expect(formatSize(500)).toBe("500 B"));
  it("kilobytes", () => expect(formatSize(2048)).toBe("2.0 KB"));
  it("megabytes", () => expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB"));
  it("gigabytes", () => expect(formatSize(3 * 1024 ** 3)).toBe("3.00 GB"));
});