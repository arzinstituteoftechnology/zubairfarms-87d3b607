import { toast } from "sonner";

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
  return original(message, data);
};

export {};
