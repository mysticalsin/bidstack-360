/** A validated Chile RUT. */
export interface Rut {
  body: number;
  dv: string;
  /** `12.345.678-5` form. */
  formatted: string;
}

/**
 * RUT bodies below this belong to natural persons; companies and public
 * bodies are issued from 50,000,000 up (institutions 60 to 61 million,
 * companies mostly 76 to 99 million).
 */
export const NATURAL_PERSON_RUT_CEILING = 50_000_000;

/** Modulo 11 verifier digit for a RUT body. */
export function rutCheckDigit(body: number): string {
  let sum = 0;
  let factor = 2;
  for (let n = body; n > 0; n = Math.floor(n / 10)) {
    sum += (n % 10) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

/** Format a RUT body and verifier as `12.345.678-5`. */
export function formatRut(body: number, dv: string): string {
  return `${String(body).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv.toUpperCase()}`;
}

/**
 * Parse `12.345.678-5`, `12345678-5` or the OCDS `123456785` form. Returns
 * `null` unless the verifier digit checks out.
 */
export function parseRut(raw: string | null | undefined): Rut | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\./g, '');
  const m = /^(\d{6,8})-?([\dkK])$/.exec(s);
  if (!m) return null;
  const body = Number(m[1]);
  const dv = m[2]!.toUpperCase();
  if (rutCheckDigit(body) !== dv) return null;
  return { body, dv, formatted: formatRut(body, dv) };
}

/** True when the RUT parses and belongs to a natural person. */
export function isNaturalPersonRut(raw: string | null | undefined): boolean {
  const rut = parseRut(raw);
  return rut !== null && rut.body < NATURAL_PERSON_RUT_CEILING;
}
