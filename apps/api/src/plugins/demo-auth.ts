/**
 * demo-auth.ts — public passwordless "try the demo" door.
 *
 * ⚠️  SECURITY: this arms a PUBLIC, no-password sign-in. It is triple-gated and
 * must NEVER run alongside real auth:
 *   1. DEMO_MODE=true must be explicitly set.
 *   2. CLERK_SECRET_KEY must be ABSENT (enforced at boot — env.ts + auth.ts).
 *   3. DEMO_SESSION_SECRET must be set (the HMAC key for session tokens).
 *
 * Each visitor email maps to its OWN freshly-seeded org (see seedOrgData), so
 * visitors never see each other's data. Sessions are short-lived signed Bearer
 * tokens (HMAC-SHA256), matching the app's existing `Authorization: Bearer`
 * model — there is no cookie layer to hang an httpOnly session on. Stale demo
 * orgs are reaped lazily on each new sign-in (no cron needed).
 *
 * SEC-1: an email is a guess, not a credential. Re-entering an ALREADY
 * provisioned workspace therefore requires a resume proof — a demo token this
 * server signed for that exact visitor. Without it the request is refused
 * (DEMO_EMAIL_CLAIMED) instead of being handed an admin session for someone
 * else's workspace and their uploaded documents.
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { Prisma, prisma, seedOrgData } from '@bidstack/db';

import { enqueueApolloEnrich } from '../queues/company-enrich-apollo.js';

import type { AuthContext } from './auth.js';

/** Every demo org's clerkOrg starts with this — the reaper + dedup key off it. */
const DEMO_ORG_PREFIX = 'demo_org_';
const TOKEN_TTL_SECONDS = 2 * 60 * 60; // 2h sessions

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

function demoSecret(): string {
  const s = process.env.DEMO_SESSION_SECRET;
  if (!s) throw new Error('DEMO_SESSION_SECRET is not set');
  return s;
}

interface TokenPayload {
  /** userId */ u: string;
  /** orgId */ o: string;
  /** expiry (epoch seconds) */ exp: number;
}

/** Sign a short-lived demo session token: `demo_<base64url(payload)>.<sig>`. */
export function signDemoToken(userId: string, orgId: string): string {
  const payload: TokenPayload = {
    u: userId,
    o: orgId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', demoSecret()).update(body).digest('base64url');
  return `demo_${body}.${sig}`;
}

/**
 * Verify the HMAC + shape of a demo token. `allowExpired` is used ONLY by the
 * resume-proof check below (re-entry to a workspace the caller already held a
 * token for); request authentication always runs the strict path.
 */
function decodeDemoToken(token: string, allowExpired = false): TokenPayload | null {
  if (!token.startsWith('demo_')) return null;
  const rest = token.slice('demo_'.length);
  const dot = rest.indexOf('.');
  if (dot < 0) return null;
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);

  const expected = createHmac('sha256', demoSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number') return null;
  if (!allowExpired && payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.u !== 'string' || typeof payload.o !== 'string') return null;
  return payload;
}

/** Verify + decode a demo token. Returns null on bad signature or expiry. */
export function verifyDemoToken(token: string): TokenPayload | null {
  return decodeDemoToken(token);
}

/** Resolve a demo Bearer token to an AuthContext (called by the auth plugin). */
export async function resolveDemoAuth(req: FastifyRequest): Promise<AuthContext> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw req.server.httpErrors.unauthorized('Missing Authorization header');

  const payload = verifyDemoToken(token);
  if (!payload) throw req.server.httpErrors.unauthorized('Invalid or expired demo session');

  const user = await prisma.user.findFirst({
    where: { id: payload.u, orgId: payload.o, deletedAt: null },
    select: { id: true, orgId: true, role: true, email: true },
  });
  if (!user) throw req.server.httpErrors.unauthorized('Demo session user not found');

  return {
    orgId: user.orgId,
    userId: user.id,
    scopes: ['read', 'write'],
    role: user.role,
    email: user.email ?? undefined,
  };
}

/** Delete demo orgs older than DEMO_ORG_TTL_HOURS (cascades to all their data). */
async function reapStaleDemoOrgs(): Promise<void> {
  const ttlHours = Number(process.env.DEMO_ORG_TTL_HOURS) || 24;
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);
  await prisma.org.deleteMany({
    where: { clerkOrg: { startsWith: DEMO_ORG_PREFIX }, createdAt: { lt: cutoff } },
  });
}

/**
 * Optionally kick off a LIVE Apollo enrichment refresh for the freshly-seeded
 * companies. Off by default (the seed already ships realistic employee/revenue
 * values) so a public demo doesn't burn Apollo credits per visitor. Enable with
 * DEMO_AUTO_ENRICH=true once APOLLO_API_KEY + BIDSTACK_JOB_SIGNING_SECRET are
 * set — the worker then overwrites the seeded rows with provider data. Failures
 * are swallowed (enqueue is best-effort) so they can never block sign-in.
 */
