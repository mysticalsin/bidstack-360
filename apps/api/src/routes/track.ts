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
 *  - Click tracking redirects only to an https URL this process signed for
 *    that token (HMAC-SHA256 over the token, a newline, and the canonical
 *    URL, keyed by EMAIL_CLICK_SIGNING_SECRET). A caller-supplied ?url=
 *    with no matching signature is not a destination. The pixel row still
 *    stores no URL, and no mail producer emits click links yet: with the
 *    secret unset every click stays 404, which is the closed behavior from
 *    the unsigned-redirect refusal. Warn logs record sha256(token) prefix,
 *    never the token.
 *
 * WHY BullMQ for DB writes: pixel hits are high-frequency and latency-sensitive
 * (client waits for the response). We return the GIF immediately and queue the
 * DB update for the worker to process — decouples tracking DB writes from the
 * critical path.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import type { Queue } from 'bullmq';

/** First 8 hex chars of sha256(token). Safe to log; not enough to replay. */
export function trackingTokenLogId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

/**
 * https URL with no userinfo and no CR/LF, or null. The returned string is
 * what both the signer and the redirect must use.
 */
function hasHeaderBreak(value: string): boolean {
  return value.includes('\0') || value.includes('\r') || value.includes('\n');
}

export function canonicalClickTarget(url: string): string | null {
  if (url.length === 0 || url.length > 2048 || hasHeaderBreak(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (hasHeaderBreak(parsed.href)) return null;
  return parsed.href;
}

/** HMAC for a click link. Null when the URL is not a safe https target. */
export function signEmailClickTarget(token: string, url: string, secret: string): string | null {
  const canonical = canonicalClickTarget(url);
  if (!canonical || secret.length === 0) return null;
  return createHmac('sha256', secret).update(`${token}\n${canonical}`).digest('base64url');
}

function clickSignaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

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
        // req.ip already applied trustProxy (hop count or CIDR). The raw
        // X-Forwarded-For prefix is client-controlled even when the peer is public.
        const ip = req.ip || null;
        const tokenId = trackingTokenLogId(token);

        // Fire-and-forget — don't block on DB write
        if (emailTrackQueue) {
          emailTrackQueue.add('track-open', { token, ip }, { removeOnComplete: { age: 86_400 } }).catch(
            (err) => server.log.warn({ err, tokenId }, 'Failed to queue track-open event'),
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
              server.log.warn({ err, tokenId }, 'Track-open DB update failed');
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

    // GET /track/email/click/:token?url=<encoded>&sig=<hmac>
    // The pixel row does not store a destination. Honor ?url= only when sig
    // is the HMAC of this token and the canonical https URL under
    // EMAIL_CLICK_SIGNING_SECRET. Anything else is the same 404 as an
    // unsigned link, including a signature over a different target.
    app.get('/track/email/click/:token', {
      config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ token: z.string().min(8).max(128) }),
        querystring: z.object({
          url: z.string().min(1).max(2048),
          sig: z.string().min(1).max(128).optional(),
        }),
      },
      handler: async (req, reply) => {
        const { token } = req.params;
        const { url, sig } = req.query;
        const secret = process.env.EMAIL_CLICK_SIGNING_SECRET?.trim() ?? '';
        const canonical = canonicalClickTarget(url);
        const expected = canonical ? signEmailClickTarget(token, canonical, secret) : null;
        if (!canonical || !expected || !sig || !clickSignaturesMatch(expected, sig)) {
          throw server.httpErrors.notFound('Click tracking has no registered destination');
        }
        return reply.redirect(canonical, 302);
      },
    });
  };
}
