// The proposer's write path, tested without a database.
//
// Two laws carry most of the weight here and each has its own describe block:
// a quote that cannot be re-found in the chunk is REJECTED (not scored lower),
// and a value a human dismissed is never offered again. The rest are the gate
// laws ported from the CRM's recordFact, restated as tests so a future edit
// has to argue with a failure.

import { describe, expect, it } from 'vitest';

import type { Observation } from './evidence.js';
import {
  GAP_ISSUE_CATEGORY,
  MIN_QUOTE_CHARS,
  PROPOSER_AGENT_KEY,
  citeSource,
  dedupeObservations,
  flagComplianceGap,
  normalizeClaim,
  proposeAnswer,
  valueHashFor,
  type BidFactCitationCreateData,
  type BidFactCreateData,
  type ExistingFact,
  type FactsClient,
} from './facts.js';
import type { RetrievedChunk } from './retrieval.js';

const ORG = '11111111-1111-1111-1111-111111111111';

const CHUNK: RetrievedChunk = {
  id: 'chunk-5',
  chunkIndex: 5,
  pageStart: 12,
  pageEnd: 12,
  sectionPath: '§4.2 Data Protection',
  text: 'The Supplier shall process all personal data within the EU/EEA at all times, and shall not transfer it to a third country without prior written consent.',
};

interface Recorder {
  db: FactsClient;
  facts: BidFactCreateData[];
  citations: BidFactCitationCreateData[];
  issues: { requirementId: string; category: string; severity: string; title: string }[];
}

