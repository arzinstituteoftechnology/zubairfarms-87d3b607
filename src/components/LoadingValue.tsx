import type { ReactNode } from "react";

/** Shows a grey pulsing placeholder instead of a value (e.g. 0.00) until real data has loaded. */
export function LoadingValue({ loading, children, className = "h-6 w-24" }: { loading: boolean; children: ReactNode; className?: string }) {
  if (loading) return <span className={`inline-block align-middle rounded bg-muted animate-pulse ${className}`} aria-label="Loading" />;
  return <>{children}</>;
}
