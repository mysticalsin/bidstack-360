import type { PsReviewFlag, PsReviewFlagKind } from './types.js';

/**
 * Copy for neutral review flags. A flag asks a human to look; it never
 * asserts wrongdoing (spec section 5 copy rules).
 */
export const REVIEW_FLAG_COPY: Record<PsReviewFlagKind, { label: string; description: string }> = {
  direct_award: {
    label: 'Needs review: direct award',
    description:
      'Awarded without an open tender. Read the published justification before drawing conclusions.',
  },
  single_bidder: {
    label: 'Single bidder',
    description: 'Only one offer was received. Market size or scope can explain this.',
  },
};

/** Words review copy must never contain, in English and Spanish. */
export const BANNED_ACCUSATION_WORDS: readonly string[] = [
  'suspicious',
  'suspect',
  'irregular',
  'fraud',
  'corrupt',
  'illegal',
  'collusion',
  'rigged',
  'sospechoso',
  'sospechosa',
  'fraude',
  'corrupción',
  'ilegal',
  'colusión',
  'amañado',
];

/** Build an open review flag with the pinned neutral copy. */
export function createReviewFlag(
  kind: PsReviewFlagKind,
  target: { kind: PsReviewFlag['targetKind']; externalId: string; sourceKey: string },
): PsReviewFlag {
  const copy = REVIEW_FLAG_COPY[kind];
  return {
    kind,
    targetKind: target.kind,
    targetExternalId: target.externalId,
    sourceKey: target.sourceKey,
    label: copy.label,
    description: copy.description,
    status: 'open',
  };
}
