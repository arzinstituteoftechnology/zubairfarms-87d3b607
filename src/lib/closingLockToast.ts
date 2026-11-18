import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { friendlyDbError } from "@/lib/formValidation";

/**
 * Every module surfaces the database's closing-lock error through toast.error.
 * Rewrite it into one clear message with a button to Closing History, so the
 * lock reads the same everywhere.
 */
const original = toast.error.bind(toast);
const LOCK = /CLOSING_LOCKED:\s*/;

(toast as any).error = (message: any, data?: any) => {
  const text = typeof message === "string" ? message : "";
  if (LOCK.test(text)) {
    return original("Locked by a finalized closing", {
      ...(data ?? {}),
      description: text.replace(LOCK, ""),
      duration: 10000,
      action: { label: "Open Closing History", onClick: () => { window.location.assign("/closing-history"); } },
    });
  }
  const friendly = text ? friendlyDbError(text) : null;
  if (friendly) return original(friendly, data);
  return original(message, data);
};

/**
 * Closing lock rule: a finalized closing locks only STOCK records
 * (purchases, supplies, stock adjustments, POS sales) dated on that closing's own day.
 * Money-only records (expenses, deliveries, recoveries, ledger payments) do not change
 * stock, so they stay allowed — but we always tell the user, so nothing is silent.
 */
export async function noteIfFinalizedDay(date: string | null | undefined) {
  if (!date) return;
  const { data } = await supabase.from("stock_closings").select("meat_type")
    .eq("closing_date", date).eq("status", "finalized" as any).is("reversed_at", null);
  if (!data || data.length === 0) return;
  const meats = Array.from(new Set(data.map((r: any) => r.meat_type))).join(", ");
  toast.info("Saved on a finalized closing day", {
    description: `The ${meats} closing for ${date} is finalized. This record does not change stock, so it is allowed and the closing stays unchanged.`,
    duration: 8000,
    action: { label: "Open Closing History", onClick: () => { window.location.assign("/closing-history"); } },
  });
}
