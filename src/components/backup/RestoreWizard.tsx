import { useReducer, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { reduceWizard, initialWizard, canProceed, type WizardState } from "@/lib/backupWizard";
import { formatSize } from "@/lib/backupSchedule";

type Backup = {
  id: string; backup_name: string | null; created_at: string; file_size: number | null;
  backup_type: string; status: string; checksum_sha256: string | null; schema_version: string | null;
  table_counts: Record<string, number> | null;
};

export function RestoreWizard({
  open, onOpenChange, backups, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  backups: Backup[];
  onDone: () => void;
}) {
  const [state, dispatch] = useReducer(reduceWizard, initialWizard);

  useEffect(() => { if (!open) dispatch({ type: "reset" }); }, [open]);

  const selected = backups.find((b) => b.id === state.backupId) ?? null;

  const runValidate = async () => {
    if (!state.backupId) return;
    dispatch({ type: "validate.start" });
    const { data, error } = await supabase.functions.invoke("system-backup", {
      body: { action: "verify", backup_id: state.backupId },
    });
    if (error) {
      dispatch({ type: "validate.done", validation: { ok: false, error: error.message } });
      return;
    }
    dispatch({
      type: "validate.done",
      validation: {
        ok: !!data?.ok,
        error: data?.error,
        counts: data?.counts ?? selected?.table_counts ?? {},
        schema_version: data?.schema_version,
        checksum: data?.checksum,
      },
    });
  };

  const runRestore = async () => {
    if (!state.backupId) return;
    dispatch({ type: "restore.start" });
    const { data, error } = await supabase.functions.invoke("system-backup", {
      body: { action: "restore", backup_id: state.backupId },
    });
    if (error) {
      dispatch({ type: "restore.done", result: { ok: false, error: error.message } });
      return;
    }
    dispatch({
      type: "restore.done",
      result: {
        ok: !!data?.ok,
        rolled_back: !!data?.rolled_back,
        total_restored: data?.total_restored,
        error: data?.error ?? (data?.table_errors?.length ? `${data.table_errors.length} table error(s)` : undefined),
      },
    });
    onDone();
  };

  const stepIdx = ["select","validate","preview","warning","confirm","progress","finish"].indexOf(state.step);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Restore Backup — Step {stepIdx + 1} of 7</DialogTitle>
        </DialogHeader>

        {state.step === "select" && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            <p className="text-sm text-muted-foreground">Select the backup you want to restore. A pre-restore snapshot will be taken automatically.</p>
            {backups.length === 0 && <p className="text-sm">No backups available.</p>}
            {backups.map((b) => (
              <label key={b.id} className={`flex items-center justify-between rounded border p-2 cursor-pointer ${state.backupId === b.id ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" checked={state.backupId === b.id} onChange={() => dispatch({ type: "select", id: b.id })} />
                  <div>
                    <div className="text-sm font-medium">{b.backup_name ?? b.id.slice(0,8)}</div>
                    <div className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString()} · {b.backup_type} · {formatSize(b.file_size)}</div>
                  </div>
                </div>
                <Badge variant={b.status === "success" ? "secondary" : "outline"}>{b.status}</Badge>
              </label>
            ))}
          </div>
        )}

        {state.step === "validate" && (
          <div className="flex items-center gap-2 p-6 justify-center text-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> Validating backup integrity…
          </div>
        )}

        {state.step === "preview" && state.validation && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-green-600" /> Integrity verified · checksum {state.validation.checksum?.slice(0,12)}… · schema {state.validation.schema_version ?? "—"}</div>
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Contents</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs max-h-64 overflow-y-auto">
                {Object.entries(state.validation.counts ?? {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between rounded bg-muted px-2 py-1"><span>{k}</span><span className="font-mono">{v}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}

        {state.step === "warning" && (
          <div className="rounded border border-destructive/50 bg-destructive/5 p-4 text-sm space-y-2">
            <div className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Destructive action</div>
            <p>Restoring will overwrite all matching records in this account. A pre-restore backup is taken automatically, and any failure will roll back to it.</p>
            <p className="text-xs text-muted-foreground">Super Admin accounts are always preserved.</p>
          </div>
        )}

        {state.step === "confirm" && (
          <div className="space-y-3">
            <p className="text-sm">Type <span className="font-mono font-bold">RESTORE</span> to confirm this action.</p>
            <Input value={state.confirmText} onChange={(e) => dispatch({ type: "setConfirm", text: e.target.value })} placeholder="RESTORE" />
          </div>
        )}

        {state.step === "progress" && (
          <div className="flex items-center gap-2 p-6 justify-center text-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> Restoring backup — do not close this window…
          </div>
        )}

        {state.step === "finish" && state.result && (
          <div className="p-4 text-sm space-y-2">
            {state.result.ok ? (
              <div className="flex items-center gap-2 text-green-700"><CheckCircle2 className="h-5 w-5" /> Restore complete — {state.result.total_restored ?? 0} records restored.</div>
            ) : state.result.rolled_back ? (
              <div className="flex items-center gap-2 text-yellow-700"><AlertTriangle className="h-5 w-5" /> Restore failed and was rolled back automatically.</div>
            ) : (
              <div className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" /> Restore failed: {state.result.error}</div>
            )}
            {state.result.error && <div className="text-xs text-muted-foreground break-all">{state.result.error}</div>}
          </div>
        )}

        <DialogFooter className="gap-2">
          {state.step !== "progress" && state.step !== "finish" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              {state.step === "select" && (
                <Button disabled={!canProceed(state)} onClick={runValidate}>Validate</Button>
              )}
              {state.step === "preview" && (
                <Button onClick={() => dispatch({ type: "next" })}>Continue</Button>
              )}
              {state.step === "warning" && (
                <Button variant="destructive" onClick={() => dispatch({ type: "next" })}>I understand</Button>
              )}
              {state.step === "confirm" && (
                <Button variant="destructive" disabled={!canProceed(state)} onClick={runRestore}>Restore now</Button>
              )}
            </>
          )}
          {state.step === "finish" && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}