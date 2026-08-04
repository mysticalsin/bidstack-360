/**
 * The proposer's only write path.
 *
 * ADR-0003 Decision 3: every agent output lands `PROPOSED`, including a
 * VERIFIED-band one. Nothing in this file writes `ComplianceMatrixRow`
 * `answerDraft` / `responseStatus` / `confidenceBps`. Promotion happens through
 * the two human doors in ADR-0003 Decision 4.
 *
 * The gate laws are ported from the CRM's `recordFact`
 * (`D:\CRM\apps\agent\agent\lib\facts.ts:41-135`), one for one:
 *
 *   empty value                    → refuse                    (:52-54)
 *   band === null                  → refuse, below the floor   (:56-66)
 *   value a human DISMISSED        → never offer again         (:96-109)
 *   identical value already APPLIED→ no-op                     (:111-122)
 *   a human filled the field       → refuse, a person outranks (:126-135)
 *
 * Two deliberate divergences from the source, both stated in ADR-0003/0004:
 *   1. `applies = band === VERIFIED` (:137) is NOT ported. Nothing auto-applies.
 *   2. Dedupe compares a normalized SHA-256, not `sameValue`, because a
 *      compliance answer is a paragraph and a paragraph comparison in a WHERE
 *      clause is an index nobody maintains (ADR-0004 Decision 3).
 *
 * Every function takes its client as an argument; the file holds no module
 * state and unit-tests against a fake with no database.
 */

import { createHash } from 'node:crypto';

import { scoreEvidence, toConfidenceBps, type EvidenceBand, type Observation } from './evidence.js';
import type { RetrievedChunk } from './retrieval.js';

/** Must appear in the org's SERUM `allowedAgentIds` or the run is denied. */
export const PROPOSER_AGENT_KEY = 'rfp-compliance-proposer';

export const GAP_ISSUE_CATEGORY = 'compliance_gap';

/**
 * A quote shorter than this is not evidence, it is a coincidence. "the" appears
 * in every chunk ever written, so a substring check on it verifies nothing.
 */
export const MIN_QUOTE_CHARS = 12;

export type BidFactSubjectType = 'matrix_row' | 'requirement';
export type ProposedAssessmentStatus = 'ASSESSED' | 'UNAVAILABLE';

// ─── Normalization + hashing (ADR-0004 Decision 3) ──────────────────────────

/**
 * NFKC → lowercase → punctuation/symbols to a space → collapse whitespace.
 *
 * Punctuation becomes a space rather than being deleted so that `EU/EEA` and
 * `EU EEA` agree while `co-operate` does not silently become `cooperate`.
 * The locale is pinned to 'en' so the same claim hashes identically on a
 * Turkish-locale host, where a bare toLowerCase() maps I to ı.
 */
export function normalizeClaim(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** `BidFact.valueHash` — computed in code, never in SQL. */
export function valueHashFor(claim: string): string {
  return createHash('sha256').update(normalizeClaim(claim), 'utf8').digest('hex');
}

/**
 * Quote comparison keeps punctuation — a citation's job is to point at words
 * that are actually on the page. Only the differences a PDF extractor
 * introduces are neutralised: unicode forms, smart quotes, dash variants and
 * whitespace runs.
 */
export function normalizeQuoteText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/gu, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/gu, '"')
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

// ─── citeSource ─────────────────────────────────────────────────────────────

export type CiteRejection = 'empty-quote' | 'quote-too-short' | 'not-found-in-chunk';

export interface VerifiedCitation {
  sourceChunkId: string;
  pageStart: number | null;
  pageEnd: number | null;
  quote: string;
}

export type CiteResult =
  | { ok: true; citation: VerifiedCitation }
  | { ok: false; reason: CiteRejection };

/**
 * Re-verify, in code, that the model's quote is actually in the chunk it named.
 *
 * A quote that cannot be re-found is a REJECTION, not a lower score — there is
 * no evidence weight for "probably said this" (ADR-0004 Decision 4). This is
 * the one control standing between a prompt-injected RFP and a cited claim,
 * so it never trusts the model's own assertion that it copied faithfully.
 */
export function citeSource(quote: string, chunk: RetrievedChunk): CiteResult {
  const trimmed = quote.trim();
  if (!trimmed) return { ok: false, reason: 'empty-quote' };
  if (trimmed.length < MIN_QUOTE_CHARS) return { ok: false, reason: 'quote-too-short' };

  const needle = normalizeQuoteText(trimmed);
  const haystack = normalizeQuoteText(chunk.text);
  if (!needle || !haystack.includes(needle)) {
    return { ok: false, reason: 'not-found-in-chunk' };
  }

  return {
    ok: true,
    citation: {
      sourceChunkId: chunk.id,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      quote: trimmed,
    },
  };
}

