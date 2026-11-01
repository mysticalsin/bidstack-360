import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { SigningEntity, SigningEntityListResponse, SigningEntityWrite } from '@bidstack/shared';

function serialize(row: {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  brandFamily: string;
  aliases: string[];
  businessLines: string[];
  sourceUrl: string;
  verificationStatus: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legalName,
    brandFamily: row.brandFamily as 'mantu' | 'amaris' | 'other',
    aliases: row.aliases,
    businessLines: row.businessLines,
    sourceUrl: row.sourceUrl,
    verificationStatus: row.verificationStatus as 'verified' | 'unverified',
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const signingEntityRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/settings/signing-entities',
    { config: { permission: 'msa:read' }, schema: { response: { 200: SigningEntityListResponse } } },
    async (req) => {
      const items = await prisma.signingEntity.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        orderBy: [{ brandFamily: 'asc' }, { name: 'asc' }],
        take: 200,
      });
      return { items: items.map(serialize) };
    },
  );

  server.post(
    '/settings/signing-entities',
    { config: { permission: 'msa:admin' }, schema: { body: SigningEntityWrite, response: { 201: SigningEntity } } },
    async (req, reply) => {
      const existing = await prisma.signingEntity.findFirst({
        where: { orgId: req.auth.orgId, slug: req.body.slug, deletedAt: null },
        select: { id: true },
      });
      if (existing) throw server.httpErrors.conflict('A signing entity with this slug already exists');
      const row = await prisma.signingEntity.create({
        data: {
          orgId: req.auth.orgId,
          ...req.body,
          legalName: req.body.legalName ?? null,
          notes: req.body.notes ?? null,
        },
      });
      return reply.code(201).send(serialize(row));
    },
  );

  server.patch(
    '/settings/signing-entities/:id',
    {
      config: { permission: 'msa:admin' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SigningEntityWrite.partial().refine((v) => Object.keys(v).length > 0, {
          message: 'PATCH body must contain at least one field',
        }),
        response: { 200: SigningEntity },
      },
    },
    async (req) => {
      const current = await prisma.signingEntity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!current) throw server.httpErrors.notFound('Signing entity not found');
      if (req.body.slug && req.body.slug !== current.slug) {
        const clash = await prisma.signingEntity.findFirst({
          where: { orgId: req.auth.orgId, slug: req.body.slug, deletedAt: null, id: { not: current.id } },
          select: { id: true },
        });
        if (clash) throw server.httpErrors.conflict('A signing entity with this slug already exists');
      }
      const row = await prisma.signingEntity.update({
        where: { id: current.id },
        data: req.body,
      });
      return serialize(row);
    },
  );
};
