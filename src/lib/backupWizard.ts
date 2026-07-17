export type WizardStep =
  | "select"     // pick backup
  | "validate"   // running verify
  | "preview"    // show contents
  | "warning"    // confirm destructive
  | "confirm"    // final gate — must type RESTORE
  | "progress"   // running restore
  | "finish";    // success or rollback summary

export type WizardState = {
  step: WizardStep;
  backupId: string | null;
  validation: null | { ok: boolean; error?: string; counts?: Record<string, number>; schema_version?: string | null; checksum?: string };
  confirmText: string;
  result: null | { ok: boolean; rolled_back?: boolean; total_restored?: number; error?: string };
};

export const initialWizard: WizardState = {
  step: "select",
  backupId: null,
  validation: null,
  confirmText: "",
  result: null,
};

export type WizardEvent =
  | { type: "select"; id: string }
  | { type: "validate.start" }
  | { type: "validate.done"; validation: WizardState["validation"] }
  | { type: "next" }
  | { type: "back" }
  | { type: "setConfirm"; text: string }
  | { type: "restore.start" }
  | { type: "restore.done"; result: WizardState["result"] }
  | { type: "reset" };

const FLOW: WizardStep[] = ["select","validate","preview","warning","confirm","progress","finish"];

export function reduceWizard(state: WizardState, ev: WizardEvent): WizardState {
  switch (ev.type) {
    case "reset": return { ...initialWizard };
    case "select": return { ...state, backupId: ev.id };
    case "validate.start": return { ...state, step: "validate", validation: null };
    case "validate.done":
      return { ...state, validation: ev.validation, step: ev.validation?.ok ? "preview" : "select" };
    case "setConfirm": return { ...state, confirmText: ev.text };
    case "restore.start": return { ...state, step: "progress", result: null };
    case "restore.done": return { ...state, step: "finish", result: ev.result };
    case "back": {
      const i = FLOW.indexOf(state.step);
      const prev = FLOW[Math.max(0, i - 1)];
      return { ...state, step: prev };
    }
    case "next": {
      // Enforce gates
      if (state.step === "select" && !state.backupId) return state;
      if (state.step === "preview" && !state.validation?.ok) return state;
      if (state.step === "confirm" && state.confirmText.trim().toUpperCase() !== "RESTORE") return state;
      const i = FLOW.indexOf(state.step);
      const next = FLOW[Math.min(FLOW.length - 1, i + 1)];
      return { ...state, step: next };
    }
    default: return state;
  }
}

export function canProceed(state: WizardState): boolean {
  if (state.step === "select") return !!state.backupId;
  if (state.step === "preview") return !!state.validation?.ok;
  if (state.step === "confirm") return state.confirmText.trim().toUpperCase() === "RESTORE";
  if (state.step === "progress") return false;
  return true;
}