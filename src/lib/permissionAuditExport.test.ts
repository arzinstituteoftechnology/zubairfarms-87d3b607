import { describe, it, expect } from "vitest";
import { auditToCSV, type AuditRow } from "./permissionAuditExport";

const row = (o: Partial<AuditRow>): AuditRow => ({
  id: "1", created_at: "2026-01-01T00:00:00Z", actor_email: "a@x", target_email: "b@x",
  action: "role_changed", module: null, permission_action: null,
  previous_value: { tenant_role: "cashier" }, new_value: { tenant_role: "manager" },
  reason: null, actor_ip: null, actor_user_agent: null, ...o,
});

describe("permissionAuditExport", () => {
  it("emits header + one row", () => {
    const csv = auditToCSV([row({})]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Time");
    expect(lines[1]).toContain("role_changed");
  });
  it("escapes quotes and JSON payloads", () => {
    const csv = auditToCSV([row({ reason: 'say "hi"' })]);
    expect(csv).toContain('""hi""');
    expect(csv).toContain("tenant_role");
  });
  it("handles empty list", () => {
    expect(auditToCSV([]).split("\n")).toHaveLength(1);
  });
});