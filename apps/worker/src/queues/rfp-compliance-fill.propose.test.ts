// The flag is the rollback lever, so it gets tested from both sides.
//
// OFF (default): the worker must write exactly the ComplianceMatrixRow payload
// it wrote before this change, must never call SERUM, and must never touch the
// BidFact ledger.
// ON: nothing reaches `answerDraft`. SERUM runs first and a denial is a clean
// stop, a requirement with no source chunk is UNAVAILABLE rather than assessed,
// and a surviving answer lands as BidFact(PROPOSED) with a re-verified citation.
//
// No database: `@bidstack/db` is mocked with an in-memory double.

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => {
  // The job schema validates uuids, and so does the citation contract, so the
  // fixtures have to be real uuids rather than readable slugs.
  const ORG = '11111111-1111-1111-1111-111111111111';
  const ROW_ID = '55555555-5555-5555-5555-555555555555';
  const REQ_ID = '77777777-7777-7777-7777-777777777777';
  const OPP_ID = '88888888-8888-8888-8888-888888888888';
  const CHUNK_ID = '66666666-6666-6666-6666-666666666666';

  const state = {
    matrixRow: {
      id: ROW_ID,
      orgId: ORG,
      requirementId: REQ_ID,
      opportunityId: OPP_ID,
      answerDraft: null as string | null,
    },
    requirement: {
      id: REQ_ID,
      orgId: ORG,
      opportunityId: OPP_ID,
      text: 'All personal data shall be processed within the EU.',
      mandatory: true,
      sourceChunkId: CHUNK_ID as string | null,
      documentVersionId: 'ver-1',
    },
    chunk: {
      id: CHUNK_ID,
      orgId: ORG,
      documentVersionId: 'ver-1',
      chunkIndex: 5,
      pageStart: 12,
      pageEnd: 13,
      sectionPath: '§4.2 Data Protection',
      text: 'The Supplier shall process all personal data within the EU/EEA at all times.',
    },
  };
  const updates: unknown[] = [];
  const facts: Record<string, unknown>[] = [];
  const citations: Record<string, unknown>[] = [];
  const issues: Record<string, unknown>[] = [];

  const prisma = {
    complianceMatrixRow: {
      findUnique: vi.fn(async () => ({ id: state.matrixRow.id, orgId: state.matrixRow.orgId })),
      findFirst: vi.fn(async ({ where }: { where: { id: string; orgId: string } }) =>
        where.id === state.matrixRow.id && where.orgId === state.matrixRow.orgId
          ? state.matrixRow
          : null,
      ),
      update: vi.fn(async (args: unknown) => {
        updates.push(args);
        return {};
      }),
    },
    requirement: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; orgId: string } }) =>
        where.id === state.requirement.id && where.orgId === state.requirement.orgId
          ? state.requirement
          : null,
      ),
    },
    sourceChunk: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === state.chunk.id ? state.chunk : null,
      ),
      findMany: vi.fn(async () => []),
    },
    documentVersion: {
      findFirst: vi.fn(async () => ({
        id: 'ver-1',
        versionNo: 2,
        bidDocument: { title: 'Invitation to Tender' },
      })),
    },
    bidFact: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        facts.push(data);
        return { id: `fact-${facts.length}` };
      }),
    },
    bidFactCitation: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        citations.push(...data);
        return { count: data.length };
      }),
    },
    reviewIssue: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        issues.push(data);
        return { id: `issue-${issues.length}` };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return {
    prisma,
    state,
    updates,
    facts,
    citations,
    issues,
    ORG,
    ROW_ID,
    REQ_ID,
    OPP_ID,
    CHUNK_ID,
  };
});

const { ORG, ROW_ID, REQ_ID, CHUNK_ID } = prismaMock;

const serumMock = vi.hoisted(() => ({
  checkSerumAgentRuntimePolicy: vi.fn(async () => ({
    allowed: true,
    status: 'allowed',
    reason: null,
  })),
}));

const llmMock = vi.hoisted(() => ({ runRfpCompletion: vi.fn() }));

vi.mock('@bidstack/db', () => ({ prisma: prismaMock.prisma }));
vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { agents: 'serum.agents' },
  checkSerumAgentRuntimePolicy: serumMock.checkSerumAgentRuntimePolicy,
}));
vi.mock('../lib/dust-credentials.js', () => ({
  getOrgDust: vi.fn(async () => ({ client: {}, creds: {} })),
  resolveAgentId: vi.fn(() => null),
}));
vi.mock('../lib/rfp-llm.js', () => ({ runRfpCompletion: llmMock.runRfpCompletion }));

const { processComplianceFillJobForTest, proposeFactsEnabled } =
  await import('./rfp-compliance-fill.js');

type JobArg = Parameters<typeof processComplianceFillJobForTest>[0];

const log = pino({ enabled: false });

