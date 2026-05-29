// Territory routes orchestrator.
//
// Registers three sub-plugins under the same server prefix:
//   territory CRUD (this file), lead routing rules, and forecasts + analytics.
//
// Endpoints owned here:
//   GET    /territories       — list active territories
//   POST   /territories       — create a territory
//   PATCH  /territories/:id   — update a territory
//   DELETE /territories/:id   — soft-delete
//
// Lead routing rules  → territories-routing.ts
// Forecasts           → territories-forecast.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { Territory, TerritoryCreate, TerritoryPatch } from '@bidstack/shared';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';
import { territoriesRoutingRoutes } from './territories-routing.js';
import { territoriesForecastRoutes } from './territories-forecast.js';

export const territoryRoutes: FastifyPluginAsyncZod = async (server) => {
  await server.register(territoriesRoutingRoutes);
  await server.register(territoriesForecastRoutes);

  const validateTerritoryOwner = async (orgId: string, ownerId: string) => {
    if (!(await tenantEntityBelongsToOrg('user', ownerId, orgId))) {
      throw server.httpErrors.badRequest('Owner does not belong to this organization');
    }
  };

  // GET /api/territories
  server.get(
    '/territories',
    {
      schema: { response: { 200: z.object({ items: z.array(Territory) }) } },
    },
    async (req) => {
      const rows = await prisma.territory.findMany({
        where: { orgId: req.auth.orgId, active: true },
        include: { owner: { select: { name: true } } },
        orderBy: { name: 'asc' },
        take: 500,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          name: r.name,
          countryCodes: r.countryCodes,
          region: r.region,
          postalCodes: r.postalCodes,
          ownerId: r.ownerId,
          ownerName: r.owner.name,
          active: r.active,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/territories
  server.post(
    '/territories',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        body: TerritoryCreate,
        response: { 201: Territory },
      },
    },
    async (req, reply) => {
      await validateTerritoryOwner(req.auth.orgId, req.body.ownerId);
      const created = await prisma.territory.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          countryCodes: req.body.countryCodes,
          region: req.body.region,
          postalCodes: req.body.postalCodes,
          ownerId: req.body.ownerId,
          active: req.body.active,
        },
        include: { owner: { select: { name: true } } },
      });
      return reply.code(201).send({
        id: created.id,
        orgId: created.orgId,
        name: created.name,
        countryCodes: created.countryCodes,
        region: created.region,
        postalCodes: created.postalCodes,
        ownerId: created.ownerId,
        ownerName: created.owner.name,
        active: created.active,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // PATCH /api/territories/:id
  server.patch(
    '/territories/:id',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: TerritoryPatch,
        response: { 200: Territory },
      },
    },
    async (req) => {
      const data: Prisma.TerritoryUpdateInput = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.countryCodes !== undefined) data.countryCodes = req.body.countryCodes;
      if (req.body.region !== undefined) data.region = req.body.region;
      if (req.body.postalCodes !== undefined) data.postalCodes = req.body.postalCodes;
      if (req.body.ownerId !== undefined) {
        await validateTerritoryOwner(req.auth.orgId, req.body.ownerId);
        data.owner = { connect: { id: req.body.ownerId } };
      }
      if (req.body.active !== undefined) data.active = req.body.active;

      const updated = await prisma.territory.update({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data,
        include: { owner: { select: { name: true } } },
      });
      return {
        id: updated.id,
        orgId: updated.orgId,
        name: updated.name,
        countryCodes: updated.countryCodes,
        region: updated.region,
        postalCodes: updated.postalCodes,
        ownerId: updated.ownerId,
        ownerName: updated.owner.name,
        active: updated.active,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // DELETE /api/territories/:id (soft delete)
  server.delete(
    '/territories/:id',
    {
      preHandler: server.requirePermission('territories:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      await prisma.territory.update({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data: { deletedAt: new Date(), active: false },
      });
      return { ok: true };
    },
  );
};
