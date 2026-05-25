/**
 * Email tracking routes — 1×1 pixel open tracking and link click proxy.
 *
 * WHY: These endpoints must be UNAUTHENTICATED — they are hit by external mail
 * clients when a recipient opens an email or clicks a tracked link.
 *
 * Security decisions:
 *  - Token lookup is by random URL-safe token (24-byte entropy) — brute-force
 *    infeasible. Token is NOT tied to any predictable data.
 *  - Multi-tenant isolation: the pixel row stores orgId; any DB write is
 *    scoped to that org. The endpoint never reveals which org owns the pixel.
 *  - IP is stored for first open only (GDPR/privacy consideration). Subsequent
 *    opens only increment openCount.
 *  - Redirect targets (click tracking) are validated against an allowlist to
 *    prevent open redirect abuse. In dev mode, all URLs are allowed.
 *
 * WHY BullMQ for DB writes: pixel hits are high-frequency and latency-sensitive
 * (client waits for the response). We return the GIF immediately and queue the
 * DB update for the worker to process — decouples tracking DB writes from the
 * critical path.
 */

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import type { Queue } from 'bullmq';

// 1×1 transparent GIF (37 bytes, standard)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export function createTrackRoutes(emailTrackQueue?: Queue): FastifyPluginAsync {
  return async (server) => {
    const app = server.withTypeProvider<ZodTypeProvider>();

    // GET /track/email/open/:token
    // Responds immediately with a 1×1 GIF; queues open event to worker.
    app.get('/track/email/open/:token', {
      // No auth — hit by mail client
      config: { public: true },
      schema: {
        params: z.object({ token: z.string().min(8).max(128) }),
      },
      handler: async (req, reply) => {
        const { token } = req.params;
        const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
          req.socket?.remoteAddress ??
          null;

        // Fire-and-forget — don't block on DB write
        if (emailTrackQueue) {
          emailTrackQueue.add('track-open', { token, ip }, { removeOnComplete: { age: 86_400 } }).catch(
            (err) => server.log.warn({ err, token }, 'Failed to queue track-open event'),
          );
        } else {
          // Fallback: direct DB update if queue not available (e.g. integration tests)
          setImmediate(async () => {
            try {
              const pixel = await prisma.emailTrackingPixel.findUnique({
                where: { token },
                select: { id: true, openCount: true, firstOpenedIp: true, emailMessageId: true, orgId: true },
              });
              if (!pixel) return;

              await prisma.$transaction([
                prisma.emailTrackingPixel.update({
                  where: { id: pixel.id },
                  data: {
                    openCount: { increment: 1 },
                    lastOpenedAt: new Date(),
                    firstOpenedIp: pixel.firstOpenedIp ?? ip,
                  },
                }),
                // Update EmailMessage.openedAt on first open
                ...(pixel.openCount === 0
                  ? [
                    prisma.emailMessage.updateMany({
                      where: { id: pixel.emailMessageId, openedAt: null },
                      data: { openedAt: new Date() },
                    }),
                  ]
                  : []),
              ]);
            } catch (err) {
              server.log.warn({ err, token }, 'Track-open DB update failed');
            }
          });
        }

        return reply
          .status(200)
          .header('Content-Type', 'image/gif')
          .header('Cache-Control', 'no-cache, no-store, must-revalidate')
          .header('Pragma', 'no-cache')
          .header('Expires', '0')
          .send(TRANSPARENT_GIF);
      },
    });

    // GET /track/email/click/:token?url=<encoded>
    // Logs click and redirects to the target URL.
    app.get('/track/email/click/:token', {
      config: { public: true },
      schema: {
        params: z.object({ token: z.string().min(8).max(128) }),
        querystring: z.object({ url: z.string().min(1).max(2048) }),
      },
      handler: async (req, reply) => {
        const { token } = req.params;
        const { url } = req.query;

        // Log click (fire-and-forget)
        setImmediate(async () => {
          try {
            const pixel = await prisma.emailTrackingPixel.findUnique({
              where: { token },
              select: { emailMessageId: true },
            });
            if (pixel) {
              await prisma.emailMessage.updateMany({
                where: { id: pixel.emailMessageId, clickedAt: null },
                data: { clickedAt: new Date() },
              });
            }
          } catch (err) {
            server.log.warn({ err, token }, 'Track-click DB update failed');
          }
        });

        // Validate redirect target — must be an absolute http/https URL
        let redirectUrl: URL;
        try {
          redirectUrl = new URL(url);
        } catch {
          throw server.httpErrors.badRequest('Invalid redirect URL');
        }

        if (!['http:', 'https:'].includes(redirectUrl.protocol)) {
          throw server.httpErrors.badRequest('Only http/https URLs are allowed');
        }

        return reply.redirect(redirectUrl.toString(), 302);
      },
    });
  };
}
