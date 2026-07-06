import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

// Chatter Activity rows carry their human label in subject (calls/emails/
// meetings) or description (notes). Fall back to a per-type synthesis so a
// bare stage_change/field_edit row still reads as a sentence, never as "".
function activityText(row: {
  type: string;
  subject: string | null;
  description: string | null;
  body: unknown;
}): string {
  if (row.subject) return row.subject;
  if (row.description) {
    return row.description.slice(0, 120) + (row.description.length > 120 ? '…' : '');
  }
  const body = row.body as Record<string, unknown> | null;
  if (
    row.type === 'stage_change' &&
    typeof body?.from === 'string' &&
    typeof body?.to === 'string'
  ) {
    return `Moved from ${body.from} to ${body.to}`;
  }
  return row.type.replace(/_/g, ' ');
}

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
          }),
        },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const oppId = req.params.id;
      const limit = req.query.limit;

      // Verify the opportunity exists and belongs to the org
      const opp = await prisma.opportunity.findFirst({
        where: { id: oppId, orgId, deletedAt: null },
        select: { id: true, customer: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      // Fetch all activity sources in parallel
      const [auditLogs, tasks, comments, activities] = await Promise.all([
        prisma.auditLog.findMany({
          where: { orgId, targetType: 'opportunity', targetId: oppId },
          orderBy: { at: 'desc' },
          take: limit,
          include: { user: { select: { name: true } } },
        }),
        prisma.task.findMany({
          where: { orgId, oppId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { assignee: { select: { name: true } } },
        }),
        prisma.comment.findMany({
          where: { orgId, targetType: 'opportunity', targetId: oppId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: limit,
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
          take: limit,
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
        const action = log.action;
        let text: string;
        const diff = log.diff as Record<string, unknown> | undefined;
        if (action === 'opportunity.create') {
          text = `Created opportunity ${diff?.code ?? ''}`;
        } else if (action === 'opportunity.update') {
          const changed = diff ? Object.keys(diff).join(', ') : 'fields';
          text = `Updated ${changed}`;
        } else if (action === 'opportunity.stage') {
          const from = (diff?.from as string) ?? 'unknown';
          const to = (diff?.to as string) ?? 'unknown';
          text = `Moved from ${from} to ${to}`;
        } else if (action === 'opportunity.delete') {
          text = 'Deleted opportunity';
        } else {
          text = action.replace(/\./g, ' ');
        }
        items.push({
          id: `audit-${log.id}`,
          kind: 'audit',
          text,
          actorName: log.user?.name ?? null,
          createdAt: log.at.toISOString(),
          metadata: { action: log.action, diff: log.diff },
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

      return { items: items.slice(0, limit) };
    },
  );
};
