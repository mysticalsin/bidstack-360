import { formatRut, rutCheckDigit } from './rut.js';

/**
 * Seeded synthetic Chile RUTs for fixtures.
 *
 * Bodies are checksum-valid and reserved for this repo:
 * natural-person indexes sit in the scrubber's fake window (1_000_100+),
 * institutions at 61_000_100+, companies at 99_000_100+.
 * Index 0 is stable for `bidstack-synthetic-v1`.
 */
export const SYNTHETIC_RUT_SEED = 'bidstack-synthetic-v1';

export type SyntheticRutKind = 'person' | 'company' | 'institution';

const BASE: Record<SyntheticRutKind, number> = {
  person: 1_000_100,
  institution: 61_000_100,
  company: 99_000_100,
};

/** Body for a seeded index. Throws if the index leaves the reserved window. */
export function syntheticRutBody(index: number, kind: SyntheticRutKind): number {
  if (!Number.isInteger(index) || index < 0 || index > 899) {
    throw new Error(`synthetic RUT index out of range: ${index}`);
  }
  const base = BASE[kind];
  if (base === undefined) throw new Error(`unknown synthetic RUT kind: ${kind}`);
  return base + index;
}

export interface SyntheticRut {
  body: number;
  dv: string;
  /** `12.345.678-5` form. */
  formatted: string;
  /** `123456785` form. */
  plain: string;
  /** `12345678-5` form. */
  dashed: string;
}

/** Checksum-valid synthetic RUT in dotted, dashed and plain forms. */
export function syntheticRut(index: number, kind: SyntheticRutKind): SyntheticRut {
  const body = syntheticRutBody(index, kind);
  const dv = rutCheckDigit(body);
  return {
    body,
    dv,
    formatted: formatRut(body, dv),
    plain: `${body}${dv}`,
    dashed: `${body}-${dv}`,
  };
}
