/**
 * The bid evidence ledger.
 *
 * The arithmetic here is ported verbatim from the CRM's contact-identity
 * scorer (`D:\CRM\apps\agent\agent\lib\evidence.ts`): noisy-OR combination,
 * the 0.99 ceiling, the 0.45 contradiction clamp, and the three band floors.
 * ADR-0004 forbids tuning any of it — the constants are pinned by value in
 * `evidence.test.ts` so a future edit has to argue with a failing test.
 *
 * Only the vocabulary is ours. The CRM prices "is this LinkedIn profile the
 * person behind this email address"; we price "does anything on file actually
 * satisfy this RFP requirement". The nine kinds and their weights are ADR-0004
 * Decision 2, and they are explicit guesses — `BidFactDecision` is the only
 * instrument that may ever re-price them.
 *
 * The law the whole file exists to enforce (ADR-0004 Decision 5): a tool
 * reports what it OBSERVED. It never returns, computes, or implies a
 * confidence. `Observation` has no numeric field for one, and the banned names
 * are typed `never` so smuggling one in does not compile.
 */

export type EvidenceKind =
  | 'rfp.stated-in-document'
  | 'library.delivered-project'
  | 'crm.client-correspondence'
  | 'proposal.prior-submission'
  | 'compliance.certificate-on-file'
  | 'web.cited-claim'
  | 'competitor.insight'
  | 'similar-requirement-only'
  | 'contradiction';

type Weighting = {
  weight: number;
  /** Primary sources can carry a claim alone; VERIFIED requires at least one. */
  primary: boolean;
  /** Clause fragment used to build the rationale a bid manager reads. */
  label: string;
};

/**
 * ADR-0004 Decision 2. These weights are guesses, recorded openly so the first
 * person who wants to move one has to say what data changed their mind.
 */
export const WEIGHTS: Record<EvidenceKind, Weighting> = {
  'rfp.stated-in-document': {
    weight: 0.95,
    primary: true,
    label: 'the RFP itself states it at a citable page',
  },
  'library.delivered-project': {
    weight: 0.85,
    primary: true,
    label: 'a delivered project in our reference library satisfies it',
  },
  'crm.client-correspondence': {
    weight: 0.85,
    primary: true,
    label: 'correspondence with this client on file states it',
  },
  'proposal.prior-submission': {
    weight: 0.8,
    primary: true,
    label: 'we answered this requirement in a prior submitted proposal',
  },
  'compliance.certificate-on-file': {
    weight: 0.8,
    primary: true,
    label: 'a certificate or attestation on file covers it',
  },
  'web.cited-claim': {
    weight: 0.4,
    primary: false,
    label: 'a cited public source states it',
  },
  'competitor.insight': {
    weight: 0.35,
    primary: false,
    label: 'competitor and market intelligence implies it',
  },
  'similar-requirement-only': {
    weight: 0.2,
    primary: false,
    label: 'a similar requirement was answered, but the obligation differs',
  },
  contradiction: {
    weight: 0,
    primary: false,
    label: 'another source disagrees',
  },
};

/**
 * What a tool hands the ledger.
 *
 * `kind` is the observation's price list entry, `detail` is the sentence a bid
 * manager reads in a tooltip ("DPA §3 names AWS eu-west-1", never "match
 * confirmed"). There is deliberately no field for a score.
 *
 * The `never`-typed members below are not documentation: `{ kind, detail,
 * confidence: 0.9 }` is a type error even when it reaches this function
 * through a variable, where an excess-property check would not fire. Removing
 * them requires superseding ADR-0004.
 */
export type Observation = {
  kind: EvidenceKind;
  detail: string;
  sourceUrl?: string;
  /** Set when the observation came from an indexed chunk; used for dedupe upstream. */
  sourceChunkId?: string;
  score?: never;
  confidence?: never;
  confidenceBps?: never;
  weight?: never;
  band?: never;
  certainty?: never;
};

/** Mirrors `BidFact.band` (VarChar(12)): below POSSIBLE the fact is not stored. */
export type EvidenceBand = 'VERIFIED' | 'PROBABLE' | 'POSSIBLE';

export type Scored = {
  score: number;
  band: EvidenceBand | null;
  hasPrimary: boolean;
  rationale: string;
};

/**
 * Nothing is ever certain. `min(0.99, …)` means no stack of evidence reaches
 * 1.0 — deliberate epistemics, not a rounding guard.
 */
export const CEILING = 0.99;

/**
 * Contradiction HOLDS, it never averages. 0.45 sits below PROBABLE's 0.55
 * floor, so an RFP base document disagreeing with its amendment surfaces as a
 * held answer rather than a confident middle number that is wrong under both.
 */
export const CONTRADICTED = 0.45;

export const BAND_FLOOR = { VERIFIED: 0.85, PROBABLE: 0.55, POSSIBLE: 0.3 };

export function scoreEvidence(evidence: Observation[]): Scored {
  if (evidence.length === 0) {
    return {
      score: 0,
      band: null,
      hasPrimary: false,
      rationale: 'No evidence.',
    };
  }

  const contradicted = evidence.some((item) => item.kind === 'contradiction');
  const hasPrimary = evidence.some((item) => WEIGHTS[item.kind].primary);

  // Noisy-OR: independent sources each remove a share of the remaining doubt.
  const combined = evidence.reduce(
    (remaining, item) => remaining * (1 - WEIGHTS[item.kind].weight),
    1,
  );

  let score = Math.min(CEILING, 1 - combined);
  if (contradicted) score = Math.min(score, CONTRADICTED);

  return {
    score,
    band: bandFor(score, hasPrimary),
    hasPrimary,
    rationale: rationaleFor(evidence, contradicted, hasPrimary),
  };
}

/**
 * VERIFIED needs the score AND a primary source. A pile of public pages that
 * arithmetically clears 0.85 is still not somebody's own document saying so.
 */
export function bandFor(score: number, hasPrimary: boolean): EvidenceBand | null {
  if (score >= BAND_FLOOR.VERIFIED && hasPrimary) return 'VERIFIED';
  if (score >= BAND_FLOOR.PROBABLE) return 'PROBABLE';
  if (score >= BAND_FLOOR.POSSIBLE) return 'POSSIBLE';
  return null;
}

/** `BidFact.confidenceBps` is the score in basis points; null there means no score exists. */
export function toConfidenceBps(score: number): number {
  return Math.round(score * 10_000);
}

function rationaleFor(
  evidence: Observation[],
  contradicted: boolean,
  hasPrimary: boolean,
): string {
  const reasons = evidence
    .filter((item) => item.kind !== 'contradiction')
    .map((item) => WEIGHTS[item.kind].label);

  // A held claim explains the clash, not the support: the reader's next action
  // is to resolve the disagreement, not to weigh what agreed.
  if (contradicted) {
    const clash = evidence.find((item) => item.kind === 'contradiction');
    return `Held: ${clash?.detail ?? 'sources disagree'}.`;
  }

  if (reasons.length === 0) return 'No supporting evidence.';

  const list = joinWords(reasons);
  return hasPrimary
    ? capitalise(list)
    : `${capitalise(list)} — but nothing on file states this requirement directly.`;
}

function joinWords(words: string[]): string {
  if (words.length === 1) return words[0] as string;
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
