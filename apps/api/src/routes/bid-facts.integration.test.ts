// Integration tests — the BidFact ledger's human doors.
//
//   GET  /api/v1/bid-facts?subjectType=&subjectId=
//   POST /api/v1/bid-facts/:id/decide
//
// Invariants verified (ADR-0003 Decision 4 / ADR-0004 Decision 4):
//   - list returns PROPOSED facts with re-verified citations (quote, page
//     range, source document name) and never crosses an org boundary
//   - 404 on an unknown id AND on another tenant's fact (indistinguishable)
//   - 409 on an already-settled fact — which is also the idempotency contract:
//     a replayed decide loses the race instead of double-applying
//   - 409 when a person edited the answer after the fact was proposed, with
//     nothing written (a person outranks the agent)
//   - accept: APPLIED + answerDraft/responseStatus/confidenceBps/assessmentStatus
//     written through, prior APPLIED fact SUPERSEDED, BidFactDecision snapshot
//     and AuditLog row committed in the same transaction
//   - dismiss: DISMISSED + decision row, compliance row untouched

import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

const ctx = {
  server: null as unknown as FastifyInstance,
  orgId: null as string | null,
  userId: null as string | null,
  dbReachable: false,
  tablesReady: false,
};

const foreign = { orgId: null as string | null };

let restoreAuth: (() => void) | null = null;

/**
 * ADR-0004 Decision 3 — normalize (NFKC, lowercase, strip punctuation/symbols
 * to spaces, collapse whitespace) then SHA-256. Duplicated here rather than
 * imported because the producer lives in the worker; the fixture only needs a
 * stable, contract-shaped hash.
 */
