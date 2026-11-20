import { INITIATIVE_EVIDENCE_DRAWN, initiativeEvidencePage } from '@bidstack/shared';

export { INITIATIVE_EVIDENCE_DRAWN, initiativeEvidencePage };

/**
 * Evidence the card draws. The loader drops the probe and sets
 * `evidenceContinues`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownInitiativeEvidence<T>(
  items: readonly T[],
  evidenceContinues: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > INITIATIVE_EVIDENCE_DRAWN) return initiativeEvidencePage(items);
  return { items: [...items], pageContinues: Boolean(evidenceContinues) };
}

/**
 * Evidence control on an initiative card. A longer loaded list is the latest
 * evidence, not every evidence item. A shorter list keeps "See N evidence
 * items" and "Hide evidence". No evidence total is invented.
 */
export function initiativeEvidenceLabel(count: number, pageContinues: boolean, open: boolean): string {
  if (pageContinues) {
    const page = `${count} in the latest ${count}, not every evidence item`;
    return open ? `Hide evidence (${page})` : page;
  }
  if (open) return 'Hide evidence';
  return `See ${count} evidence ${count === 1 ? 'item' : 'items'}`;
}
