import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { activityText, auditText } from '@bidstack/db/agent-tools';

import { visibleOpportunityWhere } from '../lib/visible-opportunity.js';

export const opportunityTimelineRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/opportunities/:id/timeline',
    {
      preHandler: [server.requirePermission('opportunities:read')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                kind: z.string(),
                text: z.string(),
                actorName: z.string().nullable(),
                createdAt: z.string().datetime(),
                metadata: z.record(z.unknown()).optional(),
              }),
            ),
            /**
             * True when the merge read one event past `limit` and dropped it.
             * `items` is that page, not every event on the deal.
             */
            timelineContinues: z.boolean().optional(),
          }),
        },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const oppId = req.params.id;
      const limit = req.query.limit;

      // The deal must exist in the org and sit inside the caller's access scope.
      const opp = await prisma.opportunity.findFirst({
        where: await visibleOpportunityWhere(req.auth, oppId),
        select: { id: true, customer: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      // The human-readable summary (text) is safe for anyone with
      // opportunities:read, but the raw audit-log `diff` (before/after field
      // values) is admin-grade data the dedicated audit-log routes gate behind
      // audit-log:read — so only include it in the timeline metadata for callers
      // who hold that permission.
      const canSeeAuditDiff = await server.hasPermission(req, 'audit-log:read');

      // One row past the page the activity panel draws, from each source.
      // The extra row is the probe. It is not shown, and it is not a total.
      const [auditLogs, tasks, comments, activities] = await Promise.all([
        prisma.auditLog.findMany({
          where: { orgId, targetType: 'opportunity', targetId: oppId },
          orderBy: { at: 'desc' },
          take: limit + 1,
          include: { user: { select: { name: true } } },
        }),
        prisma.task.findMany({
          where: { orgId, oppId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          include: { assignee: { select: { name: true } } },
        }),
        prisma.comment.findMany({
          where: { orgId, targetType: 'opportunity', targetId: oppId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          include: { author: { select: { name: true } } },
        }),
        // Chatter feed (Wave 4 Activity model): calls, emails, meetings, notes,
        // stage events recorded as activities. orgId in the where is the
        // cross-tenant guard — entityId alone would read foreign orgs' rows.
        // Compound (occurredAt, id) desc ordering mirrors the activity feed's
        // cursor pattern so ties at the same millisecond stay deterministic.
        prisma.activity.findMany({
          where: { orgId, entityType: 'opportunity', entityId: oppId, deletedAt: null },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          include: { owner: { select: { name: true } } },
        }),
      ]);

      const items: Array<{
        id: string;
        kind: string;
        text: string;
        actorName: string | null;
        createdAt: string;
        metadata?: Record<string, unknown>;
      }> = [];

      for (const log of auditLogs) {
        const text = auditText(log.action, log.diff as Record<string, unknown> | undefined);
        items.push({
          id: `audit-${log.id}`,
          kind: 'audit',
          text,
          actorName: log.user?.name ?? null,
          createdAt: log.at.toISOString(),
          metadata: canSeeAuditDiff
            ? { action: log.action, diff: log.diff }
            : { action: log.action },
        });
      }

      for (const task of tasks) {
        items.push({
          id: `task-${task.id}`,
          kind: 'task',
          text: `Task created: ${task.title}`,
          actorName: task.assignee?.name ?? null,
          createdAt: task.createdAt.toISOString(),
          metadata: { status: task.status, dueDate: task.dueDate },
        });
      }

      for (const comment of comments) {
        items.push({
          id: `comment-${comment.id}`,
          kind: 'comment',
          text: comment.bodyMd.slice(0, 120) + (comment.bodyMd.length > 120 ? '…' : ''),
          actorName: comment.author?.name ?? null,
          createdAt: comment.createdAt.toISOString(),
          metadata: { parentId: comment.parentId },
        });
      }

      for (const activity of activities) {
        items.push({
          // kind carries the Activity type verbatim ('call', 'email', 'note',
          // 'meeting', 'stage_change', …) so the web timeline can pick a
          // per-type icon without a second lookup.
          id: `activity-${activity.id}`,
          kind: activity.type,
          text: activityText(activity),
          // logActivity mirrors actorId into ownerId for user actors; owner is
          // null for system/agent events, which render actor-less by design.
          actorName: activity.owner?.name ?? null,
          // occurredAt, not createdAt: backfilled/replayed events must sort by
          // when they happened or the narrative reads out of order.
          createdAt: activity.occurredAt.toISOString(),
          metadata: {
            source: 'activity',
            status: activity.status,
            actorType: activity.actorType,
          },
        });
      }

      // Sort descending by createdAt with the entry id as tiebreaker — same
      // total-order idea as the activity feed's compound cursor: timestamp
      // ties must not reshuffle between requests.
      items.sort((a, b) => {
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return diff !== 0 ? diff : b.id.localeCompare(a.id);
      });

      // Drop the probe. A later row means this page is not every event.
      const timelineContinues = items.length > limit;
      return { items: timelineContinues ? items.slice(0, limit) : items, timelineContinues };
    },
  );
};
