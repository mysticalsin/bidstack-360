// Clerk webhook — automatic tenant bootstrap. Until this existed, a brand-new
// Clerk organization could not use the app at all: auth.ts 404s unknown orgs
// ('Organization not registered') and every permission gate 403s until the
// org's system roles are seeded, so go-live required a manual
// `pnpm db:seed:prod` run against the production database.
//
// organization.created  -> Org upsert + system-role/permission seed (one txn)
// organization.updated  -> name sync
// organization.deleted  -> LOG ONLY. Tenant data is never deleted from a
//                          webhook — offboarding is a deliberate operator
//                          action with backups, not a Clerk dashboard click.
//
// Verification: Clerk signs with Svix. signedContent = "{id}.{timestamp}.{body}",
// key = base64(secret after 'whsec_'), HMAC-SHA256 -> base64, sent as
// space-separated "v1,<sig>" candidates in svix-signature. Timestamp is unix
// SECONDS with a ±5 min replay window.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma, seedRolesAndPermissions } from '@bidstack/db';

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export interface ClerkWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export function verifyClerkWebhookSignature(
  rawBody: string,
  headers: ClerkWebhookHeaders,
  secret: string,
  nowMs = Date.now(),
): boolean {
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs / 1000 - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  // Svix secrets are 'whsec_' + base64 key; tolerate a raw base64 secret too.
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (key.length === 0) return false;

  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();

  // svix-signature may carry several space-separated versioned candidates.
  for (const candidate of headers.signature.split(' ')) {
    const [version, sig] = candidate.split(',', 2);
    if (version !== 'v1' || !sig) continue;
    const provided = Buffer.from(sig, 'base64');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return true;
    }
  }
  return false;
}

const ClerkOrgEvent = z.object({
  type: z.string(),
  data: z.object({ id: z.string().min(1), name: z.string().optional() }).passthrough(),
});

function headerValue(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : (value ?? '')).trim();
}

/** Org row + system roles in one transaction — the same rows `pnpm db:seed:prod`
 * creates, so either path (webhook or CLI) leaves an identical, usable tenant. */
async function bootstrapOrg(clerkOrg: string, name: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.org.upsert({
      where: { clerkOrg },
      create: { clerkOrg, name },
      update: {},
    });
    await seedRolesAndPermissions(tx, org.id, new Map());
    return org.id;
  });
}

export const webhooksClerkRoutes: FastifyPluginAsyncZod = async (server) => {
  // Capture raw body for HMAC verification (parser scope = this plugin only).
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const json = body.length ? JSON.parse(body as string) : {};
      (req as unknown as { rawBody: string }).rawBody = body as string;
      done(null, json);
    } catch (err) {
      done(err as Error);
    }
  });

  server.post(
    '/clerk',
    {
      config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: z.record(z.unknown()),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const secret = process.env.CLERK_WEBHOOK_SECRET;
      if (!secret) {
        // Surfaces as a generic 500 to the caller: the error handler masks
        // app-thrown 5xx bodies by design. The log line is the ops signal.
        req.log.warn('clerk webhook dropped — CLERK_WEBHOOK_SECRET unset');
        throw server.httpErrors.serviceUnavailable('CLERK_WEBHOOK_SECRET not configured');
      }

      const headers: ClerkWebhookHeaders = {
        id: headerValue(req.headers['svix-id']),
        timestamp: headerValue(req.headers['svix-timestamp']),
        signature: headerValue(req.headers['svix-signature']),
      };
      if (!headers.id || !headers.timestamp || !headers.signature) {
        req.log.warn('clerk webhook rejected — missing svix headers');
        throw server.httpErrors.badRequest('svix-id, svix-timestamp, svix-signature required');
      }

      const rawBody = (req as unknown as { rawBody: string }).rawBody ?? '';
      if (!verifyClerkWebhookSignature(rawBody, headers, secret)) {
        req.log.warn({ svixId: headers.id }, 'clerk webhook signature mismatch');
        throw server.httpErrors.unauthorized('Invalid signature');
      }

      const parsed = ClerkOrgEvent.safeParse(req.body);
      if (!parsed.success) {
        // Signed-but-unrecognized payload (user.* events etc.): acknowledge so
        // Clerk stops retrying — there is nothing for us to do with it.
        req.log.info({ svixId: headers.id }, 'clerk webhook ignored — not an org event shape');
        return { ok: true as const };
      }
      const { type, data } = parsed.data;
      const name = data.name?.trim() || data.id;

      if (type === 'organization.created') {
        const orgId = await bootstrapOrg(data.id, name);
        req.log.info({ clerkOrg: data.id, orgId }, 'clerk webhook — org bootstrapped');
      } else if (type === 'organization.updated') {
        const res = await prisma.org.updateMany({
          where: { clerkOrg: data.id },
          data: { name },
        });
        if (res.count === 0) {
          // Updated before created ever landed (retry ordering): bootstrap now.
          const orgId = await bootstrapOrg(data.id, name);
          req.log.info({ clerkOrg: data.id, orgId }, 'clerk webhook — org bootstrapped on update');
        }
      } else if (type === 'organization.deleted') {
        req.log.warn(
          { clerkOrg: data.id },
          'clerk webhook — organization.deleted received; tenant data intentionally retained (operator offboarding only)',
        );
      } else {
        req.log.info({ type }, 'clerk webhook ignored — unhandled event type');
      }

      return { ok: true as const };
    },
  );
};