function job(overrides: Record<string, unknown> = {}): JobArg {
  return {
    id: 'job-1',
    data: {
      orgId: ORG,
      orchestrationId: '44444444-4444-4444-4444-444444444444',
      matrixItemId: ROW_ID,
      requirementText: 'All personal data shall be processed within the EU.',
      approvalConfirmed: true,
      ...overrides,
    },
  } as unknown as JobArg;
}

function completion(payload: unknown): { text: string } {
  return { text: JSON.stringify(payload) };
}

beforeEach(() => {
  prismaMock.state.matrixRow.id = ROW_ID;
  prismaMock.state.matrixRow.answerDraft = null;
  prismaMock.state.requirement.sourceChunkId = CHUNK_ID;
  prismaMock.state.requirement.mandatory = true;
  prismaMock.prisma.complianceMatrixRow.findUnique.mockResolvedValue({
    id: ROW_ID,
    orgId: ORG,
  });
  serumMock.checkSerumAgentRuntimePolicy.mockResolvedValue({
    allowed: true,
    status: 'allowed',
    reason: null,
  });
});

afterEach(() => {
  delete process.env.RFP_PROPOSE_FACTS;
  prismaMock.updates.length = 0;
  prismaMock.facts.length = 0;
  prismaMock.citations.length = 0;
  prismaMock.issues.length = 0;
  vi.clearAllMocks();
});

// ─── Flag OFF ───────────────────────────────────────────────────────────────

describe('RFP_PROPOSE_FACTS off — today’s behaviour, unchanged', () => {
  it('defaults to off, and only the exact string "true" arms it', () => {
    expect(proposeFactsEnabled()).toBe(false);
    process.env.RFP_PROPOSE_FACTS = '1';
    expect(proposeFactsEnabled()).toBe(false);
    process.env.RFP_PROPOSE_FACTS = 'true';
    expect(proposeFactsEnabled()).toBe(true);
  });

  it('writes the verdict straight onto the row and never opens the ledger', async () => {
    llmMock.runRfpCompletion.mockResolvedValue(
      completion({ status: 'YES', justification: 'We comply.', confidence: 8000 }),
    );

    await processComplianceFillJobForTest(job(), log);

    expect(prismaMock.updates).toEqual([
      {
        where: { id: ROW_ID },
        data: {
          responseStatus: 'YES',
          answerDraft: 'We comply.',
          confidenceBps: 8000,
          assessmentStatus: 'ASSESSED',
        },
      },
    ]);
    expect(serumMock.checkSerumAgentRuntimePolicy).not.toHaveBeenCalled();
    expect(prismaMock.prisma.bidFact.create).not.toHaveBeenCalled();
  });

  it('still records UNAVAILABLE with a null confidence when the model does not answer', async () => {
    llmMock.runRfpCompletion.mockResolvedValue(null);

    await processComplianceFillJobForTest(job(), log);

    expect(prismaMock.updates).toEqual([
      {
        where: { id: ROW_ID },
        data: { assessmentStatus: 'UNAVAILABLE', confidenceBps: null },
      },
    ]);
  });

  it('keeps the doNotRetry org-verify failure', async () => {
    prismaMock.prisma.complianceMatrixRow.findUnique.mockResolvedValue({
      id: ROW_ID,
      orgId: 'someone-else',
    });

    await expect(processComplianceFillJobForTest(job(), log)).rejects.toMatchObject({
      doNotRetry: true,
    });
  });
});

// ─── Flag ON ────────────────────────────────────────────────────────────────

