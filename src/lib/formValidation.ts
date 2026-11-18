/**
 * Returns a friendly error for the first negative (or non-numeric) value, or null.
 * Empty values are ignored here; "required" checks happen separately.
 */
export function validateNonNegative(fields: Record<string, string | number | null | undefined>): string | null {
  for (const [label, raw] of Object.entries(fields)) {
    if (raw === "" || raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return `${label} must be a number`;
    if (n < 0) return `${label} cannot be negative`;
  }
  return null;
}

/** Turns a raw database check-constraint error into a friendly sentence. */
export function friendlyDbError(message: string): string | null {
  const m = /violates check constraint "([^"]+)"/.exec(message);
  if (!m) return null;
  const c = m[1].toLowerCase();
  const field =
    c.includes("rate") ? "Rate" : c.includes("weight") || c.includes("qty") || c.includes("quantity") ? "Quantity" :
    c.includes("paid") ? "Paid amount" : c.includes("total") ? "Total" : c.includes("amount") ? "Amount" :
    c.includes("cost") ? "Cost" : c.includes("count") ? "Count" : "A value";
  return `${field} cannot be negative or invalid. Please correct it and save again.`;
}
