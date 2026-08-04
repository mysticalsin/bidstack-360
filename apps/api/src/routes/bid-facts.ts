// Round 2 — the BidFact ledger's human doors.
//
//   1. GET  /api/v1/bid-facts?subjectType=&subjectId=[&status=][&limit=]
//      — lists the agent's facts for one subject (PROPOSED by default) with
//        their re-verified citations: quote, page range, source document name.
//
//   2. POST /api/v1/bid-facts/:id/decide  { decision: 'accept' | 'dismiss' }
//      — the per-row promotion door of ADR-0003 Decision 4. Nothing the agent
//        produces reaches `ComplianceMatrixRow.answerDraft` without passing
//        through here under a named human.
//
// The transaction shape is cloned from the RFP approval gate
// (rfp-pipeline.ts:429-505), which is the repo's reference TOCTOU pattern:
// conditional `updateMany` asserting exactly one row moved, the guard that was
// fast-failed outside the transaction re-checked INSIDE it, the AuditLog row
// written in the same transaction — and `logAiInvocation` fired AFTER the
// commit, fire-and-forget, because an audit-sink outage must never be able to
// block a human decision (ADR-0003 Decision 4, "Correction to the ultraplan").

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';

import { logAiInvocation } from '../lib/ai-audit.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'bid-facts' });

// ─── Schemas ─────────────────────────────────────────────────────────────────

const SUBJECT_TYPES = ['matrix_row', 'requirement'] as const;
const FACT_STATUSES = ['PROPOSED', 'APPLIED', 'DISMISSED', 'SUPERSEDED'] as const;