function valueHashOf(claim: string): string {
  const normalized = claim
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    ctx.dbReachable = true;
  } catch {
    ctx.dbReachable = false;
    return;
  }

  try {
    const check = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public.bid_facts') IS NOT NULL AS "exists"
    `;
    ctx.tablesReady = check[0]?.exists ?? false;
  } catch {
    ctx.tablesReady = false;
  }
  if (!ctx.tablesReady) return;

  const iso = await createIsolatedOrg('bid-facts');
  ctx.orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

  const user = await prisma.user.findFirst({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  ctx.userId = user?.id ?? null;

  const foreignOrg = await prisma.org.create({
    data: { clerkOrg: `org_bidfacts_foreign_${randomUUID()}`, name: 'BidFacts Foreign Tenant' },
  });
  foreign.orgId = foreignOrg.id;

  ctx.server = await buildServer();
  await ctx.server.ready();
}, 60_000);

afterAll(async () => {
  if (ctx.server) await ctx.server.close();
  restoreAuth?.();
  // Org cascade reclaims bid_facts, citations, decisions, audit rows, matrix
  // rows, requirements, chunks, documents and opportunities in one statement.
  if (ctx.dbReachable && foreign.orgId) await dropIsolatedOrg(foreign.orgId);
  if (ctx.dbReachable && ctx.orgId) await dropIsolatedOrg(ctx.orgId);
  if (ctx.dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => ctx.dbReachable && ctx.tablesReady && !!ctx.orgId);

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * One full provenance chain: opportunity → bid document → version → chunk →
 * requirement → compliance matrix row. `orgId` defaults to the isolated org;
 * pass the foreign org id to build the cross-tenant fixture.
 */
async function createSubject(opts: { orgId?: string; label?: string } = {}) {
  const orgId = opts.orgId ?? ctx.orgId!;
  const label = opts.label ?? 'facts';

  const opp = await prisma.opportunity.create({
    data: {
      orgId,
      code: `BF-${label.toUpperCase().slice(0, 4)}-${randomUUID().slice(0, 8)}`,
      customer: label,
      name: `BidFact Integration — ${label}`,
      stage: 's1_lead',
    },
  });

  const bidDoc = await prisma.bidDocument.create({
    data: {
      orgId,
      opportunityId: opp.id,
      title: 'Meridian RFP — Volume 2',
      documentType: 'rfp',
      status: 'intake',
      source: 'upload',
    },
  });

  const docVersion = await prisma.documentVersion.create({
    data: {
      orgId,
      bidDocumentId: bidDoc.id,
      versionNo: 1,
      storageKey: `${orgId}/bid-facts/${randomUUID()}/rfp.pdf`,
      contentType: 'application/pdf',
      bytes: 2048,
      extractionStatus: 'queued',
      ocrStatus: 'queued',
    },
  });

  const chunk = await prisma.sourceChunk.create({
    data: {
      orgId,
      bidDocumentId: bidDoc.id,
      documentVersionId: docVersion.id,
      chunkIndex: 0,
      pageStart: 14,
      pageEnd: 14,
      text: 'All data shall reside within the EEA for the duration of the contract.',
    },
  });

  const requirement = await prisma.requirement.create({
    data: {
      orgId,
      opportunityId: opp.id,
      bidDocumentId: bidDoc.id,
      documentVersionId: docVersion.id,
      sourceChunkId: chunk.id,
      text: 'Data residency: all data shall reside within the EEA.',
      mandatory: true,
    },
  });

  const row = await prisma.complianceMatrixRow.create({
    data: { orgId, opportunityId: opp.id, requirementId: requirement.id },
  });

  return { orgId, opp, bidDoc, docVersion, chunk, requirement, row };
}

type SubjectFixture = Awaited<ReturnType<typeof createSubject>>;

async function createFact(
  subject: SubjectFixture,
  opts: {
    claim?: string;
    status?: 'PROPOSED' | 'APPLIED' | 'DISMISSED' | 'SUPERSEDED';
    verdict?: string;
    confidenceBps?: number | null;
    band?: string | null;
    withCitation?: boolean;
  } = {},
) {
  const claim = opts.claim ?? 'YES — hosting is delivered from EU datacentres.';
  const fact = await prisma.bidFact.create({
    data: {
      orgId: subject.orgId,
      opportunityId: subject.opp.id,
      subjectType: 'matrix_row',
      subjectId: subject.row.id,
      claim,
      verdict: opts.verdict ?? 'YES',
      confidenceBps: opts.confidenceBps === undefined ? 9500 : opts.confidenceBps,
      band: opts.band === undefined ? 'VERIFIED' : opts.band,
      assessmentStatus: 'ASSESSED',
      rationale: 'The RFP itself states it at a citable page',
      status: opts.status ?? 'PROPOSED',
      valueHash: valueHashOf(claim),
      producedByAgentKey: 'bid-answer-proposer',
    },
    select: { id: true, createdAt: true, claim: true },
  });

  if (opts.withCitation ?? true) {
    await prisma.bidFactCitation.create({
      data: {
        orgId: subject.orgId,
        bidFactId: fact.id,
        sourceChunkId: subject.chunk.id,
        pageStart: 14,
        pageEnd: 14,
        quote: 'all data shall reside within the EEA',
      },
    });
  }

  return fact;
}

function decide(factId: string, decision: 'accept' | 'dismiss') {
  return ctx.server.inject({
    method: 'POST',
    url: `/api/v1/bid-facts/${factId}/decide`,
    payload: { decision },
  });
}

// ─── GET /api/v1/bid-facts ───────────────────────────────────────────────────

describe('GET /api/v1/bid-facts', () => {
  skipIfNoDb('lists PROPOSED facts for a subject with quote, page range and document', async () => {
    const subject = await createSubject({ label: 'list' });
    const fact = await createFact(subject);

    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/bid-facts?subjectType=matrix_row&subjectId=${subject.row.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      total: number;
      items: Array<{
        id: string;
        status: string;
        band: string | null;
        confidenceBps: number | null;
        citations: Array<{
          quote: string;
          pageStart: number | null;
          pageEnd: number | null;
          documentName: string | null;
        }>;
      }>;
    }>();

    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(fact.id);
    expect(body.items[0]?.status).toBe('PROPOSED');
    expect(body.items[0]?.band).toBe('VERIFIED');
    expect(body.items[0]?.confidenceBps).toBe(9500);

    const cite = body.items[0]?.citations[0];
    expect(cite?.quote).toBe('all data shall reside within the EEA');
    expect(cite?.pageStart).toBe(14);
    expect(cite?.pageEnd).toBe(14);
    // The provenance tooltip needs the human-readable document name.
    expect(cite?.documentName).toBe('Meridian RFP — Volume 2');
  });

  skipIfNoDb('does not leak another org’s facts for the same subject id', async () => {
    const foreignSubject = await createSubject({ orgId: foreign.orgId!, label: 'xorg' });
    await createFact(foreignSubject);

    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/bid-facts?subjectType=matrix_row&subjectId=${foreignSubject.row.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ total: number }>().total).toBe(0);
  });

  skipIfNoDb('status filter selects settled facts', async () => {
    const subject = await createSubject({ label: 'filter' });
    await createFact(subject, { status: 'PROPOSED', claim: 'pending claim' });
    const applied = await createFact(subject, { status: 'APPLIED', claim: 'settled claim' });

    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/bid-facts?subjectType=matrix_row&subjectId=${subject.row.id}&status=APPLIED`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ total: number; items: Array<{ id: string }> }>();
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(applied.id);
  });
});

