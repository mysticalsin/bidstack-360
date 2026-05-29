// Lead routing rule routes (authenticated).
//
// Endpoints:
//   GET  /lead-routing-rules          — list active rules (priority-desc)
//   POST /lead-routing-rules          — create a rule
//   PATCH /lead-routing-rules/:id     — update a rule
//   DELETE /lead-routing-rules/:id    — soft-delete
//   POST /lead-routing-rules/evaluate — dry-run match against a lead profile
//
// Territory CRUD + forecast + analytics → territories.ts / territories-forecast.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { LeadRoutingRule, LeadRoutingRuleCreate, LeadRoutingRulePatch } from '@bidstack/shared';
import { tenantEntitiesBelongToOrg, tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';

export const territoriesRoutingRoutes: FastifyPluginAsyncZod = async (server) => {
  const validateRoutingLinks = async (
    orgId: string,
    links: {
      assignToUserId?: string | null;
      assignToTerritoryId?: string | null;
      roundRobinTeam?: readonly string[] | null;
    },
  ) => {
    if (
      links.assignToUserId &&
      !(await tenantEntityBelongsToOrg('user', links.assignToUserId, orgId))
    ) {
      throw server.httpErrors.badRequest('Assigned user does not belong to this organization');
    }
    if (
      links.assignToTerritoryId &&
      !(await tenantEntityBelongsToOrg('territory', links.assignToTerritoryId, orgId))
    ) {
      throw server.httpErrors.badRequest('Assigned territory does not belong to this organization');
    }
    if (
      links.roundRobinTeam &&
      !(await tenantEntitiesBelongToOrg('user', links.roundRobinTeam, orgId))
    ) {
      throw server.httpErrors.badRequest(
        'Round-robin team contains users outside this organization',
      );
    }
  };

  // GET /api/lead-routing-rules
  server.get(
    '/lead-routing-rules',
    {
      schema: { response: { 200: z.object({ items: z.array(LeadRoutingRule) }) } },
    },
    async (req) => {
      const rows = await prisma.leadRoutingRule.findMany({
        where: { orgId: req.auth.orgId, active: true },
        orderBy: { priority: 'desc' },
        take: 500,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          name: r.name,
          active: r.active,
          priority: r.priority,
          criteria: r.criteria as Record<string, unknown>,
          assignToUserId: r.assignToUserId,
          assignToTerritoryId: r.assignToTerritoryId,
          roundRobinTeam: r.roundRobinTeam,
          roundRobinIndex: r.roundRobinIndex,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/lead-routing-rules
  server.post(
    '/lead-routing-rules',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        body: LeadRoutingRuleCreate,
        response: { 201: LeadRoutingRule },
      },
    },
    async (req, reply) => {
      await validateRoutingLinks(req.auth.orgId, {
        assignToUserId: req.body.assignToUserId,
        assignToTerritoryId: req.body.assignToTerritoryId,
        roundRobinTeam: req.body.roundRobinTeam,
      });
      const created = await prisma.leadRoutingRule.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          active: req.body.active ?? true,
          priority: req.body.priority ?? 0,
          criteria: req.body.criteria as Prisma.InputJsonValue,
          assignToUserId: req.body.assignToUserId ?? null,
          assignToTerritoryId: req.body.assignToTerritoryId ?? null,
          roundRobinTeam: req.body.roundRobinTeam ?? [],
          roundRobinIndex: req.body.roundRobinIndex ?? 0,
        },
      });
      return reply.code(201).send({
        id: created.id,
        orgId: created.orgId,
        name: created.name,
        active: created.active,
        priority: created.priority,
        criteria: created.criteria as Record<string, unknown>,
        assignToUserId: created.assignToUserId,
        assignToTerritoryId: created.assignToTerritoryId,
        roundRobinTeam: created.roundRobinTeam,
        roundRobinIndex: created.roundRobinIndex,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // PATCH /api/lead-routing-rules/:id
  server.patch(
    '/lead-routing-rules/:id',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: LeadRoutingRulePatch,
        response: { 200: LeadRoutingRule },
      },
    },
    async (req) => {
      const data: Prisma.LeadRoutingRuleUpdateInput = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.active !== undefined) data.active = req.body.active;
      if (req.body.priority !== undefined) data.priority = req.body.priority;
      if (req.body.criteria !== undefined)
        data.criteria = req.body.criteria as Prisma.InputJsonValue;
      if (req.body.assignToUserId !== undefined) {
        await validateRoutingLinks(req.auth.orgId, { assignToUserId: req.body.assignToUserId });
        data.assignToUserId = req.body.assignToUserId;
      }
      if (req.body.assignToTerritoryId !== undefined) {
        await validateRoutingLinks(req.auth.orgId, {
          assignToTerritoryId: req.body.assignToTerritoryId,
        });
        data.assignToTerritoryId = req.body.assignToTerritoryId;
      }
      if (req.body.roundRobinTeam !== undefined) {
        await validateRoutingLinks(req.auth.orgId, { roundRobinTeam: req.body.roundRobinTeam });
        data.roundRobinTeam = req.body.roundRobinTeam;
      }
      if (req.body.roundRobinIndex !== undefined) data.roundRobinIndex = req.body.roundRobinIndex;

      const updated = await prisma.leadRoutingRule.update({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data,
      });
      return {
        id: updated.id,
        orgId: updated.orgId,
        name: updated.name,
        active: updated.active,
        priority: updated.priority,
        criteria: updated.criteria as Record<string, unknown>,
        assignToUserId: updated.assignToUserId,
        assignToTerritoryId: updated.assignToTerritoryId,
        roundRobinTeam: updated.roundRobinTeam,
        roundRobinIndex: updated.roundRobinIndex,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // DELETE /api/lead-routing-rules/:id (soft delete)
  server.delete(
    '/lead-routing-rules/:id',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      await prisma.leadRoutingRule.update({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data: { deletedAt: new Date(), active: false },
      });
      return { ok: true };
    },
  );

  // POST /api/lead-routing-rules/evaluate
  server.post(
    '/lead-routing-rules/evaluate',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        body: z.object({
          industry: z.string().max(100).optional(),
          countryCode: z.string().length(2).optional(),
          valueMicros: z.number().int().min(0).max(1_000_000_000_000_000).optional(),
        }),
        response: {
          200: z.object({
            matchedRuleId: z.string().nullable(),
            assignToUserId: z.string().nullable(),
            assignToTerritoryId: z.string().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const rules = await prisma.leadRoutingRule.findMany({
        where: { orgId: req.auth.orgId, active: true },
        orderBy: { priority: 'desc' },
        take: 500,
      });
      for (const rule of rules) {
        const criteria = rule.criteria as Record<string, unknown>;
        let match = true;
        if (criteria.industry && req.body.industry !== criteria.industry) match = false;
        if (criteria.countryCode && req.body.countryCode !== criteria.countryCode) match = false;
        if (criteria.minValue && (req.body.valueMicros ?? 0) < Number(criteria.minValue))
          match = false;
        if (match) {
          // Round-robin: if team is defined, pick next user and advance index
          let assignToUserId = rule.assignToUserId;
          if (rule.roundRobinTeam && rule.roundRobinTeam.length > 0) {
            const team = rule.roundRobinTeam;
            const idx = rule.roundRobinIndex % team.length;
            assignToUserId = team[idx] ?? null;
            // Advance index atomically for next evaluation
            await prisma.leadRoutingRule.updateMany({
              where: { id: rule.id, orgId: req.auth.orgId },
              data: { roundRobinIndex: { increment: 1 } },
            });
          }
          return {
            matchedRuleId: rule.id,
            assignToUserId,
            assignToTerritoryId: rule.assignToTerritoryId,
          };
        }
      }
      return { matchedRuleId: null, assignToUserId: null, assignToTerritoryId: null };
    },
  );
};