function makeClient(seed: { existing?: ExistingFact[]; openGapIssue?: string } = {}): Recorder {
  const facts: BidFactCreateData[] = [];
  const citations: BidFactCitationCreateData[] = [];
  const issues: Recorder['issues'] = [];
  let nextId = 0;

  const db = {
    bidFact: {
      async findMany() {
        return seed.existing ?? [];
      },
      async create({ data }: { data: BidFactCreateData }) {
        facts.push(data);
        nextId += 1;
        return { id: `fact-${nextId}` };
      },
    },
    bidFactCitation: {
      async createMany({ data }: { data: BidFactCitationCreateData[] }) {
        citations.push(...data);
        return { count: data.length };
      },
    },
    reviewIssue: {
      async findFirst() {
        return seed.openGapIssue ? { id: seed.openGapIssue } : null;
      },
      async create({
        data,
      }: {
        data: { requirementId: string; category: string; severity: string; title: string };
      }) {
        issues.push(data);
        return { id: `issue-${issues.length}` };
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
  } as unknown as FactsClient;

  return { db, facts, citations, issues };
}

function obs(kind: Observation['kind'], sourceChunkId?: string): Observation {
  return sourceChunkId
    ? { kind, detail: `observed ${kind}`, sourceChunkId }
    : { kind, detail: `observed ${kind}` };
}

function proposeInput(overrides: Partial<Parameters<typeof proposeAnswer>[1]> = {}) {
  return {
    orgId: ORG,
    opportunityId: 'opp-1',
    subjectType: 'matrix_row' as const,
    subjectId: 'row-1',
    claim: 'Yes. All personal data is processed within the EU/EEA.',
    verdict: 'YES',
    evidence: [obs('rfp.stated-in-document', CHUNK.id)],
    citationCandidates: [
      { sourceChunkId: CHUNK.id, quote: 'process all personal data within the EU/EEA' },
    ],
    chunksById: new Map([[CHUNK.id, CHUNK]]),
    assessmentStatus: 'ASSESSED' as const,
    humanAuthored: false,
    ...overrides,
  };
}

// ─── citeSource ─────────────────────────────────────────────────────────────

describe('citeSource — a quote is re-found in code or it does not exist', () => {
  it('accepts a verbatim quote and carries the chunk’s page range', () => {
    const result = citeSource('process all personal data within the EU/EEA', CHUNK);
    expect(result).toEqual({
      ok: true,
      citation: {
        sourceChunkId: 'chunk-5',
        pageStart: 12,
        pageEnd: 12,
        quote: 'process all personal data within the EU/EEA',
      },
    });
  });

  it('tolerates only the differences a PDF extractor makes — whitespace, smart quotes, dashes', () => {
    const smart = citeSource('process all personal   data\nwithin the EU/EEA', CHUNK);
    expect(smart.ok).toBe(true);

    const dashed: RetrievedChunk = { ...CHUNK, text: 'a well—known third‐country rule' };
    expect(citeSource('well-known third-country rule', dashed).ok).toBe(true);
  });

  it('REJECTS a fabricated quote — it is not merely scored lower', () => {
    const result = citeSource('The Supplier guarantees 99.99% uptime in all regions', CHUNK);
    expect(result).toEqual({ ok: false, reason: 'not-found-in-chunk' });
  });

  it('rejects a quote too short to mean anything', () => {
    expect('a'.repeat(MIN_QUOTE_CHARS - 1).length).toBeLessThan(MIN_QUOTE_CHARS);
    expect(citeSource('the', CHUNK)).toEqual({ ok: false, reason: 'quote-too-short' });
    expect(citeSource('   ', CHUNK)).toEqual({ ok: false, reason: 'empty-quote' });
  });
});

// ─── valueHash ──────────────────────────────────────────────────────────────

describe('valueHash — normalized SHA-256 (ADR-0004 Decision 3)', () => {
  it('is a 64-char lowercase hex digest', () => {
    expect(valueHashFor('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('collapses casing, NFKC forms, smart quotes, newline runs and non-breaking spaces', () => {
    const canonical = 'We process data in the EU.';
    for (const variant of [
      'we process data in the eu.',
      'We  process\ndata   in the EU.',
      'We process data in the EU.', // non-breaking spaces, as a PDF emits them
      'We process data in the ＥＵ.', // fullwidth EU — NFKC folds it
      'We “process” data in the EU!',
    ]) {
      expect(valueHashFor(variant)).toBe(valueHashFor(canonical));
    }
  });

  it('makes EU/EEA and EU EEA the same claim — punctuation becomes a space, not nothing', () => {
    expect(normalizeClaim('EU/EEA')).toBe('eu eea');
    expect(valueHashFor('EU/EEA')).toBe(valueHashFor('EU EEA'));
    // …and does not silently weld a hyphenated word together.
    expect(normalizeClaim('co-operate')).toBe('co operate');
    expect(valueHashFor('co-operate')).not.toBe(valueHashFor('cooperate'));
  });

  it('pins the known hole: a reworded dismissal IS offered again', () => {
    // ADR-0004 accepts this for Round 2. Semantic dedupe is a retrieval
    // problem, not a hashing one. Pinned so it stays a decision, not a shock.
    expect(valueHashFor('We process data in the EU.')).not.toBe(
      valueHashFor('Data is processed inside the European Union.'),
    );
  });
});

// ─── proposeAnswer ──────────────────────────────────────────────────────────

describe('proposeAnswer — everything lands PROPOSED', () => {
  it('writes one BidFact plus its re-verified citation and nothing else', async () => {
    const rec = makeClient();

    const result = await proposeAnswer(rec.db, proposeInput());

    expect(result.stored).toBe(true);
    expect(result.band).toBe('VERIFIED');
    expect(result.citationsStored).toBe(1);
    expect(rec.facts).toHaveLength(1);
    expect(rec.facts[0]).toMatchObject({
      status: 'PROPOSED',
      verdict: 'YES',
      band: 'VERIFIED',
      confidenceBps: 9500,
      assessmentStatus: 'ASSESSED',
      producedByAgentKey: PROPOSER_AGENT_KEY,
      orgId: ORG,
    });
    // ADR-0003 Decision 3: a VERIFIED band still does not auto-apply.
    expect(rec.facts[0]?.status).not.toBe('APPLIED');
    expect(rec.citations[0]).toMatchObject({
      sourceChunkId: 'chunk-5',
      pageStart: 12,
      pageEnd: 12,
      orgId: ORG,
    });
  });

  it('rejects a fabricated quote AND drops the observation it was standing on', async () => {
    const rec = makeClient();

    const result = await proposeAnswer(
      rec.db,
      proposeInput({
        citationCandidates: [
          { sourceChunkId: CHUNK.id, quote: 'The Supplier guarantees 99.99% uptime' },
        ],
      }),
    );

    // Without a verified quote there is no rfp.stated-in-document left to
    // price, so the claim falls below the floor and no fact is written at all.
    expect(result.rejectedCitations).toEqual([
      { sourceChunkId: 'chunk-5', reason: 'not-found-in-chunk' },
    ]);
    expect(result.stored).toBe(false);
    expect(result.refusal).toBe('below-floor');
    expect(rec.facts).toEqual([]);
    expect(rec.citations).toEqual([]);
    // The caller must be able to see what actually survived, so a follow-up
    // gap cannot resurrect the rejected observation.
    expect(result.verifiedEvidence).toEqual([]);
  });

  it('rejects a citation naming a chunk this run never retrieved', async () => {
    const rec = makeClient();

    const result = await proposeAnswer(
      rec.db,
      proposeInput({
        chunksById: new Map(),
        evidence: [obs('library.delivered-project')],
      }),
    );

    expect(result.rejectedCitations).toEqual([
      { sourceChunkId: 'chunk-5', reason: 'chunk-not-retrieved' },
    ]);
    expect(result.citationsStored).toBe(0);
    // The un-anchored observation still scores; it just cites nothing.
    expect(result.stored).toBe(true);
    expect(rec.citations).toEqual([]);
  });

  it('refuses an empty claim', async () => {
    const rec = makeClient();
    const result = await proposeAnswer(rec.db, proposeInput({ claim: '   ' }));
    expect(result.refusal).toBe('empty-claim');
    expect(rec.facts).toEqual([]);
  });

  it('refuses below the floor rather than storing a weak claim', async () => {
    const rec = makeClient();
    const result = await proposeAnswer(
      rec.db,
      proposeInput({ evidence: [obs('similar-requirement-only')], citationCandidates: [] }),
    );
    expect(result.band).toBeNull();
    expect(result.refusal).toBe('below-floor');
    expect(result.reason).toMatch(/below the floor/i);
    expect(rec.facts).toEqual([]);
  });

  it('never re-offers a value a human dismissed', async () => {
    const claim = 'Yes. All personal data is processed within the EU/EEA.';
    const rec = makeClient({
      existing: [{ id: 'old', status: 'DISMISSED', valueHash: valueHashFor(claim) }],
    });

    // Reformatted, but the same claim after normalization.
    const result = await proposeAnswer(
      rec.db,
      proposeInput({ claim: 'YES.  All personal data is processed within the EU / EEA!' }),
    );

    expect(result.refusal).toBe('dismissed-value');
    expect(rec.facts).toEqual([]);
  });

  it('no-ops when the identical value is already applied', async () => {
    const claim = 'Yes. All personal data is processed within the EU/EEA.';
    const rec = makeClient({
      existing: [{ id: 'old', status: 'APPLIED', valueHash: valueHashFor(claim) }],
    });

    const result = await proposeAnswer(rec.db, proposeInput({ claim }));

    expect(result.refusal).toBe('already-applied');
    expect(rec.facts).toEqual([]);
  });

  it('refuses when a person already answered the row and no agent fact underlies it', async () => {
    const rec = makeClient();
    const result = await proposeAnswer(rec.db, proposeInput({ humanAuthored: true }));
    expect(result.refusal).toBe('human-owns');
    expect(result.reason).toMatch(/outranks/i);
    expect(rec.facts).toEqual([]);
  });

  it('may propose again over a row an earlier agent fact filled', async () => {
    const rec = makeClient({
      existing: [{ id: 'old', status: 'APPLIED', valueHash: valueHashFor('something else') }],
    });
    const result = await proposeAnswer(rec.db, proposeInput({ humanAuthored: true }));
    expect(result.stored).toBe(true);
  });
});

describe('dedupeObservations — one entry per independent source', () => {
  it('collapses the same kind on the same chunk, keeps genuinely separate sources', () => {
    const kept = dedupeObservations([
      obs('rfp.stated-in-document', 'chunk-5'),
      obs('rfp.stated-in-document', 'chunk-5'),
      obs('rfp.stated-in-document', 'chunk-6'),
      { kind: 'web.cited-claim', detail: 'a', sourceUrl: 'https://x.test/a' },
      { kind: 'web.cited-claim', detail: 'b', sourceUrl: 'https://x.test/a' },
    ]);
    expect(kept).toHaveLength(3);
  });
});

// ─── flagComplianceGap ──────────────────────────────────────────────────────

describe('flagComplianceGap — "we cannot comply" is a first-class outcome', () => {
  const gapInput = {
    orgId: ORG,
    opportunityId: 'opp-1',
    requirementId: 'req-1',
    subjectType: 'matrix_row' as const,
    subjectId: 'row-1',
    gap: 'Nothing on file evidences EU-only processing for this scope.',
    requirementText: 'All personal data shall be processed within the EU.',
    evidence: [] as Observation[],
    sourceChunkId: 'chunk-5',
    assessmentStatus: 'ASSESSED' as const,
  };

  it('opens a high-severity ReviewIssue and a GAP fact with no invented score', async () => {
    const rec = makeClient();

    const result = await flagComplianceGap(rec.db, gapInput);

    expect(result.issueCreated).toBe(true);
    expect(result.reviewIssueId).toBe('issue-1');
    expect(rec.issues[0]).toMatchObject({
      requirementId: 'req-1',
      category: GAP_ISSUE_CATEGORY,
      severity: 'high',
    });
    expect(rec.facts[0]).toMatchObject({ verdict: 'GAP', status: 'PROPOSED' });
    // No evidence means no score exists. 0 would read as "0% compliant".
    expect(rec.facts[0]?.confidenceBps).toBeNull();
    expect(rec.facts[0]?.band).toBeNull();
  });

  it('is idempotent across BullMQ retries — one open gap issue per requirement', async () => {
    const rec = makeClient({ openGapIssue: 'issue-existing' });

    const result = await flagComplianceGap(rec.db, gapInput);

    expect(result.issueCreated).toBe(false);
    expect(result.reviewIssueId).toBe('issue-existing');
    expect(rec.issues).toEqual([]);
  });

  it('does not raise a gap a human already dismissed', async () => {
    const rec = makeClient({
      existing: [{ id: 'old', status: 'DISMISSED', valueHash: valueHashFor(gapInput.gap) }],
    });

    const result = await flagComplianceGap(rec.db, gapInput);

    expect(result.refusal).toBe('dismissed-value');
    expect(rec.facts).toEqual([]);
    expect(rec.issues).toEqual([]);
  });

  it('refuses an empty gap description before touching the database', async () => {
    const rec = makeClient();
    const result = await flagComplianceGap(rec.db, { ...gapInput, gap: '  ' });
    expect(result.refusal).toBe('empty-claim');
    expect(rec.facts).toEqual([]);
  });
});
