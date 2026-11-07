/**
 * Route-level enforcement of the published access policy (factory slice 5).
 *
 * Runs only after the RBAC matrix already allowed the request, so a policy can
 * narrow access and never widen it. Off unless ACCESS_POLICIES_ENFORCE=true.
 * The record is not loaded at this point, so record conditions (country) never
 * trigger a deny here; subject, action, resource type, sensitivity and time do.
 */
import type { FastifyRequest } from 'fastify';

import { prisma } from '@bidstack/db';
import {
  AccessPolicyRulesSchema,
  accessPolicyResourceFor,
  evaluateAccessPolicy,
  type AccessPolicyRule,
  type AccessPolicySubject,
  type PermissionKey,
} from '@bidstack/shared';

import { createLogger } from './logger.js';

const log = createLogger({ name: 'access-policy-enforcement' });

const CACHE_TTL_MS = 15_000;
const MAX_SUBJECT_ENTRIES = 5_000;
const SUBJECT_ROW_CAP = 1_000;

interface PublishedPolicy {
  version: number | null;
  rules: AccessPolicyRule[];
}

const policyCache = new Map<string, { value: PublishedPolicy; expiresAt: number }>();
const subjectCache = new Map<string, { value: AccessPolicySubject; expiresAt: number }>();

export function accessPolicyEnforcementEnabled(): boolean {
  return process.env.ACCESS_POLICIES_ENFORCE === 'true';
}

export function invalidateAccessPolicyCache(orgId: string): void {
  policyCache.delete(orgId);
  for (const key of subjectCache.keys()) if (key.startsWith(`${orgId}:`)) subjectCache.delete(key);
}

export function parseStoredRules(raw: unknown): AccessPolicyRule[] {
  const parsed = AccessPolicyRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export async function loadPublishedPolicy(orgId: string): Promise<PublishedPolicy> {
  const hit = policyCache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const row = await prisma.accessPolicyVersion.findFirst({
    where: { orgId, status: 'published' },
    select: { id: true, version: true, rules: true },
  });
  const rules = row ? parseStoredRules(row.rules) : [];
  if (row && rules.length === 0 && Array.isArray(row.rules) && row.rules.length > 0) {
    log.error({ orgId, policyId: row.id }, 'published access policy failed validation; matrix applies');
  }
  const value = { version: row?.version ?? null, rules };
  policyCache.set(orgId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Role names, team (user group) names and the team countries of each user. */
export async function loadPolicySubjects(
  orgId: string,
  userIds: readonly string[],
): Promise<Map<string, AccessPolicySubject>> {
  const out = new Map<string, AccessPolicySubject>();
  if (userIds.length === 0) return out;
  const [roles, groups] = await Promise.all([
    prisma.userRole.findMany({
      where: { orgId, userId: { in: [...userIds] }, deletedAt: null, role: { deletedAt: null } },
      select: { userId: true, role: { select: { name: true } } },
      take: SUBJECT_ROW_CAP,
    }),
    prisma.userGroupMember.findMany({
      where: { orgId, userId: { in: [...userIds] } },
      select: { userId: true, group: { select: { name: true, scopeCountries: true } } },
      take: SUBJECT_ROW_CAP,
    }),
  ]);
  for (const id of userIds) out.set(id, { roles: [], teams: [], countries: [] });
  for (const r of roles) (out.get(r.userId)!.roles as string[]).push(r.role.name);
  for (const g of groups) {
    const s = out.get(g.userId)!;
    (s.teams as string[]).push(g.group.name);
    (s.countries as string[]).push(...g.group.scopeCountries.map((c) => c.toUpperCase()));
  }
  return out;
}

async function subjectFor(orgId: string, userId: string): Promise<AccessPolicySubject> {
  const key = `${orgId}:${userId}`;
  const hit = subjectCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = (await loadPolicySubjects(orgId, [userId])).get(userId)!;
  if (subjectCache.size >= MAX_SUBJECT_ENTRIES) subjectCache.clear();
  subjectCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Throws 403 when the published policy narrows a request the matrix allowed. */
export async function enforceAccessPolicy(req: FastifyRequest, permission: PermissionKey): Promise<void> {
  if (!accessPolicyEnforcementEnabled()) return;
  const resource = accessPolicyResourceFor(permission, req.url);
  if (!resource) return;
  const policy = await loadPublishedPolicy(req.auth.orgId);
  if (policy.rules.length === 0) return;
  const decision = evaluateAccessPolicy({
    rules: policy.rules,
    matrixAllows: true,
    subject: await subjectFor(req.auth.orgId, req.auth.userId),
    action: permission,
    resource: { type: resource },
    at: new Date(),
    resourceAttributes: 'unknown',
  });
  if (decision.allowed) return;
  const rule = decision.ruleId ? ` (rule ${decision.ruleId})` : '';
  throw req.server.httpErrors.forbidden(`Denied by access policy v${policy.version ?? '?'}${rule}`);
}