async function maybeAutoEnrich(orgId: string): Promise<void> {
  if (process.env.DEMO_AUTO_ENRICH !== 'true') return;
  try {
    const companies = await prisma.company.findMany({
      where: { orgId },
      select: { name: true, domain: true },
      take: 50,
    });
    for (const c of companies) {
      await enqueueApolloEnrich({
        orgId,
        companyName: c.name,
        ...(c.domain ? { domain: c.domain } : {}),
      });
    }
  } catch {
    // best-effort — never fail a demo sign-in over enrichment enqueue
  }
}

export interface DemoSession {
  token: string;
  email: string;
  orgId: string;
}

/**
 * Raised when the email already owns a demo workspace and the caller cannot
 * prove it is theirs. Fail-closed: no session is minted (SEC-1).
 */
export const DEMO_EMAIL_CLAIMED = 'DEMO_EMAIL_CLAIMED';

/**
 * Re-signin lookup: resolve a visitor already provisioned under a demo org by
 * email. Used only to decide between "resume with proof" and "refuse" — the
 * email alone never mints a session. Returns null when the email has no demo
 * org yet (the caller then provisions a fresh one).
 */
async function findDemoVisitor(
  normalizedEmail: string,
): Promise<{ id: string; orgId: string } | null> {
  return prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      deletedAt: null,
      org: { clerkOrg: { startsWith: DEMO_ORG_PREFIX } },
    },
    select: { id: true, orgId: true },
  });
}

/**
 * A resume proof is a demo token THIS server signed for THIS visitor. Expiry is
 * tolerated: an expired token still proves the caller once held the session, and
 * the workspace itself dies with DEMO_ORG_TTL_HOURS. Signature, user and org
 * must all match — a forged or foreign token proves nothing.
 */
function isResumeProof(
  proof: string | null | undefined,
  visitor: { id: string; orgId: string },
): boolean {
  if (!proof) return false;
  const payload = decodeDemoToken(proof, true);
  return payload !== null && payload.u === visitor.id && payload.o === visitor.orgId;
}

/**
 * Provision (or resume) a demo org for `email` and return a signed session token.
 *
 * A NEW email always gets a fresh seeded org. An email that already has one is
 * only re-entered when `resumeProof` (the caller's existing demo Bearer token)
 * matches that visitor — otherwise DEMO_EMAIL_CLAIMED is thrown, because the
 * seeded visitor is an org admin and their workspace holds whatever they
 * uploaded.
 *
 * Provisioning is atomic:
 *  - org.create + seedOrgData run in one interactive transaction, so a failed
 *    seed rolls back the org (no orphaned empty workspace).
 *  - a concurrent sign-in that wins the User.email unique index surfaces P2002;
 *    the loser resumes only if it can prove ownership, else it is refused.
 */
export async function provisionDemoSession(
  email: string,
  name?: string,
  resumeProof?: string | null,
): Promise<DemoSession> {
  const normalized = email.trim().toLowerCase();
  await reapStaleDemoOrgs();

  const existing = await findDemoVisitor(normalized);
  if (existing) {
    if (!isResumeProof(resumeProof, existing)) throw new Error(DEMO_EMAIL_CLAIMED);
    return {
      token: signDemoToken(existing.id, existing.orgId),
      email: normalized,
      orgId: existing.orgId,
    };
  }

  // Capacity guard — keeps a public demo from being used to mass-create orgs.
  const maxOrgs = Number(process.env.DEMO_MAX_ORGS) || 500;
  const count = await prisma.org.count({ where: { clerkOrg: { startsWith: DEMO_ORG_PREFIX } } });
  if (count >= maxOrgs) throw new Error('DEMO_AT_CAPACITY');

  const slug = randomUUID().replace(/-/g, '').slice(0, 12);

  let org: { id: string };
  try {
    // Atomic: a seed failure rolls back the org so it can never orphan empty.
    org = await prisma.$transaction(
      async (tx) => {
        const created = await tx.org.create({
          data: { clerkOrg: `${DEMO_ORG_PREFIX}${slug}`, name: 'Polo PreSales Demo Workspace' },
        });
        await seedOrgData(tx, created.id, {
          ownerEmail: normalized,
          ownerName: name,
          namespace: slug,
        });
        return created;
      },
      { timeout: 30000 },
    );
  } catch (err) {
    // A concurrent sign-in already provisioned this visitor and won the
    // User.email unique index. Same rule as above: resume only on proof, so a
    // race cannot be used as a side door into an existing workspace.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await findDemoVisitor(normalized);
      if (raced) {
        if (!isResumeProof(resumeProof, raced)) throw new Error(DEMO_EMAIL_CLAIMED, { cause: err });
        return {
          token: signDemoToken(raced.id, raced.orgId),
          email: normalized,
          orgId: raced.orgId,
        };
      }
    }
    throw err;
  }

  const visitor = await prisma.user.findFirst({
    where: { orgId: org.id, email: normalized },
    select: { id: true },
  });
  if (!visitor) throw new Error('demo provisioning failed: visitor user missing after seed');

  await maybeAutoEnrich(org.id);

  return { token: signDemoToken(visitor.id, org.id), email: normalized, orgId: org.id };
}
