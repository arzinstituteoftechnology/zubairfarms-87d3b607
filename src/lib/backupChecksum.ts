/** SHA-256 hex over an ArrayBuffer using WebCrypto. */
export async function sha256Hex(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const src: ArrayBuffer = buf instanceof Uint8Array
    ? (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    : buf;
  const digest = await crypto.subtle.digest("SHA-256", src);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Return true when the computed checksum matches the expected value. */
export async function verifyChecksum(buf: ArrayBuffer | Uint8Array, expected: string | null | undefined): Promise<boolean> {
  if (!expected) return true; // legacy backups without checksum
  const actual = await sha256Hex(buf);
  return actual.toLowerCase() === expected.toLowerCase();
}