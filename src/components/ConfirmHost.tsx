import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * In-app replacement for window.confirm (which embedded previews silently block).
 * Usage: if (!(await confirmDialog("Delete this?"))) return;
 */
type Req = { message: string; resolve: (ok: boolean) => void };
let push: ((r: Req) => void) | null = null;

export const confirmDialog = (message: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (!push) { resolve(false); return; }
    push({ message, resolve });
  });

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => { push = setReq; return () => { push = null; }; }, []);
  const done = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  const [title, ...rest] = (req?.message ?? "").split("\n");
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) done(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {rest.join("\n").trim() && (
            <AlertDialogDescription className="whitespace-pre-line">{rest.join("\n").trim()}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => done(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => done(true)}
          >Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
