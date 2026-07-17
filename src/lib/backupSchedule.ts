export type BackupSchedule = "off" | "hourly" | "every_6h" | "daily" | "weekly" | "monthly";

export const SCHEDULE_LABELS: Record<BackupSchedule, string> = {
  off: "Disabled",
  hourly: "Every hour",
  every_6h: "Every 6 hours",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** Compute next-run timestamp for a schedule from a given point in time. */
export function nextRunAt(schedule: BackupSchedule, from: Date = new Date()): Date | null {
  const d = new Date(from);
  switch (schedule) {
    case "off":       return null;
    case "hourly":    d.setUTCHours(d.getUTCHours() + 1); return d;
    case "every_6h":  d.setUTCHours(d.getUTCHours() + 6); return d;
    case "daily":     d.setUTCDate(d.getUTCDate() + 1); return d;
    case "weekly":    d.setUTCDate(d.getUTCDate() + 7); return d;
    case "monthly":   d.setUTCMonth(d.getUTCMonth() + 1); return d;
  }
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}