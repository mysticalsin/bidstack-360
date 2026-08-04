// DB-backed contract lane for the BidFact ledger.
//
// The unit suites prove the LAWS against a fake. This file proves the SHAPES:
// that `prisma` really does satisfy the narrow ports in `retrieval.ts` and
// `facts.ts`, that the FKs and NOT NULLs accept what we write, and that the
// citation cascade behaves as the schema comment claims. None of that can be
// established without Postgres.
//
// STATUS AT TIME OF WRITING: not executed. Docker is down on this machine
// (privileged service stopped), so the fast test Postgres on :5434 is
// unreachable and every case below takes the dbReachable skip. Run with:
//
//   export DATABASE_URL="postgresql://bidstack:bidstack@localhost:5434/bidstack_test?schema=public"
//   export SHADOW_DATABASE_URL="postgresql://bidstack:bidstack@localhost:5434/bidstack_shadow?schema=public"
//   export NODE_ENV=test
//   pnpm --filter @bidstack/worker exec vitest run src/agent/facts.contract.test.ts

import { prisma } from '@bidstack/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { flagComplianceGap, proposeAnswer, valueHashFor } from './facts.js';
import { retrieveMatrixRowContext } from './retrieval.js';

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

const CHUNK_TEXT =
  'The Supplier shall process all personal data within the EU/EEA at all times, and shall not transfer it to a third country without prior written consent.';

async function createFixture(label: string) {
  const org = await prisma.org.create({
    data: { name: `Bid Fact ${label}`, clerkOrg: `org_bid_fact_${label}_${Date.now()}` },
  });
  const document = await prisma.bidDocument.create({
    data: { orgId: org.id, title: 'Invitation to Tender' },
  });
  const version = await prisma.documentVersion.create({
    data: {
      orgId: org.id,
      bidDocumentId: document.id,
      versionNo: 2,
      storageKey: `${org.id}/itt.pdf`,
      contentType: 'application/pdf',
      bytes: 1024,
    },
  });
  const chunk = await prisma.sourceChunk.create({
    data: {
      orgId: org.id,
      bidDocumentId: document.id,
      documentVersionId: version.id,
      chunkIndex: 5,
      pageStart: 12,
      pageEnd: 12,
      sectionPath: '§4.2 Data Protection',
      text: CHUNK_TEXT,
    },
  });
  const requirement = await prisma.requirement.create({
    data: {
      orgId: org.id,
      bidDocumentId: document.id,
      documentVersionId: version.id,
      sourceChunkId: chunk.id,
      text: 'All personal data shall be processed within the EU.',
      mandatory: true,
    },
  });
  const row = await prisma.complianceMatrixRow.create({
    data: { orgId: org.id, requirementId: requirement.id },
  });
  return { org, document, version, chunk, requirement, row };
}

async function cleanup(orgId: string) {
  await prisma.bidFactCitation.deleteMany({ where: { orgId } });
  await prisma.bidFactDecision.deleteMany({ where: { orgId } });
  await prisma.bidFact.deleteMany({ where: { orgId } });
  await prisma.reviewIssue.deleteMany({ where: { orgId } });
  await prisma.complianceMatrixRow.deleteMany({ where: { orgId } });
  await prisma.requirement.deleteMany({ where: { orgId } });
  await prisma.sourceChunk.deleteMany({ where: { orgId } });
  await prisma.documentVersion.deleteMany({ where: { orgId } });
  await prisma.bidDocument.deleteMany({ where: { orgId } });
  await prisma.org.delete({ where: { id: orgId } });
}

