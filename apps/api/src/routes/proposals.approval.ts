/**
 * Proposal approval gate.
 *
 * Ordinary proposals:write can draft and revise. It cannot mark a proposal
 * approved, submitted, won, or lost. Those words are what Dust would read as
 * a human decision, so they require proposals:approve plus an attestation
 * that matches approve. A missing or rejecting attestation is not stored,
 * and a later read does not show approved, submitted, or won unless that
 * evidence is on the row. Submit only moves an already-approved version once.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import { Proposal, ProposalApprove, ProposalDraftRequest, ProposalSubmitResult } from '@bidstack/shared';

import { canViewAllRfps } from '../lib/rfp-visibility.js';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';
import {
  attestationMatchesDecision,
  evidenceFromApprovalDiff,
  visibleProposalStatus,
  type ProposalApprovalEvidence,
} from './proposal-approval-evidence.js';
import { serializeProposal } from './proposals.helpers.js';

export const IMMUTABLE_PROPOSAL_STATUSES = ['approved', 'submitted', 'won', 'lost'] as const;

export function proposalIsImmutable(status: string): boolean {
  return (IMMUTABLE_PROPOSAL_STATUSES as readonly string[]).includes(status);
}

export function immutableProposalMessage(): string {
  return 'This proposal is approved, submitted, won, or lost. Substantive edits require POST /api/v1/proposals/:id/revise, which creates a new draft and leaves this row unchanged.';
}

export function proposalEventKey(id: string, version: number): string {
  return `${id}:submitted:v${version}`;
}

const APPROVAL_AUDIT_ACTIONS = ['proposal.approved', 'proposal.rfp_approve'] as const;

/** Latest approval audit for each proposal, newest first, one row kept. */
export async function loadProposalApprovalEvidence(
  orgId: string,
  proposalIds: string[],
): Promise<Map<string, ProposalApprovalEvidence>> {
  const found = new Map<string, ProposalApprovalEvidence>();
  if (proposalIds.length === 0) return found;
  const rows = await prisma.$queryRaw<Array<{ target_id: string; diff: unknown }>>`
    SELECT DISTINCT ON (target_id) target_id, diff
    FROM audit_log
    WHERE org_id = ${orgId}::uuid
      AND deleted_at IS NULL
      AND action IN ('proposal.approved', 'proposal.rfp_approve')
      AND target_id IN (${Prisma.join(proposalIds)})
    ORDER BY target_id, at DESC
  `;
  for (const row of rows) {
    found.set(row.target_id, evidenceFromApprovalDiff(row.diff));
  }
  return found;
}

export async function visibleStatusesForProposals(
  orgId: string,
  rows: Array<{
    id: string;
    status: string;
    approvedAt: Date | null;
    approvedByUserId: string | null;
  }>,
): Promise<Map<string, string>> {
  const claims = rows.filter((row) => row.status === 'approved' || row.status === 'submitted' || row.status === 'won');
  const evidence = await loadProposalApprovalEvidence(
    orgId,
    claims.map((row) => row.id),
  );
  const statuses = new Map<string, string>();
  for (const row of rows) {
    statuses.set(row.id, visibleProposalStatus(row, evidence.get(row.id) ?? null));
  }
  return statuses;
}

