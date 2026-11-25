/**
 * Probability the stage editor can save.
 *
 * Demo S3 Technical Iteration is 60 and Closed Won is 100. Clearing the field
 * used to become 0, and 150 used to clamp to 100. Neither number was typed.
 * An empty field is not zero. A value outside 0–100 is not saved.
 */
export type StageProbabilityDraft =
  | { ok: true; probability: number; changed: boolean }
  | { ok: false; reason: 'empty' | 'invalid' };

const WHOLE_OR_TWO_DECIMALS = /^(?:\d{1,3})(?:\.\d{1,2})?$/;

export function stageProbabilityDraft(raw: string, saved: number): StageProbabilityDraft {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (!WHOLE_OR_TWO_DECIMALS.test(trimmed)) return { ok: false, reason: 'invalid' };
  const probability = Number(trimmed);
  if (!Number.isFinite(probability) || probability > 100) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, probability, changed: probability !== saved };
}