describe('bid fact ledger contract lane', () => {
  it('walks the real provenance chain to a page-ranged context', async () => {
    if (!dbReachable) {
      console.warn('[skip] bid fact retrieval chain - DB unavailable');
      return;
    }
    const fx = await createFixture('retrieval');
    try {
      const { matrixRow, context } = await retrieveMatrixRowContext(prisma, {
        orgId: fx.org.id,
        matrixRowId: fx.row.id,
      });

      expect(matrixRow?.requirementId).toBe(fx.requirement.id);
      expect(context.assessable).toBe(true);
      expect(context.chunk?.id).toBe(fx.chunk.id);
      expect(context.pageRange).toEqual({ start: 12, end: 12 });
      expect(context.document).toMatchObject({ versionNo: 2, title: 'Invitation to Tender' });
    } finally {
      await cleanup(fx.org.id);
    }
  });

  it('reports UNAVAILABLE for a requirement whose sourceChunkId is null', async () => {
    if (!dbReachable) {
      console.warn('[skip] bid fact unavailable chain - DB unavailable');
      return;
    }
    const fx = await createFixture('unavailable');
    try {
      await prisma.requirement.update({
        where: { id: fx.requirement.id },
        data: { sourceChunkId: null },
      });

      const { context } = await retrieveMatrixRowContext(prisma, {
        orgId: fx.org.id,
        matrixRowId: fx.row.id,
      });

      expect(context.assessable).toBe(false);
      expect(context.unavailableReason).toBe('no-source-chunk');
    } finally {
      await cleanup(fx.org.id);
    }
  });

  it('persists a PROPOSED fact with its citation and leaves the matrix row untouched', async () => {
    if (!dbReachable) {
      console.warn('[skip] bid fact propose - DB unavailable');
      return;
    }
    const fx = await createFixture('propose');
    try {
      const result = await proposeAnswer(prisma, {
        orgId: fx.org.id,
        opportunityId: null,
        subjectType: 'matrix_row',
        subjectId: fx.row.id,
        claim: 'Yes. All personal data is processed within the EU/EEA.',
        verdict: 'YES',
        evidence: [
          {
            kind: 'rfp.stated-in-document',
            detail: 'ITT §4.2 requires EU/EEA processing',
            sourceChunkId: fx.chunk.id,
          },
        ],
        citationCandidates: [
          { sourceChunkId: fx.chunk.id, quote: 'process all personal data within the EU/EEA' },
        ],
        chunksById: new Map([
          [
            fx.chunk.id,
            {
              id: fx.chunk.id,
              chunkIndex: 5,
              pageStart: 12,
              pageEnd: 12,
              sectionPath: '§4.2 Data Protection',
              text: CHUNK_TEXT,
            },
          ],
        ]),
        assessmentStatus: 'ASSESSED',
        humanAuthored: false,
      });

      expect(result.stored).toBe(true);
      const fact = await prisma.bidFact.findUniqueOrThrow({ where: { id: result.factId ?? '' } });
      expect(fact.status).toBe('PROPOSED');
      expect(fact.band).toBe('VERIFIED');
      expect(fact.confidenceBps).toBe(9500);
      expect(fact.valueHash).toHaveLength(64);

      const citations = await prisma.bidFactCitation.findMany({ where: { bidFactId: fact.id } });
      expect(citations).toHaveLength(1);
      expect(citations[0]?.pageStart).toBe(12);

      // ADR-0003 Decision 3: the row is exactly as we found it.
      const row = await prisma.complianceMatrixRow.findUniqueOrThrow({ where: { id: fx.row.id } });
      expect(row.answerDraft).toBeNull();
      expect(row.confidenceBps).toBeNull();
      expect(row.assessmentStatus).toBe('PENDING');
    } finally {
      await cleanup(fx.org.id);
    }
  });

  it('never re-offers a claim a human dismissed', async () => {
    if (!dbReachable) {
      console.warn('[skip] bid fact dismissal dedupe - DB unavailable');
      return;
    }
    const fx = await createFixture('dismissed');
    const claim = 'Yes. All personal data is processed within the EU/EEA.';
    try {
      await prisma.bidFact.create({
        data: {
          orgId: fx.org.id,
          subjectType: 'matrix_row',
          subjectId: fx.row.id,
          claim,
          verdict: 'YES',
          status: 'DISMISSED',
          valueHash: valueHashFor(claim),
          producedByAgentKey: 'rfp-compliance-proposer',
        },
      });

      const result = await proposeAnswer(prisma, {
        orgId: fx.org.id,
        opportunityId: null,
        subjectType: 'matrix_row',
        subjectId: fx.row.id,
        // Reformatted, same claim after normalization.
        claim: 'YES.  All personal data is processed within the EU / EEA!',
        verdict: 'YES',
        evidence: [{ kind: 'rfp.stated-in-document', detail: 'ITT §4.2' }],
        citationCandidates: [],
        chunksById: new Map(),
        assessmentStatus: 'ASSESSED',
        humanAuthored: false,
      });

      expect(result.refusal).toBe('dismissed-value');
      expect(await prisma.bidFact.count({ where: { orgId: fx.org.id } })).toBe(1);
    } finally {
      await cleanup(fx.org.id);
    }
  });

  it('opens one high-severity blocking issue per requirement, idempotently', async () => {
    if (!dbReachable) {
      console.warn('[skip] bid fact gap - DB unavailable');
      return;
    }
    const fx = await createFixture('gap');
    try {
      const input = {
        orgId: fx.org.id,
        opportunityId: null,
        requirementId: fx.requirement.id,
        subjectType: 'matrix_row' as const,
        subjectId: fx.row.id,
        gap: 'Nothing on file evidences EU-only processing for this scope.',
        requirementText: fx.requirement.text,
        evidence: [],
        sourceChunkId: fx.chunk.id,
        assessmentStatus: 'ASSESSED' as const,
      };

      const first = await flagComplianceGap(prisma, input);
      const second = await flagComplianceGap(prisma, input);

      expect(first.issueCreated).toBe(true);
      expect(second.issueCreated).toBe(false);
      expect(second.reviewIssueId).toBe(first.reviewIssueId);

      const issues = await prisma.reviewIssue.findMany({ where: { orgId: fx.org.id } });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.severity).toBe('high');
      expect(issues[0]?.status).toBe('open');
    } finally {
      await cleanup(fx.org.id);
    }
  });

  it('drops a citation when its chunk goes, and keeps the fact', async () => {
    if (!dbReachable) {
      console.warn('[skip] bid fact citation cascade - DB unavailable');
      return;
    }
    const fx = await createFixture('cascade');
    try {
      const fact = await prisma.bidFact.create({
        data: {
          orgId: fx.org.id,
          subjectType: 'matrix_row',
          subjectId: fx.row.id,
          claim: 'Yes.',
          verdict: 'YES',
          valueHash: valueHashFor('Yes.'),
          producedByAgentKey: 'rfp-compliance-proposer',
        },
      });
      await prisma.bidFactCitation.create({
        data: {
          orgId: fx.org.id,
          bidFactId: fact.id,
          sourceChunkId: fx.chunk.id,
          pageStart: 12,
          pageEnd: 12,
          quote: 'process all personal data within the EU/EEA',
        },
      });

      // Hard delete: the schema comment says an unverifiable citation must not
      // survive its chunk, while the fact itself remains (reading UNAVAILABLE).
      await prisma.$executeRaw`DELETE FROM source_chunks WHERE id = ${fx.chunk.id}::uuid`;

      expect(await prisma.bidFactCitation.count({ where: { bidFactId: fact.id } })).toBe(0);
      expect(await prisma.bidFact.count({ where: { id: fact.id } })).toBe(1);
    } finally {
      await cleanup(fx.org.id);
    }
  });
});
