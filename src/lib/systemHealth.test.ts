import { describe, it, expect } from "vitest";
import {
  worseStatus, classifyErrors, classifyQueue, classifyScheduler, classifyBackup,
  classifyEmailQueue, buildHealthChecks, overallStatus, filterErrorRows, toCSV, systemInfo,
  type HealthSnapshot,
} from "./systemHealth";

describe("worseStatus", () => {
  it("critical dominates", () => { expect(worseStatus("healthy", "critical")).toBe("critical"); });
  it("warning beats healthy", () => { expect(worseStatus("warning", "healthy")).toBe("warning"); });
  it("unknown loses to healthy", () => { expect(worseStatus("unknown", "healthy")).toBe("healthy"); });
});

describe("classifiers", () => {
  it("errors", () => {
    expect(classifyErrors(0,0)).toBe("healthy");
    expect(classifyErrors(25,1)).toBe("warning");
    expect(classifyErrors(200,50)).toBe("critical");
  });
  it("queue", () => {
    expect(classifyQueue(0,0)).toBe("healthy");
    expect(classifyQueue(150,0)).toBe("warning");
    expect(classifyQueue(0,25)).toBe("critical");
  });
  it("scheduler", () => {
    expect(classifyScheduler(null)).toBe("unknown");
    expect(classifyScheduler(60)).toBe("healthy");
    expect(classifyScheduler(300)).toBe("warning");
    expect(classifyScheduler(999)).toBe("critical");
  });
  it("backup", () => {
    expect(classifyBackup(null, null)).toBe("warning");
    expect(classifyBackup(new Date().toISOString(), "success")).toBe("healthy");
    expect(classifyBackup(new Date(Date.now() - 8*86400000).toISOString(), "success")).toBe("warning");
    expect(classifyBackup(new Date().toISOString(), "failed")).toBe("critical");
  });
  it("email queue", () => {
    expect(classifyEmailQueue(0)).toBe("healthy");
    expect(classifyEmailQueue(60)).toBe("warning");
    expect(classifyEmailQueue(300)).toBe("critical");
  });
});

const snap: HealthSnapshot = {
  generated_at: new Date().toISOString(),
  jobs: { queued: 2, running: 0, failed_24h: 0, succeeded_24h: 5 },
  errors: { last_24h: 1, unresolved: 0 },
  users: { active: 3, sessions_15m: 1 },
  backup: { last_at: new Date().toISOString(), status: "success", total_bytes: 1024 },
  email_queue_pending: 0,
  scheduler_last_tick: new Date().toISOString(),
  scheduler_last_tick_seconds: 30,
  requests_last_minute: 10,
  requests_last_hour: 300,
};

describe("buildHealthChecks & overall", () => {
  it("emits 10 checks and computes overall status", () => {
    const checks = buildHealthChecks(snap);
    expect(checks.length).toBe(10);
    expect(overallStatus(checks)).toBe("healthy");
  });
  it("critical bubbles up", () => {
    const bad = { ...snap, backup: { ...snap.backup, status: "failed" } };
    expect(overallStatus(buildHealthChecks(bad))).toBe("critical");
  });
});

describe("filterErrorRows", () => {
  const rows = [
    { created_at: "2026-01-10T00:00:00Z", severity: "error", module: "pos", message: "Bad payment" },
    { created_at: "2026-01-12T00:00:00Z", severity: "warn", module: "backup", message: "Slow write" },
  ];
  it("filters by severity + q", () => {
    expect(filterErrorRows(rows, { severity: "error" })).toHaveLength(1);
    expect(filterErrorRows(rows, { q: "slow" })).toHaveLength(1);
  });
  it("filters by date range", () => {
    expect(filterErrorRows(rows, { from: "2026-01-11" })).toHaveLength(1);
  });
});

describe("toCSV", () => {
  it("escapes quotes and commas", () => {
    const out = toCSV([{ a: 'has "quote", and comma', b: 1 }], ["a","b"]);
    expect(out.split("\n")[1]).toBe('"has ""quote"", and comma",1');
  });
});

describe("systemInfo", () => {
  it("returns required keys", () => {
    const info = systemInfo("2026.07.17");
    expect(Object.keys(info)).toEqual(expect.arrayContaining(["version","build","environment","schema_version","node_version"]));
    expect(info.schema_version).toBe("2026.07.17");
  });
});