// ─── Evidence hygiene ───────────────────────────────────────────────────────

/**
 * One entry per INDEPENDENT source. The scorer stacks same-kind observations
 * without deduplicating (three `web.cited-claim` reach 0.784), so splitting one
 * page into two observations would manufacture confidence. ADR-0004 makes this
 * an input contract on `proposeAnswer` rather than a change to the ported
 * arithmetic.
 */
export function dedupeObservations(evidence: Observation[]): Observation[] {
  const seen = new Set<string>();
  const kept: Observation[] = [];
  for (const item of evidence) {
    const key = `${item.kind}::${item.sourceChunkId ?? item.sourceUrl ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

// ─── Client port ────────────────────────────────────────────────────────────

export interface BidFactCreateData {
  orgId: string;
  opportunityId: string | null;
  subjectType: string;
  subjectId: string;
  claim: string;
  verdict: string;
  confidenceBps: number | null;
  band: string | null;
  assessmentStatus: ProposedAssessmentStatus;
  rationale: string | null;
  status: 'PROPOSED';
  valueHash: string;
  producedByAgentKey: string;
  dustRunId: string | null;
}

export interface BidFactCitationCreateData {
  orgId: string;
  bidFactId: string;
  sourceChunkId: string;
  pageStart: number | null;
  pageEnd: number | null;
  quote: string;
}

export interface FactsTx {
  bidFact: {
    create(args: { data: BidFactCreateData; select: { id: true } }): Promise<{ id: string }>;
  };
  bidFactCitation: {
    createMany(args: { data: BidFactCitationCreateData[] }): Promise<{ count: number }>;
  };
  reviewIssue: {
    findFirst(args: {
      where: {
        orgId: string;
        requirementId: string;
        category: string;
        status: 'open';
        deletedAt: null;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        orgId: string;
        opportunityId: string | null;
        requirementId: string;
        sourceChunkId: string | null;
        category: string;
        severity: 'high';
        status: 'open';
        title: string;
        description: string;
        recommendation: string;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
}

export interface ExistingFact {
  id: string;
  status: string;
  valueHash: string;
}

export interface FactsClient extends FactsTx {
  bidFact: FactsTx['bidFact'] & {
    findMany(args: {
      where: { orgId: string; subjectType: string; subjectId: string };
      select: { id: true; status: true; valueHash: true };
    }): Promise<ExistingFact[]>;
  };
  $transaction<T>(fn: (tx: FactsTx) => Promise<T>): Promise<T>;
}

// ─── proposeAnswer ──────────────────────────────────────────────────────────

export type RefusalCode =
  | 'empty-claim'
  | 'below-floor'
  | 'dismissed-value'
  | 'already-applied'
  | 'human-owns';

export interface CitationCandidate {
  sourceChunkId: string;
  quote: string;
}

export interface ProposeAnswerInput {
  orgId: string;
  opportunityId: string | null;
  subjectType: BidFactSubjectType;
  subjectId: string;
  claim: string;
  verdict: string;
  evidence: Observation[];
  citationCandidates: CitationCandidate[];
  /** Chunks that were actually retrieved this run — a citation may name no other. */
  chunksById: Map<string, RetrievedChunk>;
  assessmentStatus: ProposedAssessmentStatus;
  /** True when the subject already carries an answer a person wrote. */
  humanAuthored: boolean;
  dustRunId?: string | null;
}

export interface RejectedCitation {
  sourceChunkId: string;
  reason: CiteRejection | 'chunk-not-retrieved';
}

export interface ProposeAnswerResult {
  stored: boolean;
  factId: string | null;
  score: number;
  band: EvidenceBand | null;
  rationale: string;
  valueHash: string;
  citationsStored: number;
  rejectedCitations: RejectedCitation[];
  /**
   * What actually survived quote re-verification and deduplication — i.e. what
   * was scored. Callers that go on to open a gap must use THIS, not the model's
   * original list, or a rejected observation gets a second life.
   */
  verifiedEvidence: Observation[];
  refusal?: RefusalCode;
  reason?: string;
}

/**
 * Verify every candidate, and drop the observations the rejected ones were
 * standing on.
 *
 * This is stricter than the ADR's letter, which rejects only the citation. If
 * we kept an observation whose quote turned out to be fabricated, a made-up
 * `rfp.stated-in-document` would still price at 0.95 and reach VERIFIED with no
 * citation attached to inspect. An observation anchored to a chunk survives
 * only if at least one quote for that chunk was re-found.
 */
function verifyCitations(input: ProposeAnswerInput): {
  citations: VerifiedCitation[];
  rejected: RejectedCitation[];
  evidence: Observation[];
} {
  const citations: VerifiedCitation[] = [];
  const rejected: RejectedCitation[] = [];
  const verifiedChunkIds = new Set<string>();

  for (const candidate of input.citationCandidates) {
    const chunk = input.chunksById.get(candidate.sourceChunkId);
    if (!chunk) {
      rejected.push({ sourceChunkId: candidate.sourceChunkId, reason: 'chunk-not-retrieved' });
      continue;
    }
    const result = citeSource(candidate.quote, chunk);
    if (!result.ok) {
      rejected.push({ sourceChunkId: candidate.sourceChunkId, reason: result.reason });
      continue;
    }
    if (verifiedChunkIds.has(chunk.id)) continue; // one citation per chunk
    verifiedChunkIds.add(chunk.id);
    citations.push(result.citation);
  }

  // An observation anchored to a chunk keeps its weight only if a quote for
  // that chunk was re-found. Un-quoted and failed-quote anchors both drop:
  // neither is something we checked.
  const evidence = input.evidence.filter(
    (item) => !item.sourceChunkId || verifiedChunkIds.has(item.sourceChunkId),
  );

  return { citations, rejected, evidence };
}

interface ScoredBase {
  score: number;
  band: EvidenceBand | null;
  rationale: string;
  valueHash: string;
  verifiedEvidence: Observation[];
}

function refused(
  refusal: RefusalCode,
  reason: string,
  base: ScoredBase,
  rejected: RejectedCitation[],
): ProposeAnswerResult {
  return {
    ...base,
    stored: false,
    factId: null,
    citationsStored: 0,
    rejectedCitations: rejected,
    refusal,
    reason,
  };
}

/**
 * The only write path. Returns a refusal rather than throwing, because a
 * refusal is a normal outcome of an honest run and the worker must record it,
 * not retry it.
 */
export async function proposeAnswer(
  db: FactsClient,
  input: ProposeAnswerInput,
): Promise<ProposeAnswerResult> {
  const claim = input.claim.trim();
  const valueHash = valueHashFor(claim);
  const { citations, rejected, evidence } = verifyCitations(input);
  const verifiedEvidence = dedupeObservations(evidence);
  const scored = scoreEvidence(verifiedEvidence);
  const base: ScoredBase = {
    score: scored.score,
    band: scored.band,
    rationale: scored.rationale,
    valueHash,
    verifiedEvidence,
  };

  if (!claim) {
    return refused('empty-claim', 'Empty claim.', base, rejected);
  }
  if (scored.band === null) {
    return refused(
      'below-floor',
      'Below the floor for keeping — not stored. Find a source that states this requirement, or leave the row alone.',
      base,
      rejected,
    );
  }

  const existing = await db.bidFact.findMany({
    where: { orgId: input.orgId, subjectType: input.subjectType, subjectId: input.subjectId },
    select: { id: true, status: true, valueHash: true },
  });

  if (existing.some((fact) => fact.status === 'DISMISSED' && fact.valueHash === valueHash)) {
    return refused(
      'dismissed-value',
      'A person has already dismissed this exact answer. Do not offer it again.',
      base,
      rejected,
    );
  }

  const applied = existing.find((fact) => fact.status === 'APPLIED');
  if (applied && applied.valueHash === valueHash) {
    return refused('already-applied', 'Already on the record, unchanged.', base, rejected);
  }
  // A person outranks the web — but only while no accepted agent fact underlies
  // the row, which is what makes a second proposal on an agent-filled row legal.
  if (input.humanAuthored && !applied) {
    return refused(
      'human-owns',
      'A person already answered this row. That outranks anything the agent found.',
      base,
      rejected,
    );
  }

  const factId = await db.$transaction(async (tx) => {
    const fact = await tx.bidFact.create({
      data: {
        orgId: input.orgId,
        opportunityId: input.opportunityId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        claim,
        verdict: input.verdict,
        confidenceBps: toConfidenceBps(scored.score),
        band: scored.band,
        assessmentStatus: input.assessmentStatus,
        rationale: scored.rationale,
        status: 'PROPOSED',
        valueHash,
        producedByAgentKey: PROPOSER_AGENT_KEY,
        dustRunId: input.dustRunId ?? null,
      },
      select: { id: true },
    });

    if (citations.length > 0) {
      await tx.bidFactCitation.createMany({
        data: citations.map((citation) => ({
          orgId: input.orgId,
          bidFactId: fact.id,
          sourceChunkId: citation.sourceChunkId,
          pageStart: citation.pageStart,
          pageEnd: citation.pageEnd,
          quote: citation.quote,
        })),
      });
    }
    return fact.id;
  });

  return {
    ...base,
    stored: true,
    factId,
    citationsStored: citations.length,
    rejectedCitations: rejected,
    reason:
      'Kept as a proposal for a bid manager to accept or dismiss. That is a normal outcome, not a failure — do not go looking for evidence to raise the score.',
  };
}

// ─── flagComplianceGap ──────────────────────────────────────────────────────

export interface FlagComplianceGapInput {
  orgId: string;
  opportunityId: string | null;
  requirementId: string;
  subjectType: BidFactSubjectType;
  subjectId: string;
  /** Rep-readable statement of what we cannot show. Becomes the fact's claim. */
  gap: string;
  requirementText: string;
  /** Whatever WAS observed — usually thin, sometimes empty. */
  evidence: Observation[];
  sourceChunkId: string | null;
  assessmentStatus: ProposedAssessmentStatus;
  dustRunId?: string | null;
}

export interface FlagComplianceGapResult {
  factId: string | null;
  reviewIssueId: string | null;
  /** False when an open gap issue for this requirement already existed. */
  issueCreated: boolean;
  refusal?: RefusalCode;
  reason?: string;
}

/**
 * "We cannot show we comply" as a first-class outcome.
 *
 * The ReviewIssue lands at severity `high`, which the approval gate's
 * in-transaction blocker recount (`rfp-pipeline.ts:465-471`) already counts —
 * so an unanswerable mandatory requirement blocks approval for zero new gate
 * code.
 *
 * WHY this does not route through `proposeAnswer`: a gap is the ABSENCE of
 * evidence, so `band === null` is its normal state and the below-the-floor
 * refusal would swallow exactly the outcome we need surfaced. The dismissal
 * gate still applies — a gap a human has already dismissed stays dismissed.
 */
export async function flagComplianceGap(
  db: FactsClient,
  input: FlagComplianceGapInput,
): Promise<FlagComplianceGapResult> {
  const gap = input.gap.trim();
  if (!gap) {
    return {
      factId: null,
      reviewIssueId: null,
      issueCreated: false,
      refusal: 'empty-claim',
      reason: 'Empty gap description.',
    };
  }

  const valueHash = valueHashFor(gap);
  const existing = await db.bidFact.findMany({
    where: { orgId: input.orgId, subjectType: input.subjectType, subjectId: input.subjectId },
    select: { id: true, status: true, valueHash: true },
  });
  if (existing.some((fact) => fact.status === 'DISMISSED' && fact.valueHash === valueHash)) {
    return {
      factId: null,
      reviewIssueId: null,
      issueCreated: false,
      refusal: 'dismissed-value',
      reason: 'A person has already dismissed this gap. Do not raise it again.',
    };
  }

  const scored = scoreEvidence(dedupeObservations(input.evidence));

  return db.$transaction(async (tx) => {
    const fact = await tx.bidFact.create({
      data: {
        orgId: input.orgId,
        opportunityId: input.opportunityId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        claim: gap,
        verdict: 'GAP',
        // No band means no score exists. Writing 0 here would render as "we are
        // 0% compliant" instead of "nothing on file answers this".
        confidenceBps: scored.band === null ? null : toConfidenceBps(scored.score),
        band: scored.band,
        assessmentStatus: input.assessmentStatus,
        rationale: scored.rationale,
        status: 'PROPOSED',
        valueHash,
        producedByAgentKey: PROPOSER_AGENT_KEY,
        dustRunId: input.dustRunId ?? null,
      },
      select: { id: true },
    });

    // Idempotent across BullMQ retries: one open gap issue per requirement.
    const open = await tx.reviewIssue.findFirst({
      where: {
        orgId: input.orgId,
        requirementId: input.requirementId,
        category: GAP_ISSUE_CATEGORY,
        status: 'open',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (open) {
      return { factId: fact.id, reviewIssueId: open.id, issueCreated: false };
    }

    const issue = await tx.reviewIssue.create({
      data: {
        orgId: input.orgId,
        opportunityId: input.opportunityId,
        requirementId: input.requirementId,
        sourceChunkId: input.sourceChunkId,
        category: GAP_ISSUE_CATEGORY,
        severity: 'high',
        status: 'open',
        title: 'Mandatory requirement has no supporting source',
        description: `${gap}\n\nRequirement: ${input.requirementText.slice(0, 800)}`,
        recommendation:
          'Assign an owner to source an answer, or record a deliberate non-compliance before submission.',
      },
      select: { id: true },
    });

    return { factId: fact.id, reviewIssueId: issue.id, issueCreated: true };
  });
}
