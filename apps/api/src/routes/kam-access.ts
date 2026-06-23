/**
 * kam-access.ts — shared KAM authorization guards.
 *
 * ONE implementation of the FK-graft guard (B3: a referenced id must belong to
 * the caller's org) and the in-tenant access-scope check (B4: the account must
 * be visible to the caller per their UserGroup scope). Used by every KAM route
 * so the guard can't drift between files.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { prisma } from '@bidstack/db';

import { canReadAccount } from '../lib/account-access.js';

/** Load a company in the caller's org AND confirm it's within their access scope. */
export async function assertCompanyVisible(
  server: FastifyInstance,
  req: FastifyRequest,
  companyId: string,
): Promise<{ id: string; name: string }> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId: req.auth.orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!company) throw server.httpErrors.notFound('Account not found');
  const access = await canReadAccount({
    orgId: req.auth.orgId,
    userId: req.auth.userId,
    companyId,
  });
  if (!access.allowed) throw server.httpErrors.forbidden('Account not in your access scope');
  return company;
}

/** Reject a userId (owner/assignee) that belongs to another tenant. */
export async function assertUserInOrg(
  server: FastifyInstance,
  req: FastifyRequest,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId: req.auth.orgId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw server.httpErrors.badRequest('User must belong to your organization');
}
