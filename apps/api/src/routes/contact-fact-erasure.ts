/** Tombstone written over a contact fact's personal text. */
export const ERASED_FACT_CLAIM = '[erased]';

/** A fact still exposes the person when its text is live or it is not deleted. */
export function contactFactNeedsScrub(fact: {
  claim: string;
  evidenceDetail: string | null;
  deletedAt: Date | null;
}): boolean {
  return fact.claim !== ERASED_FACT_CLAIM || fact.evidenceDetail !== null || fact.deletedAt === null;
}
