/**
 * Cloudflare Access → Polo identity.
 *
 * The preview Worker already verifies the Access JWT and may forward
 * `Cf-Access-Authenticated-User-Email`. The box API is loopback-only, so we
 * accept that verified email from localhost. If a JWT is present we re-verify
 * it against the team JWKS so a non-loopback deploy cannot spoof the header.
 */
import { createHash, createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { prisma } from '@bidstack/db';

import {
  displayNameFromEmail,
  findAllowedUser,
  parseAllowedUsers,
  type AllowedUser,
} from '../lib/allowed-users.js';
import { realOrgClerkId } from '../lib/polo-mode.js';
import { invalidateRbacDecisionCache } from '../lib/rbac-decision-cache.js';
import type { AuthContext } from './auth.js';
import { writeAuthAudit } from './auth-audit.js';

export const CF_ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email';
export const CF_ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
export const CF_ACCESS_NOT_ALLOWLISTED = 'This Cloudflare Access identity is not on the Polo allowlist.';

export interface CfAccessIdentity {
  email: string;
  name?: string;
}

export type CfAccessVerifier = (token: string) => Promise<CfAccessIdentity>;

let verifierOverride: CfAccessVerifier | null = null;
const jwksCache = new Map<string, { keys: JsonWebKeyWithKid[]; expiresAt: number }>();

interface JsonWebKeyWithKid extends JsonWebKey {
  kid?: string;
  alg?: string;
}

export function __setCfAccessVerifierForTests(fn: CfAccessVerifier | null): void {
  verifierOverride = fn;
}

export function __clearCfAccessJwksCacheForTests(): void {
  jwksCache.clear();
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

function b64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

export async function verifyCfAccessJwt(
  token: string,
  opts: { teamDomain: string; audience: string },
): Promise<CfAccessIdentity> {
  if (verifierOverride) return verifierOverride(token);

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('malformed_cf_access_jwt');
  }
  let header: { alg?: string; kid?: string };
  let payload: { email?: string; common_name?: string; name?: string; aud?: string | string[]; iss?: string; exp?: number };
  try {
    header = JSON.parse(b64urlToBuffer(parts[0]).toString('utf8')) as typeof header;
    payload = JSON.parse(b64urlToBuffer(parts[1]).toString('utf8')) as typeof payload;
  } catch {
    throw new Error('malformed_cf_access_jwt');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unsupported_cf_access_jwt');

  const team = opts.teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const issuer = `https://${team}`;
  const cacheKey = team;
  let cached = jwksCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error('cf_access_jwks_unavailable');
    const body = (await res.json()) as { keys?: JsonWebKeyWithKid[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('cf_access_jwks_empty');
    cached = { keys: body.keys, expiresAt: Date.now() + 3_600_000 };
    jwksCache.set(cacheKey, cached);
  }
  const jwk = cached.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('cf_access_kid_unknown');

  const verify = createVerify('RSA-SHA256');
  verify.update(`${parts[0]}.${parts[1]}`);
  verify.end();
  const pem = jwkToPem(jwk);
  if (!verify.verify(pem, b64urlToBuffer(parts[2]))) {
    throw new Error('cf_access_signature_invalid');
  }

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(opts.audience)) throw new Error('cf_access_aud_mismatch');
  if (payload.iss !== issuer) throw new Error('cf_access_iss_mismatch');
  if (!payload.exp || payload.exp <= now) throw new Error('cf_access_expired');

  const email = (payload.email ?? payload.common_name ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('cf_access_email_missing');
  return { email, name: payload.name };
}

function jwkToPem(jwk: JsonWebKey): string {
  return createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }).toString();
}

export async function resolveCfAccessIdentity(req: FastifyRequest): Promise<CfAccessIdentity> {
  const jwt = headerValue(req, CF_ACCESS_JWT_HEADER);
  const team = process.env.CF_ACCESS_TEAM_DOMAIN?.trim() ?? '';
  const audience = process.env.CF_ACCESS_AUD?.trim() ?? '';
  if (jwt && team && audience) {
    return verifyCfAccessJwt(jwt, { teamDomain: team, audience });
  }

  const email = headerValue(req, CF_ACCESS_EMAIL_HEADER)?.toLowerCase();
  const trustLoopback = process.env.CF_ACCESS_TRUST_LOOPBACK_EMAIL !== 'false';
  if (email && trustLoopback && isLoopback(req.ip)) {
    return { email };
  }

  throw req.server.httpErrors.unauthorized('Cloudflare Access identity required');
}

export async function verifyCfAccessAuth(req: FastifyRequest): Promise<AuthContext> {
  const identity = await resolveCfAccessIdentity(req);
  let allowlist: AllowedUser[];
  try {
    allowlist = parseAllowedUsers(process.env.POLO_ALLOWED_USERS);
  } catch {
    throw req.server.httpErrors.serviceUnavailable('POLO_ALLOWED_USERS is not configured correctly');
  }
  const allowed = findAllowedUser(identity.email, allowlist);
  if (!allowed) {
    req.log.warn(
      { userDomain: identity.email.split('@')[1] ?? null, allowedCount: allowlist.length },
      'cf-access allowlist rejected',
    );
    throw req.server.httpErrors.forbidden(CF_ACCESS_NOT_ALLOWLISTED);
  }

  const clerkOrg = realOrgClerkId();
  const org = await prisma.org.findUnique({ where: { clerkOrg } });
  if (!org) {
    throw req.server.httpErrors.serviceUnavailable(
      `CF Access org "${clerkOrg}" is not registered — run pnpm db:seed:prod`,
    );
  }

  const clerkUser = `cfaccess:${allowed.email}`;
  const name = identity.name?.trim() || displayNameFromEmail(allowed.email);

  const existing = await prisma.user.findUnique({
    where: { clerkUser },
    select: { id: true, orgId: true, role: true, email: true },
  });
  if (existing && existing.orgId !== org.id) {
    throw req.server.httpErrors.forbidden('User is already registered in another organization');
  }

  const user = await prisma.user.upsert({
    where: { clerkUser },
    create: {
      orgId: org.id,
      clerkUser,
      email: allowed.email,
      name,
      role: allowed.legacyRole,
    },
    update: { name, role: allowed.legacyRole, email: allowed.email },
  });

  await ensureSystemRoleGrant(user.id, org.id, allowed.role, req);

  if (!existing) {
    await writeAuthAudit(req, {
      action: 'auth.login',
      orgId: org.id,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      diff: { source: 'cf_access', role: allowed.role, newUser: true },
    });
  }

  return {
    orgId: org.id,
    userId: user.id,
    scopes: ['read', 'write'],
    role: user.role,
    email: allowed.email,
  };
}

export async function ensureSystemRoleGrant(
  userId: string,
  orgId: string,
  roleName: string,
  req: FastifyRequest,
): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { orgId, name: roleName, isSystem: true, deletedAt: null },
    select: { id: true },
  });
  if (!role) {
    req.log.warn({ orgId, userId, roleName }, 'CF Access role grant skipped: system role missing');
    return;
  }
  await prisma.userRole.updateMany({
    where: { userId, roleId: role.id, orgId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id, orgId },
    update: { deletedAt: null },
  });
  invalidateRbacDecisionCache(orgId, userId);
}

/** Stable cache key for a verified CF Access principal. */
export function cfAccessCacheKey(email: string, role: string): string {
  return createHash('sha256').update(`cfaccess|${email}|${role}`).digest('hex');
}
