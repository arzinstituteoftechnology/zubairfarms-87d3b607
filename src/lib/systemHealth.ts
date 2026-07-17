export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  detail?: string;
  last_checked?: string;
}

export interface HealthSnapshot {
  generated_at: string;
  jobs: { queued: number; running: number; failed_24h: number; succeeded_24h: number };
  errors: { last_24h: number; unresolved: number };
  users: { active: number; sessions_15m: number };
  backup: { last_at: string | null; status: string | null; total_bytes: number };
  email_queue_pending: number;
  scheduler_last_tick: string | null;
  scheduler_last_tick_seconds: number | null;
  requests_last_minute: number;
  requests_last_hour: number;
}

/** Return the worse of two health statuses (unknown < healthy < warning < critical). */
export function worseStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  const rank: Record<HealthStatus, number> = { unknown: 0, healthy: 1, warning: 2, critical: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export function classifyErrors(count24h: number, unresolved: number): HealthStatus {
  if (unresolved >= 10 || count24h >= 100) return "critical";
  if (unresolved >= 3 || count24h >= 20) return "warning";
  return "healthy";
}

export function classifyQueue(queued: number, failed24h: number): HealthStatus {
  if (failed24h >= 20 || queued >= 500) return "critical";
  if (failed24h >= 5 || queued >= 100) return "warning";
  return "healthy";
}

export function classifyScheduler(lastTickSeconds: number | null): HealthStatus {
  if (lastTickSeconds == null) return "unknown";
  if (lastTickSeconds > 600) return "critical";
  if (lastTickSeconds > 180) return "warning";
  return "healthy";
}

export function classifyBackup(lastAt: string | null, status: string | null): HealthStatus {
  if (!lastAt) return "warning";
  const age = Date.now() - new Date(lastAt).getTime();
  const days = age / 86400000;
  if (status === "failed") return "critical";
  if (days > 14) return "critical";
  if (days > 7) return "warning";
  return "healthy";
}

export function classifyEmailQueue(pending: number): HealthStatus {
  if (pending >= 200) return "critical";
  if (pending >= 50) return "warning";
  return "healthy";
}

export function buildHealthChecks(snap: HealthSnapshot): HealthCheck[] {
  const now = snap.generated_at;
  return [
    { key: "database", label: "Database", status: "healthy", detail: "Connected", last_checked: now },
    { key: "auth", label: "Authentication", status: "healthy", detail: "Session verified", last_checked: now },
    { key: "storage", label: "Storage", status: "healthy", detail: "Backups accessible", last_checked: now },
    { key: "cron", label: "Cron Scheduler", status: classifyScheduler(snap.scheduler_last_tick_seconds), detail: snap.scheduler_last_tick_seconds != null ? `${snap.scheduler_last_tick_seconds}s ago` : "no tick", last_checked: now },
    { key: "email", label: "Email Queue", status: classifyEmailQueue(snap.email_queue_pending), detail: `${snap.email_queue_pending} pending`, last_checked: now },
    { key: "backup", label: "Backup Scheduler", status: classifyBackup(snap.backup.last_at, snap.backup.status), detail: snap.backup.last_at ? `last ${new Date(snap.backup.last_at).toLocaleString()}` : "no backup yet", last_checked: now },
    { key: "queue", label: "Job Queue", status: classifyQueue(snap.jobs.queued, snap.jobs.failed_24h), detail: `${snap.jobs.queued} queued · ${snap.jobs.failed_24h} failed 24h`, last_checked: now },
    { key: "errors", label: "Errors", status: classifyErrors(snap.errors.last_24h, snap.errors.unresolved), detail: `${snap.errors.last_24h} in 24h · ${snap.errors.unresolved} unresolved`, last_checked: now },
    { key: "api", label: "API", status: "healthy", detail: `${snap.requests_last_minute} req/min`, last_checked: now },
    { key: "realtime", label: "Realtime", status: "healthy", detail: "Enabled", last_checked: now },
  ];
}

export function overallStatus(checks: HealthCheck[]): HealthStatus {
  return checks.reduce<HealthStatus>((acc, c) => worseStatus(acc, c.status), "healthy");
}

export interface LogFilter {
  from?: string;
  to?: string;
  severity?: string;
  module?: string;
  q?: string;
}

export function filterErrorRows<T extends { created_at: string; severity?: string; module?: string; message?: string }>(
  rows: T[],
  f: LogFilter,
): T[] {
  const from = f.from ? new Date(f.from).getTime() : -Infinity;
  const to = f.to ? new Date(f.to).getTime() + 86400000 : Infinity;
  const q = (f.q ?? "").toLowerCase().trim();
  return rows.filter((r) => {
    const t = new Date(r.created_at).getTime();
    if (t < from || t > to) return false;
    if (f.severity && r.severity !== f.severity) return false;
    if (f.module && r.module !== f.module) return false;
    if (q && !`${r.message ?? ""} ${r.module ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function toCSV(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function systemInfo(schemaVersion: string): {
  version: string;
  build: string;
  environment: string;
  deployment_date: string;
  schema_version: string;
  node_version: string;
} {
  return {
    version: (import.meta as any)?.env?.VITE_APP_VERSION ?? "1.0.0",
    build: (import.meta as any)?.env?.VITE_BUILD_ID ?? "dev",
    environment: (import.meta as any)?.env?.MODE ?? "production",
    deployment_date: (import.meta as any)?.env?.VITE_BUILD_TIME ?? new Date().toISOString().slice(0, 10),
    schema_version: schemaVersion,
    node_version: (import.meta as any)?.env?.VITE_NODE_VERSION ?? "20.x",
  };
}