const BidFactListQuery = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  // The strip only ever renders PROPOSED; the other states are here so the
  // provenance/rationale panels can read the same endpoint.
  status: z.enum(FACT_STATUSES).default('PROPOSED'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const BidFactCitationItem = z.object({
  id: z.string().uuid(),
  sourceChunkId: z.string().uuid(),
  quote: z.string(),
  pageStart: z.number().int().nullable(),
  pageEnd: z.number().int().nullable(),
  /** Title of the BidDocument the cited chunk came from; null if unresolvable. */
  documentName: z.string().nullable(),
});

const BidFactItem = z.object({
  id: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  subjectType: z.string(),
  subjectId: z.string().uuid(),
  claim: z.string(),
  verdict: z.string(),
  confidenceBps: z.number().int().nullable(),
  band: z.string().nullable(),
  assessmentStatus: z.enum(['ASSESSED', 'UNAVAILABLE', 'PENDING']),
  rationale: z.string().nullable(),
  status: z.enum(FACT_STATUSES),
  producedByAgentKey: z.string(),
  decidedByUserId: z.string().uuid().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  citations: z.array(BidFactCitationItem),
});

const BidFactList = z.object({
  items: z.array(BidFactItem),
  total: z.number().int(),
});

const DecideParams = z.object({ id: z.string().uuid() });
const DecideBody = z.object({ decision: z.enum(['accept', 'dismiss']) });

const DecideResponse = z.object({
  id: z.string().uuid(),
  status: z.enum(FACT_STATUSES),
  decidedAt: z.string(),
  decidedByUserId: z.string().uuid(),
  decisionId: z.string().uuid(),
  /** True when the accept wrote through to a ComplianceMatrixRow. */
  matrixRowUpdated: z.boolean(),
  /** Prior APPLIED facts for the same subject that this accept superseded. */
  supersededFactIds: z.array(z.string().uuid()),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

type DbClient = Prisma.TransactionClient;

/**
 * Has a person edited this compliance row's answer since the fact was proposed?
 *
 * WHY the audit log and not `ComplianceMatrixRow.updatedAt`: the row has no
 * `updatedByUserId`, and `updatedAt` moves for owner/status/due-date edits that
 * have nothing to do with the answer — using it would 409 on decisions that are
 * perfectly safe. The matrix PATCH route writes exactly one audit row per human
 * edit (`bid-workspace-requirements.ts:208-218`, action `compliance_matrix.update`,
 * `diff` = the request body), and the worker's direct write does not, so an
 * audit row carrying an `answerDraft` key IS the human-edit signal.
 *
 * A person outranks the agent (ADR-0004 Decision 4): we refuse, never clobber.
 */
async function findHumanAnswerEdit(
  db: DbClient,
  args: { orgId: string; matrixRowId: string; since: Date },
): Promise<boolean> {
  const edits = await db.auditLog.findMany({
    where: {
      orgId: args.orgId,
      targetType: 'compliance_matrix_row',
      targetId: args.matrixRowId,
      action: 'compliance_matrix.update',
      // A null userId is a system actor, not a person.
      userId: { not: null },
      at: { gt: args.since },
      deletedAt: null,
    },
    select: { diff: true },
    orderBy: { at: 'desc' },
    // Bounded: one qualifying edit is enough to refuse.
    take: 50,
  });

  return edits.some(
    (edit) =>
      edit.diff !== null &&
      typeof edit.diff === 'object' &&
      !Array.isArray(edit.diff) &&
      'answerDraft' in edit.diff,
  );
}

/**
 * The calibration snapshot's evidence vocabulary.
 *
 * KNOWN GAP: `BidFact` has no `evidenceKinds` column, so the kinds the agent
 * observed are not persisted anywhere the API can read (ADR-0004 records
 * `BidFactDecision.evidenceKinds` as "the only record that can ever re-price"
 * the weights, but the ledger drops the observations after scoring). Deriving
 * them from citations would snapshot only the citable subset — a biased sample
 * is worse for calibration than an empty one — so this returns `[]` until
 * `BidFact.evidenceKinds String[]` lands with the propose path. `scoreBps` and
 * `band` below are real.
 */
function evidenceKindsSnapshot(): string[] {
  return [];
}

// ─── Route plugin ────────────────────────────────────────────────────────────

export const bidFactRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── 1. List facts for a subject ────────────────────────────────────────────
  server.get(
    '/bid-facts',
    {
      config: { permission: 'proposals:read' },
      preHandler: server.requirePermission('proposals:read'),
      schema: {
        querystring: BidFactListQuery,
        response: { 200: BidFactList },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { subjectType, subjectId, status, limit } = req.query;

      const where: Prisma.BidFactWhereInput = { orgId, subjectType, subjectId, status };

      const [rows, total] = await Promise.all([
        prisma.bidFact.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            opportunityId: true,
            subjectType: true,
            subjectId: true,
            claim: true,
            verdict: true,
            confidenceBps: true,
            band: true,
            assessmentStatus: true,
            rationale: true,
            status: true,
            producedByAgentKey: true,
            decidedByUserId: true,
            decidedAt: true,
            createdAt: true,
            citations: {
              select: {
                id: true,
                sourceChunkId: true,
                quote: true,
                pageStart: true,
                pageEnd: true,
                sourceChunk: { select: { bidDocument: { select: { title: true } } } },
              },
            },
          },
        }),
        prisma.bidFact.count({ where }),
      ]);

      return {
        items: rows.map((row) => ({
          ...row,
          decidedAt: row.decidedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          citations: row.citations.map((cite) => ({
            id: cite.id,
            sourceChunkId: cite.sourceChunkId,
            quote: cite.quote,
            pageStart: cite.pageStart,
            pageEnd: cite.pageEnd,
            documentName: cite.sourceChunk?.bidDocument?.title ?? null,
          })),
        })),
        total,
      };
    },
  );

  // ── 2. Accept or dismiss a proposed fact ───────────────────────────────────
  server.post(
    '/bid-facts/:id/decide',
    {
      config: { permission: 'proposals:write' },
      // config.permission is observability-only — the preHandler is the gate.
      preHandler: server.requirePermission('proposals:write'),
      schema: {
        params: DecideParams,
        body: DecideBody,
        response: { 200: DecideResponse },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const { decision } = req.body;

      const fact = await prisma.bidFact.findFirst({
        where: { id: req.params.id, orgId },
        select: {
          id: true,
          opportunityId: true,
          subjectType: true,
          subjectId: true,
          claim: true,
          verdict: true,
          confidenceBps: true,
          band: true,
          assessmentStatus: true,
          status: true,
          createdAt: true,
        },
      });
      // Org-scoped lookup, so another tenant's fact is indistinguishable from
      // one that does not exist.
      if (!fact) throw server.httpErrors.notFound('Bid fact not found');

      // DISMISSED is terminal and SUPERSEDED/APPLIED are already settled
      // (ADR-0004 Decision 4). Only PROPOSED is decidable.
      if (fact.status !== 'PROPOSED') {
        throw server.httpErrors.conflict(
          `Bid fact has already been settled (status: '${fact.status}')`,
        );
      }

      // An accept has to land somewhere. Resolve the target row now so the
      // failure is a clean 409 rather than a fact marked APPLIED with nothing
      // written behind it. A dismiss touches no subject and needs no target.
      let targetRowId: string | null = null;
      if (decision === 'accept') {
        const rowWhere: Prisma.ComplianceMatrixRowWhereInput =
          fact.subjectType === 'matrix_row'
            ? { id: fact.subjectId }
            : // 'requirement' subjects resolve through the unique
              // ComplianceMatrixRow.requirementId link (schema.prisma:1684).
              { requirementId: fact.subjectId };

        const row = await prisma.complianceMatrixRow.findFirst({
          where: { ...rowWhere, orgId, deletedAt: null },
          select: { id: true },
        });
        if (!row) {
          throw server.httpErrors.conflict(
            'No compliance matrix row is linked to this fact; it cannot be applied',
          );
        }
        targetRowId = row.id;

        // Fast-fail outside the transaction (the common case); re-checked
        // inside it below, mirroring the approval gate's blocker recount.
        const edited = await findHumanAnswerEdit(prisma, {
          orgId,
          matrixRowId: targetRowId,
          since: fact.createdAt,
        });
        if (edited) {
          throw server.httpErrors.conflict(
            'This answer was edited by a person after the fact was proposed; ' +
              'the proposal was not applied',
          );
        }
      }

      const decidedAt = new Date();
      const nextStatus = decision === 'accept' ? 'APPLIED' : 'DISMISSED';

      const outcome = await prisma.$transaction(async (tx) => {
        // Atomic settle guard: `status: 'PROPOSED'` in the where-clause means a
        // concurrent second decide loses the race (count 0) with no row lock —
        // the rfp-pipeline.ts:433-443 pattern.
        const settled = await tx.bidFact.updateMany({
          where: { id: fact.id, orgId, status: 'PROPOSED' },
          data: { status: nextStatus, decidedByUserId: userId, decidedAt },
        });
        if (settled.count !== 1) {
          throw server.httpErrors.conflict('Bid fact has already been settled');
        }

        const supersededFactIds: string[] = [];
        let matrixRowUpdated = false;

        if (decision === 'accept' && targetRowId) {
          // TOCTOU guard: a person can edit the answer between the fast-fail
          // above and this commit. Re-checking here rolls the whole accept back
          // instead of clobbering them.
          const editedNow = await findHumanAnswerEdit(tx, {
            orgId,
            matrixRowId: targetRowId,
            since: fact.createdAt,
          });
          if (editedNow) {
            throw server.httpErrors.conflict(
              'This answer was edited by a person during the decision; ' +
                'the proposal was not applied',
            );
          }

          // Supersede the prior APPLIED fact(s) for the same subject — a subject
          // carries exactly one live answer, and the old one keeps a forward
          // pointer instead of being rewritten (ADR-0004 Decision 4).
          const priors = await tx.bidFact.findMany({
            where: {
              orgId,
              subjectType: fact.subjectType,
              subjectId: fact.subjectId,
              status: 'APPLIED',
              id: { not: fact.id },
            },
            select: { id: true },
            // The invariant is one live APPLIED fact per subject, so this reads
            // 0 or 1 rows; the bound satisfies the unbounded-findMany scale
            // guard (plugins/query-guard.ts) and caps a raced double-apply.
            take: 50,
          });
          if (priors.length > 0) {
            const priorIds = priors.map((prior) => prior.id);
            await tx.bidFact.updateMany({
              where: { id: { in: priorIds }, orgId, status: 'APPLIED' },
              data: { status: 'SUPERSEDED', supersededById: fact.id },
            });
            supersededFactIds.push(...priorIds);
          }

          // Conditional write asserting exactly one row changed: the org +
          // soft-delete predicate is re-evaluated at commit time, so a row
          // deleted mid-decision rolls the accept back rather than vanishing.
          const written = await tx.complianceMatrixRow.updateMany({
            where: { id: targetRowId, orgId, deletedAt: null },
            data: {
              answerDraft: fact.claim,
              responseStatus: fact.verdict,
              confidenceBps: fact.confidenceBps,
              assessmentStatus: fact.assessmentStatus,
            },
          });
          if (written.count !== 1) {
            throw server.httpErrors.conflict(
              'Compliance matrix row changed during the decision; please retry',
            );
          }
          matrixRowUpdated = true;
        }

        // The calibration flywheel row goes INSIDE the transaction: a decision
        // that committed without its snapshot is a decision we can never learn
        // from (ADR-0003 Decision 4).
        const decisionRow = await tx.bidFactDecision.create({
          data: {
            orgId,
            bidFactId: fact.id,
            decision,
            decidedByUserId: userId,
            evidenceKinds: evidenceKindsSnapshot(),
            scoreBps: fact.confidenceBps,
            band: fact.band,
          },
          select: { id: true },
        });

        await tx.auditLog.create({
          data: {
            orgId,
            userId,
            action: `bid_fact.${decision}`,
            targetType: 'bid_fact',
            targetId: fact.id,
            diff: {
              decision,
              status: nextStatus,
              decidedAt: decidedAt.toISOString(),
              subjectType: fact.subjectType,
              subjectId: fact.subjectId,
              matrixRowId: targetRowId,
              supersededFactIds,
              band: fact.band,
              confidenceBps: fact.confidenceBps,
            },
          },
        });

        return { decisionId: decisionRow.id, supersededFactIds, matrixRowUpdated };
      });

      // EU AI Act Art. 50 — log the human-in-the-loop decision on AI output.
      // WHY fire-and-forget AFTER the commit: audit failure must never block a
      // human decision; the AuditLog row above is the primary paper trail.
      // Mirrors rfp-pipeline.ts:492-505 exactly (ADR-0003 Decision 4).
      void logAiInvocation({
        orgId,
        userId,
        agentType: 'human-decision',
        model: 'human',
        prompt: `Bid fact ${decision}: ${fact.claim}`,
        response: decision === 'accept' ? 'accepted' : 'dismissed',
        tokenCount: 0,
        durationMs: 0,
        status: 'success',
      });

      log.info(
        {
          orgId,
          userId,
          bidFactId: fact.id,
          decision,
          matrixRowId: targetRowId,
          supersededFactIds: outcome.supersededFactIds,
        },
        'Bid fact decided by human reviewer',
      );

      return {
        id: fact.id,
        status: nextStatus as (typeof FACT_STATUSES)[number],
        decidedAt: decidedAt.toISOString(),
        decidedByUserId: userId,
        decisionId: outcome.decisionId,
        matrixRowUpdated: outcome.matrixRowUpdated,
        supersededFactIds: outcome.supersededFactIds,
      };
    },
  );
};
