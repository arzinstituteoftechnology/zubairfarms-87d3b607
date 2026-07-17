import { describe, it, expect } from "vitest";
import { activityToCSV, parseUserAgent, summarizeAction, type ActivityLogRow } from "./activityLogExport";

const row = (o: Partial<ActivityLogRow>): ActivityLogRow => ({
  id: "1", created_at: "2026-01-01T00:00:00Z",
  action: "purchases_insert", entity: "purchases", entity_id: "p1",
  tenant_id: "t1", actor_user_id: "u1", actor_name: "Alice",
  metadata: { ip: "1.2.3.4", user_agent: "Mozilla/5.0 Chrome/120", success: true },
  ...o,
});

describe("parseUserAgent", () => {
  it("detects Chrome on Windows Desktop", () => {
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537"))
      .toEqual({ browser: "Chrome", os: "Windows", device: "Desktop" });
  });
  it("detects Safari on iPhone Mobile", () => {
    expect(parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605"))
      .toEqual({ browser: "Safari", os: "iOS", device: "Mobile" });
  });
  it("handles empty UA", () => {
    expect(parseUserAgent("")).toEqual({ browser: "", os: "", device: "" });
    expect(parseUserAgent(null)).toEqual({ browser: "", os: "", device: "" });
  });
});

describe("summarizeAction", () => {
  it("splits table_op actions", () => {
    expect(summarizeAction("purchases_insert")).toEqual({ module: "purchases", verb: "create" });
    expect(summarizeAction("shops_update")).toEqual({ module: "shops", verb: "update" });
    expect(summarizeAction("farms_delete")).toEqual({ module: "farms", verb: "delete" });
  });
  it("handles auth events", () => {
    expect(summarizeAction("auth_login")).toEqual({ module: "authentication", verb: "login" });
    expect(summarizeAction("auth_failed_login"))
      .toEqual({ module: "authentication", verb: "failed_login" });
  });
});

describe("activityToCSV", () => {
  it("emits header + row with parsed UA columns", () => {
    const csv = activityToCSV([row({})]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Browser");
    expect(lines[1]).toContain("Chrome");
    expect(lines[1]).toContain("purchases");
    expect(lines[1]).toContain("success");
  });
  it("marks failure when metadata.success=false", () => {
    const csv = activityToCSV([row({ metadata: { success: false } })]);
    expect(csv).toContain("failure");
  });
  it("escapes quotes in metadata", () => {
    const csv = activityToCSV([row({ metadata: { note: 'say "hi"' } })]);
    expect(csv).toContain('""hi""');
  });
  it("handles empty list", () => {
    expect(activityToCSV([]).split("\n")).toHaveLength(1);
  });
});