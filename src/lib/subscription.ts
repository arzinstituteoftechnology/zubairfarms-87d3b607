export type SubscriptionStateName =
  | "active" | "trial" | "grace" | "expired" | "suspended" | "cancelled" | "none";

export interface PlanQuotas {
  max_users?: number | null;
  max_farms?: number | null;
  max_shops?: number | null;
  max_trucks?: number | null;
  max_storage_mb?: number | null;
  backup_frequency?: string | null;
  report_access?: boolean;
  audit_access?: boolean;
  api_access?: boolean;
  support_priority?: string;
}

export interface SubscriptionSnapshot {
  state: SubscriptionStateName;
  read_only: boolean;
  expires_at?: string | null;
  grace_ends_at?: string | null;
  days_left?: number;
  grace_days_left?: number;
  is_trial?: boolean;
  trial_days?: number | null;
  license_key?: string | null;
  plan_name?: string | null;
  tier?: string | null;
  quotas?: PlanQuotas;
}

export const NOTIFY_WINDOWS = [30, 15, 7, 3, 1] as const;

export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.ceil(ms / 86400000);
}

export function computeState(
  input: {
    expires_at?: string | Date | null;
    cancelled_at?: string | Date | null;
    status?: string | null;
    tenant_status?: string | null;
    is_trial?: boolean;
    grace_period_days?: number;
  },
  now: Date = new Date(),
): { state: SubscriptionStateName; readOnly: boolean; graceEndsAt: Date | null } {
  if (input.tenant_status === "suspended") return { state: "suspended", readOnly: true, graceEndsAt: null };
  if (!input.expires_at) return { state: "none", readOnly: true, graceEndsAt: null };
  const exp = new Date(input.expires_at);
  const grace = new Date(exp.getTime() + (input.grace_period_days ?? 0) * 86400000);
  if (input.cancelled_at) return { state: "cancelled", readOnly: true, graceEndsAt: grace };
  if (input.status === "suspended") return { state: "suspended", readOnly: true, graceEndsAt: grace };
  if (exp > now && input.is_trial) return { state: "trial", readOnly: false, graceEndsAt: grace };
  if (exp > now) return { state: "active", readOnly: false, graceEndsAt: grace };
  if (grace > now) return { state: "grace", readOnly: true, graceEndsAt: grace };
  return { state: "expired", readOnly: true, graceEndsAt: grace };
}

export function isReadOnly(state: SubscriptionStateName): boolean {
  return state !== "active" && state !== "trial";
}

/** URL-safe license key format: 4 blocks of 6 chars separated by "-" */
const LICENSE_RE = /^[A-HJ-NP-Z2-9]{6}(-[A-HJ-NP-Z2-9]{6}){3}$/;
export function isValidLicenseKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return LICENSE_RE.test(key.trim());
}

export function pickNotifyWindow(daysLeft: number): number | null {
  if (daysLeft <= 0) return 0;
  const asc = [...NOTIFY_WINDOWS].sort((a, b) => a - b);
  for (const w of asc) {
    if (daysLeft <= w) return w;
  }
  return null;
}

export function quotaUsage(used: number, max: number | null | undefined): {
  pct: number;
  overLimit: boolean;
  hasLimit: boolean;
} {
  if (max == null) return { pct: 0, overLimit: false, hasLimit: false };
  const pct = max === 0 ? 100 : Math.min(100, Math.round((used / max) * 100));
  return { pct, overLimit: used > max, hasLimit: true };
}

export function validatePlanChange(from: string | null, to: string | null): "upgrade" | "downgrade" | "same" | "invalid" {
  const order = ["starter", "professional", "business", "enterprise", "custom"];
  const a = order.indexOf((from ?? "").toLowerCase());
  const b = order.indexOf((to ?? "").toLowerCase());
  if (b < 0 || a < 0) return "invalid";
  if (a === b) return "same";
  return b > a ? "upgrade" : "downgrade";
}

export function trialEndsAt(startedAt: Date, trialDays: number): Date {
  return new Date(startedAt.getTime() + trialDays * 86400000);
}
