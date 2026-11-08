// Account team (internal staffing and allocation) and account follow, under
// /companies. Reads need companies:read and the company in the caller's access
// scope; team edits need companies:write. Follow is per caller.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  AccountFollowAction,
  AccountFollowState,
  AccountTeam,
  AccountTeamMember,
  AccountTeamMemberCreate,
  AccountTeamMemberPatch,
  UserAllocation,
  type AccountFollowReason,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';

const IdParam = z.object({ id: z.string().uuid() });
const MemberParam = z.object({ id: z.string().uuid(), memberId: z.string().uuid() });

function toDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function fromDay(s: string | null | undefined): Date | null | undefined {
  if (s === undefined) return undefined;
  return s === null ? null : new Date(`${s}T00:00:00.000Z`);
}

function todayUtc(): Date {
  return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

/** Active memberships only: no end date, or an end date today or later. */
function activeWhere(orgId: string): Prisma.AccountTeamMemberWhereInput {
  return {
    orgId,
    OR: [{ endDate: null }, { endDate: { gte: todayUtc() } }],
    company: { deletedAt: null },
  };
}

async function totalsFor(orgId: string, userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.accountTeamMember.groupBy({
    by: ['userId'],
    where: { ...activeWhere(orgId), userId: { in: userIds } },
    _sum: { allocationPct: true },
  });
  return new Map(rows.map((r) => [r.userId, r._sum.allocationPct ?? 0]));
}

type MemberRow = Prisma.AccountTeamMemberGetPayload<{
  include: { user: { select: { name: true; email: true } } };
}>;

function serializeMember(
  m: MemberRow,
  totals: Map<string, number>,
): z.infer<typeof AccountTeamMember> {
  return {
    id: m.id,
    companyId: m.companyId,
    userId: m.userId,
    userName: m.user.name,
    userEmail: m.user.email,
    role: m.role,
    allocationPct: m.allocationPct,
    startDate: toDay(m.startDate),
    endDate: toDay(m.endDate),
    totalAllocationPct: totals.get(m.userId) ?? 0,
    createdAt: m.createdAt.toISOString(),
  };
}

export const accountTeamRoutes: FastifyPluginAsyncZod = async (server) => {
  async function visibleCompany(orgId: string, userId: string, companyId: string) {
    const scope = await getAccessScope(orgId, userId);
    const company = await prisma.company.findFirst({
      where: applyCompanyScope({ id: companyId, orgId, deletedAt: null }, scope),
      select: { id: true, name: true, keyAccountOwnerId: true },
    });
    if (!company) throw server.httpErrors.notFound('Company not found');
    return company;
  }

  async function audit(
    req: { auth: { orgId: string; userId: string } },
    action: string,
    companyId: string,
    diff: Record<string, unknown>,
  ) {
    await prisma.auditLog.create({
      data: {
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        action,
        targetType: 'company',
        targetId: companyId,
        diff: { actorKind: 'user', ...diff } as Prisma.InputJsonValue,
      },
    });
  }

  server.get(
    '/companies/:id/team',
    {
      config: { permission: 'companies:read' },
      schema: { params: IdParam, response: { 200: AccountTeam } },
    },
    async (req) => {
      const company = await visibleCompany(req.auth.orgId, req.auth.userId, req.params.id);
      const [members, owner] = await Promise.all([
        prisma.accountTeamMember.findMany({
          where: { orgId: req.auth.orgId, companyId: company.id },
          include: { user: { select: { name: true, email: true } } },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          take: 200,
        }),
        company.keyAccountOwnerId
          ? prisma.user.findFirst({
              where: { id: company.keyAccountOwnerId, orgId: req.auth.orgId },
              select: { id: true, name: true, email: true },
            })
          : Promise.resolve(null),
      ]);
      const totals = await totalsFor(
        req.auth.orgId,
        members.map((m) => m.userId),
      );
      return {
        keyAccountOwner: owner ? { userId: owner.id, name: owner.name, email: owner.email } : null,
        members: members.map((m) => serializeMember(m, totals)),
      };
    },
  );

  server.post(
    '/companies/:id/team',
    {
      preHandler: [server.requirePermission('companies:write')],
      schema: {
        params: IdParam,
        body: AccountTeamMemberCreate,
        response: { 201: AccountTeamMember },
      },
    },
    async (req, reply) => {
      const company = await visibleCompany(req.auth.orgId, req.auth.userId, req.params.id);
      const user = await prisma.user.findFirst({
        where: { id: req.body.userId, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw server.httpErrors.badRequest('User not found in this workspace');
      const dup = await prisma.accountTeamMember.findFirst({
        where: { orgId: req.auth.orgId, companyId: company.id, userId: user.id },
        select: { id: true },
      });
      if (dup) throw server.httpErrors.conflict('This person is already on the account team');
      const created = await prisma.accountTeamMember.create({
        data: {
          orgId: req.auth.orgId,
          companyId: company.id,
          userId: user.id,
          role: req.body.role,
          allocationPct: req.body.allocationPct ?? null,
          startDate: fromDay(req.body.startDate) ?? null,
          endDate: fromDay(req.body.endDate) ?? null,
          createdById: req.auth.userId,
        },
        include: { user: { select: { name: true, email: true } } },
      });
      await audit(req, 'account_team.add', company.id, {
        memberId: created.id,
        userId: user.id,
        role: created.role,
        allocationPct: created.allocationPct,
      });
      const totals = await totalsFor(req.auth.orgId, [user.id]);
      reply.status(201);
      return serializeMember(created, totals);
    },
  );

  server.patch(
    '/companies/:id/team/:memberId',
    {
      preHandler: [server.requirePermission('companies:write')],
      schema: {
        params: MemberParam,
        body: AccountTeamMemberPatch,
        response: { 200: AccountTeamMember },
      },
    },
    async (req) => {
      const company = await visibleCompany(req.auth.orgId, req.auth.userId, req.params.id);
      const existing = await prisma.accountTeamMember.findFirst({
        where: { id: req.params.memberId, orgId: req.auth.orgId, companyId: company.id },
      });
      if (!existing) throw server.httpErrors.notFound('Team member not found');
      const startDate = fromDay(req.body.startDate);
      const endDate = fromDay(req.body.endDate);
      const nextStart = startDate === undefined ? existing.startDate : startDate;
      const nextEnd = endDate === undefined ? existing.endDate : endDate;
      if (nextStart && nextEnd && nextStart > nextEnd) {
        throw server.httpErrors.badRequest('End date must be on or after the start date');
      }
      await prisma.accountTeamMember.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId },
        data: {
          ...(req.body.role !== undefined && { role: req.body.role }),
          ...(req.body.allocationPct !== undefined && { allocationPct: req.body.allocationPct }),
          ...(startDate !== undefined && { startDate }),
          ...(endDate !== undefined && { endDate }),
        },
      });
      const updated = await prisma.accountTeamMember.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId },
        include: { user: { select: { name: true, email: true } } },
      });
      await audit(req, 'account_team.update', company.id, {
        memberId: existing.id,
        changes: {
          role: { from: existing.role, to: updated.role },
          allocationPct: { from: existing.allocationPct, to: updated.allocationPct },
          startDate: { from: toDay(existing.startDate), to: toDay(updated.startDate) },
          endDate: { from: toDay(existing.endDate), to: toDay(updated.endDate) },
        },
      });
      const totals = await totalsFor(req.auth.orgId, [updated.userId]);
      return serializeMember(updated, totals);
    },
  );

  server.delete(
    '/companies/:id/team/:memberId',
    {
      preHandler: [server.requirePermission('companies:write')],
      schema: { params: MemberParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const company = await visibleCompany(req.auth.orgId, req.auth.userId, req.params.id);
      const existing = await prisma.accountTeamMember.findFirst({
        where: { id: req.params.memberId, orgId: req.auth.orgId, companyId: company.id },
        select: { id: true, userId: true, role: true, allocationPct: true },
      });
      if (!existing) throw server.httpErrors.notFound('Team member not found');
      await prisma.accountTeamMember.deleteMany({
        where: { id: existing.id, orgId: req.auth.orgId },
      });
      await audit(req, 'account_team.remove', company.id, {
        memberId: existing.id,
        userId: existing.userId,
        role: existing.role,
        allocationPct: existing.allocationPct,
      });
      return reply.code(204).send(null);
    },
  );

  server.get(
    '/companies/allocations/:userId',
    {
      config: { permission: 'companies:read' },
      schema: {
        params: z.object({ userId: z.string().uuid() }),
        response: { 200: UserAllocation },
      },
    },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const rows = await prisma.accountTeamMember.findMany({
        where: {
          ...activeWhere(req.auth.orgId),
          userId: req.params.userId,
          company: applyCompanyScope({ orgId: req.auth.orgId, deletedAt: null }, scope),
        },
        select: { companyId: true, allocationPct: true, company: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      // The total covers every active account, including ones outside the
      // caller's scope, so the over-100% warning stays honest.
      const totals = await totalsFor(req.auth.orgId, [req.params.userId]);
      return {
        userId: req.params.userId,
        totalPct: totals.get(req.params.userId) ?? 0,
        accounts: rows.map((r) => ({
          companyId: r.companyId,
          companyName: r.company.name,
          allocationPct: r.allocationPct ?? 0,
        })),
      };
    },
  );

  async function followState(
    orgId: string,
    userId: string,
    company: { id: string; keyAccountOwnerId: string | null },
  ) {
    const [follow, member, ownsOpp] = await Promise.all([
      prisma.accountFollow.findFirst({
        where: { orgId, companyId: company.id, userId },
        select: { muted: true },
      }),
      prisma.accountTeamMember.findFirst({
        where: { ...activeWhere(orgId), companyId: company.id, userId },
        select: { id: true },
      }),
      prisma.opportunity.findFirst({
        where: { orgId, companyId: company.id, ownerId: userId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    const reasons: AccountFollowReason[] = [];
    if (member) reasons.push('team');
    if (company.keyAccountOwnerId === userId) reasons.push('key_account_owner');
    if (ownsOpp) reasons.push('opportunity_owner');
    if (follow && !follow.muted) reasons.push('explicit');
    const muted = follow?.muted ?? false;
    return { following: reasons.length > 0 && !muted, muted, reasons };
  }

  server.get(
    '/companies/:id/follow',
    {
      config: { permission: 'companies:read' },
      schema: { params: IdParam, response: { 200: AccountFollowState } },
    },
    async (req) => {
      const company = await visibleCompany(req.auth.orgId, req.auth.userId, req.params.id);
      return followState(req.auth.orgId, req.auth.userId, company);
    },
  );

  server.put(
    '/companies/:id/follow',
    {
      config: { permission: 'companies:read' },
      schema: { params: IdParam, body: AccountFollowAction, response: { 200: AccountFollowState } },
    },
    async (req) => {
      const company = await visibleCompany(req.auth.orgId, req.auth.userId, req.params.id);
      const where = { companyId_userId: { companyId: company.id, userId: req.auth.userId } };
      const { action } = req.body;
      if (action === 'unfollow') {
        await prisma.accountFollow.deleteMany({
          where: { orgId: req.auth.orgId, companyId: company.id, userId: req.auth.userId },
        });
      } else {
        const muted = action === 'mute';
        await prisma.accountFollow.upsert({
          where,
          create: { orgId: req.auth.orgId, companyId: company.id, userId: req.auth.userId, muted },
          update: { muted },
        });
      }
      return followState(req.auth.orgId, req.auth.userId, company);
    },
  );
};
