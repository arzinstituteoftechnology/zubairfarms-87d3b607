import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ReverseTarget = {
  label: string;
  amount?: number;
  date?: string;
} | null;

interface Props {
  open: boolean;
  target: ReverseTarget;
  onOpenChange: (o: boolean) => void;
  onConfirm: (reason: string, notes: string) => Promise<void> | void;
}

export function ReverseTransactionDialog({ open, target, onOpenChange, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setReason(""); setNotes(""); setBusy(false); } }, [open]);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try { await onConfirm(reason.trim(), notes.trim()); }
    finally { setBusy(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to reverse this transaction?</AlertDialogTitle>
          <AlertDialogDescription>
            {target?.label ? <span className="font-medium">{target.label}</span> : null}
            {target?.amount !== undefined ? <span> — Amount: <span className="force-ltr">{target.amount}</span></span> : null}
            {target?.date ? <span> — Date: <span className="force-ltr">{target.date}</span></span> : null}
            <br />
            The original record will be preserved; a reversal entry will be posted and balances will recalculate automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 my-2">
          <div>
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount, duplicate entry, customer dispute" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional context" rows={3} />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!reason.trim() || busy} onClick={(e) => { e.preventDefault(); submit(); }}>
            {busy ? "Reversing…" : "Reverse Transaction"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}