/**
 * Microsoft Graph change-notification webhook handler.
 *
 * MS Graph delivers two kinds of HTTP requests to this endpoint:
 *
 *  1. Validation handshake (on subscription create/renew):
 *     GET /... ?validationToken=<url-encoded-token>
 *     Response: 200 text/plain; body = raw validationToken
 *
 *  2. Change notifications (ongoing):
 *     POST /... body = { value: [{ subscriptionId, clientState, changeType, resource, ... }] }
 *     Response: 202 (must be fast — Graph times out at 30 s)
 *
 * Security:
 *  - clientState verified with timingSafeEqual on every notification.
 *  - Unknown subscriptionId → 200 (no information leak) with a warn log.
 *  - Notifications are enqueued; processing is async to stay under 30 s.
 *
 * WHY register without auth middleware prefix:
 *  Graph calls this endpoint as an unauthenticated third party. We must
 *  expose it publicly. The clientState secret provides the verification layer.
 */

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { verifyClientState } from '../../services/microsoft-graph-subscription.service.js';
import { outlookEmailQueue } from '../../queues/email-outlook.js';

const NotificationValueItem = z.object({
  subscriptionId: z.string(),
  clientState: z.string().nullable().optional(),
  changeType: z.string().optional(),
  resource: z.string().optional(),
  resourceData: z.unknown().optional(),
  tenantId: z.string().optional(),
});

const NotificationBody = z.object({
  value: z.array(NotificationValueItem),
});

export const microsoftWebhookRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /integrations/microsoft/webhook
   * Graph subscription validation handshake.
   *
   * WHY GET not POST: Graph sends a GET with ?validationToken=<url-encoded>
   * and expects the raw token back as text/plain within 10 seconds.
   */
  app.get(
    '/integrations/microsoft/webhook',
    {
      // Graph's validation handshake carries no Clerk JWT; the POST below
      // self-verifies via clientState per notification.
      config: { public: true },
      schema: {
        querystring: z.object({ validationToken: z.string().optional() }),
      },
    },
    async (req, reply) => {
      const { validationToken } = req.query;
      if (!validationToken) {
        return reply.status(400).send('validationToken query parameter is required');
      }
      server.log.info('Graph webhook validation handshake received');
      return reply.header('Content-Type', 'text/plain').status(200).send(validationToken);
    },
  );

  /**
   * POST /integrations/microsoft/webhook
   * Receive change notifications from Microsoft Graph.
   */
  app.post(
    '/integrations/microsoft/webhook',
    {
      // Graph sends no Clerk JWT — notifications are authenticated by the
      // per-subscription clientState check in the handler.
      config: { public: true },
      schema: {
        body: NotificationBody,
        response: {
          202: z.object({ received: z.number() }),
        },
      },
    },
    async (req, reply) => {
      const { value: notifications } = req.body;
      let accepted = 0;

      for (const notification of notifications) {
        const sub = await prisma.graphSubscription.findUnique({
          where: { subscriptionId: notification.subscriptionId },
          include: { integrationToken: true },
        });

        if (!sub) {
          // Unknown subscription — could be a stale delivery after deletion.
          // Log as warn but return 200 to stop Graph retrying.
          server.log.warn(
            { subscriptionId: notification.subscriptionId },
            'Graph notification for unknown subscription; ignoring',
          );
          continue;
        }

        const receivedState = notification.clientState ?? '';
        if (!verifyClientState(receivedState, sub.clientState)) {
          // Invalid clientState — potential forgery attempt.
          server.log.warn(
            { subscriptionId: notification.subscriptionId, orgId: sub.orgId },
            'Graph webhook clientState mismatch — notification rejected',
          );
          continue;
        }

        if (sub.integrationToken.status !== 'active') {
          server.log.warn(
            { subscriptionId: notification.subscriptionId, orgId: sub.orgId },
            'Graph notification for inactive token; skipping',
          );
          continue;
        }

        // Enqueue delta pull for the affected user — processing is async
        await outlookEmailQueue.add(
          'email.outlook.pull-incremental',
          {
            orgId: sub.orgId,
            userId: sub.integrationToken.userId,
            integrationTokenId: sub.integrationTokenId,
          },
          {
            jobId: `graph-webhook-${sub.integrationTokenId}-${Date.now()}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
          },
        );

        accepted++;
      }

      server.log.info(
        { total: notifications.length, accepted },
        'Graph webhook notifications processed',
      );

      // 202 Accepted — Graph expects this quickly (< 30 s)
      return reply.status(202).send({ received: accepted });
    },
  );
};
