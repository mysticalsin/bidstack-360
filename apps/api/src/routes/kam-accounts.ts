/**
 * kam-accounts.ts — designate + list + switch Key Accounts.
 *
 * "Key account" = Company.kamStatus != 'identified'. Designation promotes a
 * company off 'identified' (stamping keyAccountSince write-once). Reuses the KAM
 * access guards: cross-account lists honor the caller's scope (B4); the PATCH
 * re-validates the company (B4 + IDOR) and any referenced user (B3 FK-graft).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  KamAccount,
  KamAccountCandidateList,
  KamAccountDesignatePatch,
  KamAccountList,
} from '@bidstack/shared';

import { accessibleCompanyIds, assertCompanyVisible, assertUserInOrg } from './kam-access.js';

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  domain: true,
  countryCode: true,
  industry: true,
  kamStatus: true,
  kamOwnerModel: true,
  directorSponsorId: true,
  keyAccountOwnerId: true,
  keyAccountSince: true,
} satisfies Prisma.CompanySelect;

type AccountRow = Prisma.CompanyGetPayload<{ select: typeof ACCOUNT_SELECT }>;

function toKamAccount(row: AccountRow): z.infer<typeof KamAccount> {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    domain: row.domain,
    countryCode: row.countryCode,
    industry: row.industry,
    kamStatus: row.kamStatus,
    kamOwnerModel: row.kamOwnerModel,
    directorSponsorId: row.directorSponsorId,
    keyAccountOwnerId: row.keyAccountOwnerId,
    keyAccountSince: row.keyAccountSince ? row.keyAccountSince.toISOString() : null,
  };
}

export const kamAccountRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── List designated key accounts (the switcher source) ───────────────────
  server.get(
    '/kam/accounts',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: { response: { 200: KamAccountList } },
    },
    async (req) => {
      const ids = await accessibleCompanyIds(req);
      const rows = await prisma.company.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          kamStatus: { not: 'identified' },
          ...(ids ? { id: { in: ids } } : {}),
        },
        select: ACCOUNT_SELECT,
        orderBy: [{ kamStatus: 'asc' }, { name: 'asc' }],
        take: 200,
      });
      return { items: rows.map(toKamAccount) };
    },
  );

  // ── Typeahead of NOT-yet-key-account companies (designate dialog) ────────
  server.get(
    '/kam/accounts/candidates',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        querystring: z.object({ q: z.string().min(2).max(255) }),
        response: { 200: KamAccountCandidateList },
      },
    },
    async (req) => {
      const ids = await accessibleCompanyIds(req);
      const rows = await prisma.company.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          kamStatus: 'identified',
          ...(ids ? { id: { in: ids } } : {}),
          OR: [
            { name: { contains: req.query.q, mode: 'insensitive' } },
            { domain: { contains: req.query.q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, logoUrl: true, domain: true, industry: true, countryCode: true },
        orderBy: { name: 'asc' },
        take: 8,
      });
      return { items: rows };
    },
  );

  // ── Designate / re-designate / update (the commit) ───────────────────────
  server.patch(
    '/kam/accounts/:companyId',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ companyId: z.string().uuid() }),
        body: KamAccountDesignatePatch,
        response: { 200: KamAccount },
      },
    },
    async (req) => {
      const { companyId } = req.params;
      // B4 scope + IDOR guard FIRST.
      await assertCompanyVisible(server, req, companyId);
      const existing = await prisma.company.findFirst({
        where: { id: companyId, orgId: req.auth.orgId, deletedAt: null },
        select: { kamStatus: true, keyAccountSince: true },
      });
      if (!existing) throw server.httpErrors.notFound('Account not found');

      const body = req.body;
      // B3 FK-graft: a referenced sponsor/owner must belong to this org.
      if (body.directorSponsorId) await assertUserInOrg(server, req, body.directorSponsorId);
      if (body.keyAccountOwnerId) await assertUserInOrg(server, req, body.keyAccountOwnerId);

      // keyAccountSince is stamped write-once on the first promotion off 'identified'.
      const promotingNow =
        existing.kamStatus === 'identified' &&
        body.kamStatus !== undefined &&
        body.kamStatus !== 'identified' &&
        !existing.keyAccountSince;

      const data: Prisma.CompanyUpdateManyMutationInput = {
        ...(body.kamStatus !== undefined ? { kamStatus: body.kamStatus } : {}),
        ...(body.kamOwnerModel !== undefined ? { kamOwnerModel: body.kamOwnerModel } : {}),
        ...(body.directorSponsorId !== undefined ? { directorSponsorId: body.directorSponsorId } : {}),
        ...(body.keyAccountOwnerId !== undefined ? { keyAccountOwnerId: body.keyAccountOwnerId } : {}),
        ...(promotingNow ? { keyAccountSince: new Date() } : {}),
      };
      const flip = await prisma.company.updateMany({
        where: { id: companyId, orgId: req.auth.orgId, deletedAt: null },
        data,
      });
      if (flip.count === 0) throw server.httpErrors.notFound('Account not found');

      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'kam.account.designate',
          targetType: 'company',
          targetId: companyId,
          diff: { ...body, ...(promotingNow ? { keyAccountSince: 'stamped' } : {}) } as object,
        },
      });

      const updated = await prisma.company.findFirstOrThrow({
        where: { id: companyId, orgId: req.auth.orgId },
        select: ACCOUNT_SELECT,
      });
      return toKamAccount(updated);
    },
  );
};
