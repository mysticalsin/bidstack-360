import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.string().datetime(),
  permissions: z.array(z.object({ id: z.string().uuid(), key: z.string(), name: z.string() })),
});

const PermissionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

export const roleRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/roles
  server.get(
    '/roles',
    { schema: { response: { 200: z.object({ items: z.array(RoleSchema) }) } } },
    async (req) => {
      const roles = await prisma.role.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        include: {
          permissions: {
            include: { permission: { select: { id: true, key: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      return {
        items: roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isSystem: r.isSystem,
          createdAt: r.createdAt.toISOString(),
          permissions: r.permissions.map((rp) => rp.permission),
        })),
      };
    },
  );

  // GET /api/permissions
  server.get(
    '/permissions',
    { schema: { response: { 200: z.object({ items: z.array(PermissionSchema) }) } } },
    async () => {
      const permissions = await prisma.permission.findMany({
        orderBy: { name: 'asc' },
      });
      return {
        items: permissions.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          description: p.description,
        })),
      };
    },
  );

  // POST /api/roles
  server.post(
    '/roles',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          permissionIds: z.array(z.string().uuid()).default([]),
        }),
        response: { 201: RoleSchema },
      },
    },
    async (req, reply) => {
      const role = await prisma.role.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          description: req.body.description ?? null,
          permissions: {
            create: req.body.permissionIds.map((pid) => ({
              permission: { connect: { id: pid } },
            })),
          },
        },
        include: {
          permissions: {
            include: { permission: { select: { id: true, key: true, name: true } } },
          },
        },
      });
      reply.status(201);
      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        createdAt: role.createdAt.toISOString(),
        permissions: role.permissions.map((rp) => rp.permission),
      };
    },
  );

  // PATCH /api/roles/:id
  server.patch(
    '/roles/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional(),
          permissionIds: z.array(z.string().uuid()).optional(),
        }),
        response: { 200: RoleSchema },
      },
    },
    async (req) => {
      const existing = await prisma.role.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Role not found');
      if (existing.isSystem) throw server.httpErrors.forbidden('Cannot modify system roles');

      const data: {
        name?: string;
        description?: string | null;
        permissions?: { deleteMany: object; create: { permission: { connect: { id: string } } }[] };
      } = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.description !== undefined) data.description = req.body.description ?? null;
      if (req.body.permissionIds !== undefined) {
        data.permissions = {
          deleteMany: {},
          create: req.body.permissionIds.map((pid) => ({
            permission: { connect: { id: pid } },
          })),
        };
      }

      const role = await prisma.role.update({
        where: { id: req.params.id },
        data,
        include: {
          permissions: {
            include: { permission: { select: { id: true, key: true, name: true } } },
          },
        },
      });
      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        createdAt: role.createdAt.toISOString(),
        permissions: role.permissions.map((rp) => rp.permission),
      };
    },
  );

  // DELETE /api/roles/:id
  server.delete(
    '/roles/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.role.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Role not found');
      if (existing.isSystem) throw server.httpErrors.forbidden('Cannot delete system roles');

      await prisma.role.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });
      reply.status(204).send();
    },
  );
};