describe('RFP_PROPOSE_FACTS on — propose, never write', () => {
  beforeEach(() => {
    process.env.RFP_PROPOSE_FACTS = 'true';
  });

  it('runs the SERUM gate before reading anything, and stops clean on a denial', async () => {
    serumMock.checkSerumAgentRuntimePolicy.mockResolvedValue({
      allowed: false,
      status: 'denied',
      reason: 'Human approval confirmation is required before an agent run can start.',
    });

    await processComplianceFillJobForTest(job({ approvalConfirmed: false }), log);

    expect(serumMock.checkSerumAgentRuntimePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'rfp-compliance-proposer', approvalConfirmed: false }),
    );
    // A denial must never fall through to the less-governed direct write.
    expect(prismaMock.prisma.requirement.findFirst).not.toHaveBeenCalled();
    expect(llmMock.runRfpCompletion).not.toHaveBeenCalled();
    expect(prismaMock.updates).toEqual([]);
    expect(prismaMock.facts).toEqual([]);
  });

  it('a requirement with no source chunk is UNAVAILABLE — no model call, no invented citation', async () => {
    prismaMock.state.requirement.sourceChunkId = null;

    await processComplianceFillJobForTest(job(), log);

    expect(llmMock.runRfpCompletion).not.toHaveBeenCalled();
    expect(prismaMock.updates).toEqual([
      {
        where: { id: ROW_ID },
        data: { assessmentStatus: 'UNAVAILABLE', confidenceBps: null },
      },
    ]);
    expect(prismaMock.facts).toEqual([]);
    expect(prismaMock.citations).toEqual([]);
    // Unknown is not bad: an unassessable mandatory row is not a compliance gap.
    expect(prismaMock.issues).toEqual([]);
  });

  it('hands the model the page-ranged source and forbids a confidence', async () => {
    llmMock.runRfpCompletion.mockResolvedValue(
      completion({ status: 'YES', justification: 'We comply.', evidence: [], citations: [] }),
    );

    await processComplianceFillJobForTest(job(), log);

    const message = llmMock.runRfpCompletion.mock.calls[0]?.[0]?.userMessage as string;
    expect(message).toContain('Invitation to Tender (v2)');
    expect(message).toContain('pages 12-13');
    expect(message).toContain(`[ANCHOR id=${CHUNK_ID}]`);
    expect(message).toContain('rfp.stated-in-document');
    expect(message).toMatch(/Do NOT return a confidence/);
  });

  it('stores a PROPOSED fact with its citation and leaves answerDraft alone', async () => {
    llmMock.runRfpCompletion.mockResolvedValue(
      completion({
        status: 'YES',
        justification: 'Yes — the ITT itself requires EU/EEA processing.',
        // A smuggled confidence: zod strips it, so it never reaches the ledger.
        confidence: 9999,
        evidence: [
          {
            kind: 'rfp.stated-in-document',
            detail: 'ITT §4.2 requires EU/EEA processing',
            sourceChunkId: CHUNK_ID,
          },
        ],
        citations: [
          { sourceChunkId: CHUNK_ID, quote: 'process all personal data within the EU/EEA' },
        ],
      }),
    );

    await processComplianceFillJobForTest(job(), log);

    expect(prismaMock.facts).toHaveLength(1);
    expect(prismaMock.facts[0]).toMatchObject({
      status: 'PROPOSED',
      verdict: 'YES',
      band: 'VERIFIED',
      confidenceBps: 9500,
      producedByAgentKey: 'rfp-compliance-proposer',
      subjectType: 'matrix_row',
    });
    expect(prismaMock.citations[0]).toMatchObject({
      sourceChunkId: CHUNK_ID,
      pageStart: 12,
      pageEnd: 13,
    });
    // The point of the whole change: no production-visible column is touched.
    expect(prismaMock.updates).toEqual([]);
  });

  function fabricatedQuoteAnswer(): { text: string } {
    return completion({
      status: 'YES',
      justification: 'Yes, we comply.',
      evidence: [{ kind: 'rfp.stated-in-document', detail: 'invented', sourceChunkId: CHUNK_ID }],
      citations: [
        { sourceChunkId: CHUNK_ID, quote: 'The Supplier guarantees 99.99% uptime worldwide' },
      ],
    });
  }

  it('a fabricated quote leaves nothing behind — no fact, no citation', async () => {
    prismaMock.state.requirement.mandatory = false;
    llmMock.runRfpCompletion.mockResolvedValue(fabricatedQuoteAnswer());

    await processComplianceFillJobForTest(job(), log);

    expect(prismaMock.facts).toEqual([]);
    expect(prismaMock.citations).toEqual([]);
  });

  it('a fabricated quote on a MANDATORY row becomes a gap, never an answer', async () => {
    llmMock.runRfpCompletion.mockResolvedValue(fabricatedQuoteAnswer());

    await processComplianceFillJobForTest(job(), log);

    // The only fact written is the gap; the YES the model asserted is gone.
    expect(prismaMock.facts).toHaveLength(1);
    expect(prismaMock.facts[0]).toMatchObject({ verdict: 'GAP', confidenceBps: null });
    expect(prismaMock.citations).toEqual([]);
    expect(prismaMock.issues[0]).toMatchObject({ severity: 'high' });
  });

  it('opens a high-severity ReviewIssue when a mandatory requirement cannot be met', async () => {
    llmMock.runRfpCompletion.mockResolvedValue(
      completion({
        status: 'NO',
        justification: 'The ITT requires EU-only processing; our platform runs in us-east-1.',
        evidence: [
          {
            kind: 'rfp.stated-in-document',
            detail: 'ITT §4.2 requires EU/EEA processing',
            sourceChunkId: CHUNK_ID,
          },
        ],
        citations: [
          { sourceChunkId: CHUNK_ID, quote: 'process all personal data within the EU/EEA' },
        ],
      }),
    );

    await processComplianceFillJobForTest(job(), log);

    expect(prismaMock.issues).toHaveLength(1);
    expect(prismaMock.issues[0]).toMatchObject({
      severity: 'high',
      status: 'open',
      category: 'compliance_gap',
      requirementId: REQ_ID,
    });
  });

  it('does not raise a gap for a requirement that is not mandatory', async () => {
    prismaMock.state.requirement.mandatory = false;
    llmMock.runRfpCompletion.mockResolvedValue(
      completion({ status: 'NO', justification: 'We do not offer this.', evidence: [] }),
    );

    await processComplianceFillJobForTest(job(), log);

    expect(prismaMock.issues).toEqual([]);
  });
});
