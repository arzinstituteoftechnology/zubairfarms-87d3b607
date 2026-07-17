import { describe, it, expect } from "vitest";
import { reduceWizard, initialWizard, canProceed } from "./backupWizard";

describe("backupWizard state machine", () => {
  it("cannot leave select without a backup", () => {
    const s1 = reduceWizard(initialWizard, { type: "next" });
    expect(s1.step).toBe("select");
    expect(canProceed(s1)).toBe(false);
  });

  it("select → validate → preview on success", () => {
    let s = reduceWizard(initialWizard, { type: "select", id: "b1" });
    s = reduceWizard(s, { type: "validate.start" });
    expect(s.step).toBe("validate");
    s = reduceWizard(s, { type: "validate.done", validation: { ok: true, counts: { farms: 3 } } });
    expect(s.step).toBe("preview");
    expect(s.validation?.counts?.farms).toBe(3);
  });

  it("validation failure returns to select", () => {
    let s = reduceWizard(initialWizard, { type: "select", id: "b1" });
    s = reduceWizard(s, { type: "validate.done", validation: { ok: false, error: "checksum" } });
    expect(s.step).toBe("select");
  });

  it("cannot skip Warning — full flow requires typing RESTORE", () => {
    let s = reduceWizard(initialWizard, { type: "select", id: "b1" });
    s = reduceWizard(s, { type: "validate.done", validation: { ok: true } }); // preview
    s = reduceWizard(s, { type: "next" }); // warning
    expect(s.step).toBe("warning");
    s = reduceWizard(s, { type: "next" }); // confirm
    expect(s.step).toBe("confirm");
    // Wrong text — cannot proceed
    s = reduceWizard(s, { type: "setConfirm", text: "yes" });
    expect(canProceed(s)).toBe(false);
    const stuck = reduceWizard(s, { type: "next" });
    expect(stuck.step).toBe("confirm");
    // Correct text
    s = reduceWizard(s, { type: "setConfirm", text: "restore" });
    expect(canProceed(s)).toBe(true);
  });

  it("rollback path surfaces on finish", () => {
    const start = { ...initialWizard, step: "progress" as const, backupId: "b1" };
    const s = reduceWizard(start, { type: "restore.done", result: { ok: false, rolled_back: true, error: "boom" } });
    expect(s.step).toBe("finish");
    expect(s.result?.rolled_back).toBe(true);
  });

  it("reset returns to initial state", () => {
    let s = reduceWizard(initialWizard, { type: "select", id: "b1" });
    s = reduceWizard(s, { type: "reset" });
    expect(s).toEqual(initialWizard);
  });
});