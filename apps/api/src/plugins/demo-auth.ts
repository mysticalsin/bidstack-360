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
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { prisma, seedOrgData } from '@bidstack/db';

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

/** Verify + decode a demo token. Returns null on bad signature or expiry. */
export function verifyDemoToken(token: string): TokenPayload | null {
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
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.u !== 'string' || typeof payload.o !== 'string') return null;
  return payload;
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

export interface DemoSession {
  token: string;
  email: string;
  orgId: string;
}

/**
 * Provision (or reuse) a demo org for `email` and return a signed session token.
 * Re-signing in with the same email returns to the same workspace; otherwise a
 * fresh org is created and seeded with the curated dataset.
 */
export async function provisionDemoSession(email: string, name?: string): Promise<DemoSession> {
  const normalized = email.trim().toLowerCase();
  await reapStaleDemoOrgs();

  // Re-signin: reuse the visitor's existing demo org so they land back in their
  // own workspace rather than spawning a duplicate (and colliding on the unique
  // User.email index).
  const existing = await prisma.user.findFirst({
    where: { email: normalized, org: { clerkOrg: { startsWith: DEMO_ORG_PREFIX } } },
    select: { id: true, orgId: true },
  });
  if (existing) {
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
  const org = await prisma.org.create({
    data: { clerkOrg: `${DEMO_ORG_PREFIX}${slug}`, name: 'BidStack Demo Workspace' },
  });
  await seedOrgData(prisma, org.id, { ownerEmail: normalized, ownerName: name, namespace: slug });

  const visitor = await prisma.user.findFirst({
    where: { orgId: org.id, email: normalized },
    select: { id: true },
  });
  if (!visitor) throw new Error('demo provisioning failed: visitor user missing after seed');

  return { token: signDemoToken(visitor.id, org.id), email: normalized, orgId: org.id };
}
