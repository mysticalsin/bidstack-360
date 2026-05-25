// Help center feedback route — anonymous, no PII stored.
// Records whether an article was helpful and an optional comment.
// This data is used to surface low-quality articles in the admin panel.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

const FeedbackBody = z.object({
  helpful: z.boolean(),
  comment: z.string().max(1000).optional(),
});

const FeedbackResult = z.object({ ok: z.boolean() });

export const helpRoutes: FastifyPluginAsyncZod = async (server) => {
  // POST /help/articles/:slug/feedback
  // Stored in AuditLog with type="help_feedback" — lightweight, reuses existing table.
  // No personal identifiers: userId is intentionally omitted from the log row.
  server.post(
    '/help/articles/:slug/feedback',
    {
      schema: {
        params: z.object({ slug: z.string().max(200) }),
        body: FeedbackBody,
        response: { 200: FeedbackResult },
      },
    },
    async (req) => {
      const { slug } = req.params;
      const { helpful, comment } = req.body;

      // Write to audit_logs with a neutral actor (orgId only, no userId)
      // so we can aggregate per-article feedback without linking to a user.
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId ?? null,
          action: 'help.feedback',
          targetType: 'help_article',
          targetId: slug,
          diff: { helpful, comment: comment ?? null },
        },
      });

      return { ok: true };
    },
  );
};
