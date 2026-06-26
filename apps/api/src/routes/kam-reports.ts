/**
 * kam-reports.ts — KAM KPI roll-ups for managers → directors → VP.
 *
 * Per account, per owner, per country, and a staleness alert. Cross-account
 * reports honor the caller's access scope (B4) via accessibleCompanyIds. KAM
 * metrics key on Company.id (exact); prospections come from the read-mirror.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  KamAccountKpi,
  KamOwnerKpiList,
  KamRollup,
  KamStaleList,
} from '@bidstack/shared';

import { accessibleCompanyIds, assertCompanyVisible } from './kam-access.js';

const DAY_MS = 24 * 60 * 60 * 1000;
function staleThreshold(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}
/** companyId filter clause for cross-account queries (null scope → no filter). */
function companyClause(ids: string[] | null): Prisma.KamInitiativeWhereInput {
  return ids ? { companyId: { in: ids } } : {};
}

export const kamReportRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Per account ──────────────────────────────────────────────────────────
  server.get(
    '/kam/reports/account/:companyId',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        params: z.object({ companyId: z.string().uuid() }),
        querystring: z.object({ staleDays: z.coerce.number().int().min(1).max(365).default(14) }),
        response: { 200: KamAccountKpi },
      },
    },
    async (req) => {
      const { companyId } = req.params;
      await assertCompanyVisible(server, req, companyId);
      const orgId = req.auth.orgId;
      const threshold = staleThreshold(req.query.staleDays);
      const [stageGroups, openTasks, doneTasks, prospectionCount, latest, staleInitiativeCount] =
        await Promise.all([
          prisma.kamInitiative.groupBy({
            by: ['stage'],
            where: { orgId, companyId, deletedAt: null },
            _count: { _all: true },
          }),
          prisma.task.count({ where: { orgId, accountId: companyId, deletedAt: null, status: { not: 'done' } } }),
          prisma.task.count({ where: { orgId, accountId: companyId, deletedAt: null, status: 'done' } }),
          prisma.kamProspection.count({ where: { orgId, companyId, deletedAt: null } }),
          prisma.kamInitiative.findFirst({
            where: { orgId, companyId, deletedAt: null },
            orderBy: { lastActivityAt: 'desc' },
            select: { lastActivityAt: true },
          }),
          prisma.kamInitiative.count({
            where: { orgId, companyId, deletedAt: null, stage: { in: ['initiative', 'lead'] }, lastActivityAt: { lt: threshold } },
          }),
        ]);
      const byStage = { initiative: 0, lead: 0, opportunity: 0, dropped: 0 };
      for (const g of stageGroups) byStage[g.stage] = g._count._all;
      return {
        companyId,
        initiativesByStage: byStage,
        openTasks,
        doneTasks,
        prospectionCount,
        lastActivityAt: latest?.lastActivityAt ? latest.lastActivityAt.toISOString() : null,
        staleInitiativeCount,
      };
    },
  );

  // ── Per owner (prospections done; initiatives worked vs untouched) ────────
  server.get(
    '/kam/reports/owners',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        querystring: z.object({ staleDays: z.coerce.number().int().min(1).max(365).default(14) }),
        response: { 200: KamOwnerKpiList },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const ids = await accessibleCompanyIds(req);
      const clause = companyClause(ids);
      const threshold = staleThreshold(req.query.staleDays);
      const [totalByOwner, workedByOwner, prospByOwner] = await Promise.all([
        prisma.kamInitiative.groupBy({ by: ['ownerId'], where: { orgId, deletedAt: null, ...clause }, _count: { _all: true } }),
        prisma.kamInitiative.groupBy({
          by: ['ownerId'],
          where: { orgId, deletedAt: null, ...clause, lastActivityAt: { gte: threshold } },
          _count: { _all: true },
        }),
        prisma.kamProspection.groupBy({
          by: ['ownerId'],
          where: { orgId, deletedAt: null, ...(ids ? { companyId: { in: ids } } : {}) },
          _count: { _all: true },
        }),
      ]);
      const worked = new Map(workedByOwner.map((g) => [g.ownerId, g._count._all]));
      const prosp = new Map(prospByOwner.map((g) => [g.ownerId, g._count._all]));
      const ownerIds = [...new Set(totalByOwner.map((g) => g.ownerId).filter((x): x is string => !!x))];
      const users = ownerIds.length
        ? await prisma.user.findMany({ where: { id: { in: ownerIds }, orgId }, select: { id: true, name: true }, take: 1000 })
        : [];
      const nameOf = new Map(users.map((u) => [u.id, u.name]));
      const items = totalByOwner.map((g) => {
        const w = worked.get(g.ownerId) ?? 0;
        return {
          ownerId: g.ownerId,
          ownerName: g.ownerId ? (nameOf.get(g.ownerId) ?? null) : null,
          prospectionsDone: prosp.get(g.ownerId) ?? 0,
          initiativesWorked: w,
          initiativesUntouched: g._count._all - w,
        };
      });
      return { staleDays: req.query.staleDays, items };
    },
  );

  // ── Per country (VP roll-up) ──────────────────────────────────────────────
  server.get(
    '/kam/reports/rollup',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: { response: { 200: KamRollup } },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const ids = await accessibleCompanyIds(req);
      const companies = await prisma.company.findMany({
        where: { orgId, deletedAt: null, ...(ids ? { id: { in: ids } } : {}) },
        select: { id: true, countryCode: true },
        take: 1000,
      });
      const countryOf = new Map(companies.map((c) => [c.id, c.countryCode ?? null]));
      const scopedIds = companies.map((c) => c.id);
      const idClause = { companyId: { in: scopedIds } };
      const [initByCompany, oppByCompany, prospByCompany] = await Promise.all([
        prisma.kamInitiative.groupBy({ by: ['companyId'], where: { orgId, deletedAt: null, ...idClause }, _count: { _all: true } }),
        prisma.kamInitiative.groupBy({ by: ['companyId'], where: { orgId, deletedAt: null, stage: 'opportunity', ...idClause }, _count: { _all: true } }),
        prisma.kamProspection.groupBy({ by: ['companyId'], where: { orgId, deletedAt: null, ...idClause }, _count: { _all: true } }),
      ]);
      const buckets = new Map<string | null, { accounts: number; initiatives: number; openOpportunities: number; prospections: number }>();
      const bucket = (country: string | null) => {
        let b = buckets.get(country);
        if (!b) { b = { accounts: 0, initiatives: 0, openOpportunities: 0, prospections: 0 }; buckets.set(country, b); }
        return b;
      };
      for (const c of companies) bucket(c.countryCode ?? null).accounts++;
      for (const g of initByCompany) bucket(countryOf.get(g.companyId!) ?? null).initiatives += g._count._all;
      for (const g of oppByCompany) bucket(countryOf.get(g.companyId!) ?? null).openOpportunities += g._count._all;
      for (const g of prospByCompany) if (g.companyId) bucket(countryOf.get(g.companyId) ?? null).prospections += g._count._all;
      const items = [...buckets.entries()].map(([country, b]) => ({ country, ...b }));
      return { items };
    },
  );

  // ── Staleness alert ────────────────────────────────────────────────────
  server.get(
    '/kam/reports/stale',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        querystring: z.object({ staleDays: z.coerce.number().int().min(1).max(365).default(14) }),
        response: { 200: KamStaleList },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const ids = await accessibleCompanyIds(req);
      const threshold = staleThreshold(req.query.staleDays);
      const rows = await prisma.kamInitiative.findMany({
        where: { orgId, deletedAt: null, stage: { in: ['initiative', 'lead'] }, lastActivityAt: { lt: threshold }, ...companyClause(ids) },
        select: { id: true, title: true, companyId: true, stage: true, lastActivityAt: true },
        orderBy: { lastActivityAt: 'asc' },
        take: 200,
      });
      const now = Date.now();
      return {
        staleDays: req.query.staleDays,
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          companyId: r.companyId,
          stage: r.stage,
          lastActivityAt: r.lastActivityAt.toISOString(),
          daysStale: Math.floor((now - r.lastActivityAt.getTime()) / DAY_MS),
        })),
      };
    },
  );
};
