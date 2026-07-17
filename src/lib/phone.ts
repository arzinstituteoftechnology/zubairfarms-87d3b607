/**
 * Normalize a Pakistani mobile number to E.164 (+92XXXXXXXXXX).
 * Returns null when the number cannot be parsed.
 */
export function normalizePkPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).replace(/[\s\-()]/g, "");
  if (/^\+92\d{10}$/.test(raw)) return raw;
  if (/^92\d{10}$/.test(raw)) return "+" + raw;
  if (/^03\d{9}$/.test(raw)) return "+92" + raw.slice(1);
  if (/^\+\d{8,15}$/.test(raw)) return raw;
  return null;
}

export function isValidPkPhone(input: string | null | undefined): boolean {
  return normalizePkPhone(input) !== null;
}

export function maskPhone(input: string | null | undefined): string {
  const p = String(input ?? "");
  if (!p) return "";
  if (p.length <= 6) return "***";
  return p.slice(0, 5) + "****" + p.slice(-2);
}

/** Substitute {{var}} tokens in a template. */
export function renderTemplate(body: string, vars: Record<string, unknown>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}