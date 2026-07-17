import { describe, it, expect } from "vitest";
import { sha256Hex, verifyChecksum } from "./backupChecksum";

describe("sha256Hex", () => {
  it("hashes empty buffer to known constant", async () => {
    const h = await sha256Hex(new Uint8Array());
    expect(h).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("hashes 'abc' to known constant", async () => {
    const h = await sha256Hex(new TextEncoder().encode("abc"));
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("verifyChecksum", () => {
  it("accepts a matching checksum", async () => {
    const bytes = new TextEncoder().encode("hello");
    const h = await sha256Hex(bytes);
    expect(await verifyChecksum(bytes, h)).toBe(true);
  });
  it("rejects a mismatched checksum", async () => {
    const bytes = new TextEncoder().encode("hello");
    expect(await verifyChecksum(bytes, "0".repeat(64))).toBe(false);
  });
  it("accepts when no expected checksum (legacy backup)", async () => {
    expect(await verifyChecksum(new Uint8Array(), null)).toBe(true);
    expect(await verifyChecksum(new Uint8Array(), undefined)).toBe(true);
  });
  it("is case-insensitive on the hex string", async () => {
    const bytes = new TextEncoder().encode("hello");
    const h = (await sha256Hex(bytes)).toUpperCase();
    expect(await verifyChecksum(bytes, h)).toBe(true);
  });
});