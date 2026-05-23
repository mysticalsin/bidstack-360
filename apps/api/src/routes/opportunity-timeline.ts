import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

export const opportunityTimelineRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/opportunities/:id/timeline',
    {
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
      const [auditLogs, tasks, comments] = await Promise.all([
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

      // Sort descending by createdAt, cap at limit
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return { items: items.slice(0, limit) };
    },
  );
};
