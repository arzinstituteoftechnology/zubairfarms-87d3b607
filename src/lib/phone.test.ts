import { describe, it, expect } from "vitest";
import { normalizePkPhone, isValidPkPhone, maskPhone, renderTemplate } from "./phone";

describe("normalizePkPhone", () => {
  it("normalizes local formats", () => {
    expect(normalizePkPhone("03001234567")).toBe("+923001234567");
    expect(normalizePkPhone("923001234567")).toBe("+923001234567");
    expect(normalizePkPhone("+923001234567")).toBe("+923001234567");
    expect(normalizePkPhone("+92 300 1234567")).toBe("+923001234567");
    expect(normalizePkPhone("+92-300-1234567")).toBe("+923001234567");
  });
  it("passes other E.164", () => {
    expect(normalizePkPhone("+14155551234")).toBe("+14155551234");
  });
  it("rejects invalid", () => {
    expect(normalizePkPhone("")).toBeNull();
    expect(normalizePkPhone(null)).toBeNull();
    expect(normalizePkPhone("12345")).toBeNull();
    expect(normalizePkPhone("abc")).toBeNull();
    expect(normalizePkPhone("0300")).toBeNull();
  });
  it("isValidPkPhone", () => {
    expect(isValidPkPhone("03001234567")).toBe(true);
    expect(isValidPkPhone("0300")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("masks middle digits", () => {
    expect(maskPhone("+923001234567")).toBe("+9230****67");
    expect(maskPhone("")).toBe("");
    expect(maskPhone("12345")).toBe("***");
  });
});

describe("renderTemplate", () => {
  it("replaces variables", () => {
    expect(renderTemplate("Hi {{name}}, Rs {{amount}}", { name: "Ali", amount: 1500 }))
      .toBe("Hi Ali, Rs 1500");
  });
  it("blank for missing", () => {
    expect(renderTemplate("Hi {{name}}!", {})).toBe("Hi !");
  });
});