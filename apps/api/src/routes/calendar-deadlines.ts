/**
 * Calendar deadlines — read-only aggregate of bid/proposal due dates.
 *
 * WHY: the calendar only showed synced Google/MS meetings, so RFP submission
 * deadlines (Opportunity.dueDate, Proposal.dueDate) were invisible in the one
 * place a bid team plans its week. This endpoint merges both sources for a
 * date window so the web calendar can render an all-day "Deadlines" lane.
 *
 * Multi-tenancy: org-scoped via req.auth — never from the client. Proposals
 * additionally honor RFP visibility (non-admins only see the ones they own),
 * matching routes/proposals.ts.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

import { canViewAllRfps } from '../lib/rfp-visibility.js';

const DeadlineQuery = z.object({
  /** Inclusive start of the window (date-only — dueDate columns are @db.Date). */
  from: z.string().date(),
  /** Exclusive end of the window. */
  to: z.string().date(),
});

const DeadlineItem = z.object({
  kind: z.enum(['opportunity', 'proposal']),
  id: z.string().uuid(),
  name: z.string(),
  /** Opportunity customer — null for proposals. */
  customer: z.string().nullable(),
  /** Opportunity code (OP-NNNN) — null for proposals. */
  code: z.string().nullable(),
  /** YYYY-MM-DD; date-only so clients bucket by calendar day, not timezone. */
  dueDate: z.string().date(),
});

const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);

export const calendarDeadlineRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/calendar/deadlines',
    {
      preHandler: [server.requirePermission('opportunities:read')],
      schema: {
        querystring: DeadlineQuery,
        response: { 200: z.object({ items: z.array(DeadlineItem) }) },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const from = new Date(req.query.from);
      const to = new Date(req.query.to);
      if (!(from < to)) {
        throw server.httpErrors.badRequest('`from` must be before `to`');
      }

      const [opportunities, proposals] = await Promise.all([
        prisma.opportunity.findMany({
          where: {
            orgId,
            deletedAt: null,
            dueDate: { gte: from, lt: to },
            // Closed bids have no live deadline — filter on BOTH the legacy
            // stage enum and the Phase-5 pipelineStage flags, since either may
            // be the source of truth depending on the org's data vintage.
            stage: { notIn: ['closed_won', 'closed_lost'] },
            OR: [{ pipelineStageId: null }, { pipelineStage: { isWon: false, isLost: false } }],
          },
          orderBy: { dueDate: 'asc' },
          take: 200,
          select: { id: true, code: true, customer: true, name: true, dueDate: true },
        }),
        prisma.proposal.findMany({
          where: {
            orgId,
            deletedAt: null,
            dueDate: { gte: from, lt: to },
            status: { notIn: ['won', 'lost'] },
            ...(canViewAllRfps(req) ? {} : { ownerId: req.auth.userId }),
          },
          orderBy: { dueDate: 'asc' },
          take: 200,
          select: { id: true, name: true, dueDate: true },
        }),
      ]);

      const items = [
        ...opportunities.map((o) => ({
          kind: 'opportunity' as const,
          id: o.id,
          name: o.name,
          customer: o.customer,
          code: o.code,
          // dueDate is non-null here — the range filter excludes null rows.
          dueDate: toDateOnly(o.dueDate as Date),
        })),
        ...proposals.map((p) => ({
          kind: 'proposal' as const,
          id: p.id,
          name: p.name,
          customer: null,
          code: null,
          dueDate: toDateOnly(p.dueDate as Date),
        })),
      ].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));

      return { items };
    },
  );
};