export const proposalApprovalRoutes: FastifyPluginAsyncZod = async (server) => {
  // Commercial approval is not RFP ownership and not the Admin role. The
  // approver must be able to see Presales-owned proposals, so this lookup is
  // org-scoped only.
  server.post(
    '/proposals/:id/approve',
    {
      preHandler: [server.requirePermission('proposals:approve')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ProposalApprove,
        response: { 200: Proposal },
      },
    },
    async (req, reply) => {
      const row = await prisma.proposal.findFirst({
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
      });
      if (!row) return reply.notFound('Proposal not found');
      if (row.status !== 'draft' && row.status !== 'review') {
        throw server.httpErrors.conflict(
          'Only a draft or in-review proposal can be approved. Revise a locked proposal into a new draft first.',
        );
      }

      if (!attestationMatchesDecision(req.body.attestation, 'approve')) {
        throw server.httpErrors.badRequest(
          'The attestation does not match the approve decision.',
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string; version: number }>>`
          SELECT status::text AS status, version
          FROM proposals
          WHERE id = ${row.id}::uuid
            AND org_id = ${req.auth.orgId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `;
        const current = locked[0];
        if (!current || (current.status !== 'draft' && current.status !== 'review')) {
          throw server.httpErrors.conflict(
            'Only a draft or in-review proposal can be approved. Revise a locked proposal into a new draft first.',
          );
        }
        if (!attestationMatchesDecision(req.body.attestation, 'approve')) {
          throw server.httpErrors.badRequest(
            'The attestation does not match the approve decision.',
          );
        }
        const changed = await tx.proposal.updateMany({
          where: {
            id: row.id,
            orgId: req.auth.orgId,
            status: { in: ['draft', 'review'] },
            deletedAt: null,
          },
          data: {
            status: 'approved',
            approvedAt: new Date(),
            approvedByUserId: req.auth.userId,
          },
        });
        if (changed.count !== 1) {
          throw server.httpErrors.conflict('Proposal could not be approved from its current status.');
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'proposal.approved',
            targetType: 'proposal',
            targetId: row.id,
            diff: {
              attestation: req.body.attestation,
              decision: 'approve',
              version: current.version,
              previousStatus: current.status,
            },
          },
        });
        return tx.proposal.findFirstOrThrow({ where: { id: row.id } });
      });

      return serializeProposal(updated);
    },
  );

  server.post(
    '/proposals/:id/submit',
    {
      preHandler: [server.requirePermission('proposals:approve')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: ProposalSubmitResult },
      },
    },
    async (req, reply) => {
      const row = await prisma.proposal.findFirst({
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
      });
      if (!row) return reply.notFound('Proposal not found');
      if (row.status !== 'approved' || !row.approvedAt || !row.approvedByUserId) {
        throw server.httpErrors.conflict(
          'Submit only transitions an approved proposal that has a recorded approver.',
        );
      }

      const eventKey = proposalEventKey(row.id, row.version);
      const updated = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{ status: string; approved_at: Date | null; approved_by_user_id: string | null; version: number }>
        >`
          SELECT status::text AS status,
                 approved_at,
                 approved_by_user_id,
                 version
          FROM proposals
          WHERE id = ${row.id}::uuid
            AND org_id = ${req.auth.orgId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `;
        const current = locked[0];
        const audit = await tx.auditLog.findFirst({
          where: {
            orgId: req.auth.orgId,
            targetId: row.id,
            action: { in: [...APPROVAL_AUDIT_ACTIONS] },
            deletedAt: null,
          },
          orderBy: { at: 'desc' },
        });
        const visible = visibleProposalStatus(
          {
            status: current?.status ?? row.status,
            approvedAt: current?.approved_at ?? null,
            approvedByUserId: current?.approved_by_user_id ?? null,
          },
          audit ? evidenceFromApprovalDiff(audit.diff) : null,
        );
        if (visible !== 'approved') {
          throw server.httpErrors.conflict(
            'Submit only transitions an approved proposal whose attestation matches the approve decision.',
          );
        }
        const prior = await tx.auditLog.findFirst({
          where: {
            orgId: req.auth.orgId,
            action: 'proposal.submitted',
            targetId: row.id,
            diff: { path: ['eventKey'], equals: eventKey },
          },
        });
        if (prior) {
          throw server.httpErrors.conflict('This proposal version was already submitted.');
        }
        const changed = await tx.proposal.updateMany({
          where: {
            id: row.id,
            orgId: req.auth.orgId,
            status: 'approved',
            approvedAt: { not: null },
            approvedByUserId: { not: null },
            deletedAt: null,
          },
          data: { status: 'submitted' },
        });
        if (changed.count !== 1) {
          throw server.httpErrors.conflict('Submit is only a transition from approved.');
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'proposal.submitted',
            targetType: 'proposal',
            targetId: row.id,
            diff: { eventKey, version: row.version, opportunityId: row.opportunityId },
          },
        });
        return tx.proposal.findFirstOrThrow({ where: { id: row.id } });
      });

      const fan = await fanOutWebhookEvent(
        req.auth.orgId,
        'proposal.submitted',
        {
          id: updated.id,
          name: updated.name,
          opportunityId: updated.opportunityId,
          version: updated.version,
          eventKey,
        },
        { idempotencyKey: eventKey },
      );

      return { ...serializeProposal(updated), delivery: fan.delivery };
    },
  );

  server.post(
    '/proposals/:id/revise',
    {
      preHandler: [server.requirePermission('proposals:write')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 201: Proposal },
      },
    },
    async (req, reply) => {
      const source = await prisma.proposal.findFirst({
        where: {
          orgId: req.auth.orgId,
          id: req.params.id,
          deletedAt: null,
          ...((await canViewAllRfps(req)) ? {} : { ownerId: req.auth.userId }),
        },
        include: { sections: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      });
      if (!source) return reply.notFound('Proposal not found');

      const created = await prisma.proposal.create({
        data: {
          orgId: req.auth.orgId,
          opportunityId: source.opportunityId,
          name: source.name,
          status: 'draft',
          version: source.version + 1,
          ownerId: source.ownerId,
          dueDate: source.dueDate,
          humanReviewRequired: true,
          sections: {
            create: source.sections.map((section) => ({
              orgId: req.auth.orgId,
              key: section.key,
              title: section.title,
              content: section.content,
              wordCount: section.wordCount,
              aiDrafted: section.aiDrafted,
              sortOrder: section.sortOrder,
              required: section.required,
              humanReviewed: false,
            })),
          },
        },
        include: { sections: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      });

      reply.status(201);
      return {
        ...serializeProposal(created),
        sections: created.sections.map((section) => ({
          id: section.id,
          proposalId: section.proposalId,
          key: section.key as z.infer<typeof ProposalDraftRequest>['sectionKey'],
          title: section.title,
          content: section.content,
          wordCount: section.wordCount,
          aiDrafted: section.aiDrafted,
          sortOrder: section.sortOrder,
          required: section.required,
          createdAt: section.createdAt.toISOString(),
          updatedAt: section.updatedAt.toISOString(),
        })),
      };
    },
  );
}
