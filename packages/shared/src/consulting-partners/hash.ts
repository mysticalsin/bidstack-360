/** Stable short key for a URL or text (two FNV-1a 32 bit passes). Not a security hash. */
export function createHashKey(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}