// ─── POST /api/v1/bid-facts/:id/decide ───────────────────────────────────────

describe('POST /api/v1/bid-facts/:id/decide', () => {
  skipIfNoDb('404 for an unknown fact id', async () => {
    const res = await decide(randomUUID(), 'accept');
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('404 for a fact belonging to another org', async () => {
    const foreignSubject = await createSubject({ orgId: foreign.orgId!, label: 'xdec' });
    const foreignFact = await createFact(foreignSubject);

    const res = await decide(foreignFact.id, 'accept');
    expect(res.statusCode).toBe(404);

    // And nothing was written to the foreign tenant.
    const untouched = await prisma.bidFact.findUnique({
      where: { id: foreignFact.id },
      select: { status: true },
    });
    expect(untouched?.status).toBe('PROPOSED');
    expect(await prisma.bidFactDecision.count({ where: { bidFactId: foreignFact.id } })).toBe(0);
  });

  skipIfNoDb('accept applies the claim to the matrix row and logs the calibration row', async () => {
    const subject = await createSubject({ label: 'accept' });
    const fact = await createFact(subject);

    const res = await decide(fact.id, 'accept');
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      status: string;
      decidedByUserId: string;
      decisionId: string;
      matrixRowUpdated: boolean;
      supersededFactIds: string[];
    }>();
    expect(body.status).toBe('APPLIED');
    expect(body.decidedByUserId).toBe(ctx.userId);
    expect(body.matrixRowUpdated).toBe(true);
    expect(body.supersededFactIds).toEqual([]);

    const settled = await prisma.bidFact.findUnique({
      where: { id: fact.id },
      select: { status: true, decidedAt: true, decidedByUserId: true },
    });
    expect(settled?.status).toBe('APPLIED');
    expect(settled?.decidedAt).not.toBeNull();
    expect(settled?.decidedByUserId).toBe(ctx.userId);

    // The whole point: the claim reached the production-visible row.
    const row = await prisma.complianceMatrixRow.findUnique({
      where: { id: subject.row.id },
      select: {
        answerDraft: true,
        responseStatus: true,
        confidenceBps: true,
        assessmentStatus: true,
      },
    });
    expect(row?.answerDraft).toBe(fact.claim);
    expect(row?.responseStatus).toBe('YES');
    expect(row?.confidenceBps).toBe(9500);
    expect(row?.assessmentStatus).toBe('ASSESSED');

    // Calibration flywheel — the snapshot committed with the decision.
    const decisionRow = await prisma.bidFactDecision.findUnique({
      where: { id: body.decisionId },
      select: {
        decision: true,
        decidedByUserId: true,
        scoreBps: true,
        band: true,
        evidenceKinds: true,
        orgId: true,
      },
    });
    expect(decisionRow?.decision).toBe('accept');
    expect(decisionRow?.decidedByUserId).toBe(ctx.userId);
    expect(decisionRow?.scoreBps).toBe(9500);
    expect(decisionRow?.band).toBe('VERIFIED');
    expect(decisionRow?.orgId).toBe(ctx.orgId);
    // KNOWN GAP (documented in bid-facts.ts): BidFact does not persist the
    // observed evidence kinds, so the snapshot is empty until the column lands.
    // Pinned as a test so the fix flips this assertion deliberately.
    expect(decisionRow?.evidenceKinds).toEqual([]);

    // Art. 50 paper trail, written inside the same transaction.
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: ctx.orgId!, targetType: 'bid_fact', targetId: fact.id },
      select: { action: true, userId: true },
    });
    expect(audit?.action).toBe('bid_fact.accept');
    expect(audit?.userId).toBe(ctx.userId);
  });

  skipIfNoDb('a replayed decide 409s — the fact is settled exactly once', async () => {
    const subject = await createSubject({ label: 'replay' });
    const fact = await createFact(subject);

    expect((await decide(fact.id, 'accept')).statusCode).toBe(200);

    const replay = await decide(fact.id, 'accept');
    expect(replay.statusCode).toBe(409);

    // Exactly one calibration row: the replay wrote nothing.
    expect(await prisma.bidFactDecision.count({ where: { bidFactId: fact.id } })).toBe(1);
  });

  skipIfNoDb('409 on a fact that is already DISMISSED (terminal state)', async () => {
    const subject = await createSubject({ label: 'settled' });
    const fact = await createFact(subject, { status: 'DISMISSED' });

    const res = await decide(fact.id, 'accept');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toContain('already been settled');
  });

  skipIfNoDb('accept supersedes the prior APPLIED fact for the same subject', async () => {
    const subject = await createSubject({ label: 'supersede' });
    const prior = await createFact(subject, { status: 'APPLIED', claim: 'the earlier answer' });
    const next = await createFact(subject, { claim: 'the revised answer' });

    const res = await decide(next.id, 'accept');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ supersededFactIds: string[] }>().supersededFactIds).toEqual([prior.id]);

    const superseded = await prisma.bidFact.findUnique({
      where: { id: prior.id },
      select: { status: true, supersededById: true },
    });
    expect(superseded?.status).toBe('SUPERSEDED');
    // The forward pointer is what makes the ledger readable after the fact.
    expect(superseded?.supersededById).toBe(next.id);
  });

  skipIfNoDb('dismiss settles the fact and leaves the compliance row untouched', async () => {
    const subject = await createSubject({ label: 'dismiss' });
    const fact = await createFact(subject);

    const res = await decide(fact.id, 'dismiss');
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; matrixRowUpdated: boolean; decisionId: string }>();
    expect(body.status).toBe('DISMISSED');
    expect(body.matrixRowUpdated).toBe(false);

    const row = await prisma.complianceMatrixRow.findUnique({
      where: { id: subject.row.id },
      select: { answerDraft: true, assessmentStatus: true },
    });
    expect(row?.answerDraft).toBeNull();
    expect(row?.assessmentStatus).toBe('PENDING');

    const decisionRow = await prisma.bidFactDecision.findUnique({
      where: { id: body.decisionId },
      select: { decision: true },
    });
    expect(decisionRow?.decision).toBe('dismiss');
  });

  skipIfNoDb('409 when a person edited the answer after the fact was proposed', async () => {
    const subject = await createSubject({ label: 'human' });
    const fact = await createFact(subject);

    // A real human edit through the matrix PATCH route — that route's AuditLog
    // row is the signal the decide endpoint reads. Synthesizing the audit row
    // here would test the fixture, not the integration.
    const patched = await ctx.server.inject({
      method: 'PATCH',
      url: `/api/v1/bid-workspaces/${subject.opp.id}/matrix/${subject.row.id}`,
      payload: { answerDraft: 'Written by the bid manager, not the agent.' },
    });
    expect(patched.statusCode).toBe(200);

    const res = await decide(fact.id, 'accept');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toContain('edited by a person');

    // Refuse, never clobber: the human's text survives and the fact stays open.
    const row = await prisma.complianceMatrixRow.findUnique({
      where: { id: subject.row.id },
      select: { answerDraft: true },
    });
    expect(row?.answerDraft).toBe('Written by the bid manager, not the agent.');

    const untouched = await prisma.bidFact.findUnique({
      where: { id: fact.id },
      select: { status: true },
    });
    expect(untouched?.status).toBe('PROPOSED');
    expect(await prisma.bidFactDecision.count({ where: { bidFactId: fact.id } })).toBe(0);
  });

  skipIfNoDb('a status-only human edit does not block the accept', async () => {
    const subject = await createSubject({ label: 'statusonly' });
    const fact = await createFact(subject);

    // WHY this test: `updatedAt` would have moved here too. Blocking on it
    // would 409 decisions that are perfectly safe — hence the answerDraft-keyed
    // audit signal rather than a timestamp comparison.
    const patched = await ctx.server.inject({
      method: 'PATCH',
      url: `/api/v1/bid-workspaces/${subject.opp.id}/matrix/${subject.row.id}`,
      payload: { risk: 'high' },
    });
    expect(patched.statusCode).toBe(200);

    const res = await decide(fact.id, 'accept');
    expect(res.statusCode).toBe(200);
  });

  skipIfNoDb('409 when no compliance row is linked to the fact', async () => {
    const subject = await createSubject({ label: 'orphan' });
    const fact = await prisma.bidFact.create({
      data: {
        orgId: ctx.orgId!,
        opportunityId: subject.opp.id,
        // A requirement-subject fact whose requirement has no matrix row.
        subjectType: 'requirement',
        subjectId: randomUUID(),
        claim: 'orphan claim',
        verdict: 'YES',
        confidenceBps: 8500,
        band: 'VERIFIED',
        assessmentStatus: 'ASSESSED',
        valueHash: valueHashOf('orphan claim'),
        producedByAgentKey: 'bid-answer-proposer',
      },
      select: { id: true },
    });

    const res = await decide(fact.id, 'accept');
    // Fail loud rather than mark a fact APPLIED with nothing written behind it.
    expect(res.statusCode).toBe(409);
    expect(await prisma.bidFact.count({ where: { id: fact.id, status: 'PROPOSED' } })).toBe(1);
  });
});
