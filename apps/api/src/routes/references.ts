// Reference tracking routes.
// Stores reusable customer references (case studies, testimonials, success stories)
// that can be searched by industry, tags, and company.

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

import { enqueueRfpEmbedReference } from '../queues/rfp-embed-reference.js';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';

// Build the text we embed for semantic retrieval: title + description +
// industry + tags. Mirrors the worker's search_document embedding so Spotlight
// Ref / story-match query vectors land in the same space.
function referenceEmbedContent(r: {
  title: string;
  description: string | null;
  industry: string | null;
  tags: string[];
}): string {
  return [r.title, r.description ?? '', r.industry ?? '', r.tags.join(' ')]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
}

function serializeReference(ref: {
  id: string;
  orgId: string;
  companyId: string | null;
  title: string;
  description: string | null;
  industry: string | null;
  valueMicros: bigint | null;
  contactName: string | null;
  contactEmail: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  documentUrl: string | null;
  tags: string[];
  createdAt: Date;
  company?: { id: string; name: string; logoUrl: string | null } | null;
}) {
  return {
    ...ref,
    company: ref.company ?? null,
    valueMicros: ref.valueMicros !== null ? ref.valueMicros.toString() : null,
  };
}

export const referencesRoutes: FastifyPluginAsync = async (server) => {
  // RBAC: reference CRUD writes were ungated. Gate every mutation with
  // accounts:write (closest registered key; no references:* exists), mirroring
  // sibling CRM routes. Reads pass through.
  server.addHook('preHandler', async (req) => {
    if (req.method !== 'GET') await server.requirePermission('accounts:write')(req);
  });

  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /api/v1/references — list references with filters
  app.get('/references', {
    schema: {
      querystring: z.object({
        industry: z.string().max(100).optional(),
        companyId: z.string().uuid().optional(),
        tag: z.string().max(100).optional(),
        search: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { industry, companyId, tag, search, limit } = req.query;

      const items = await prisma.reference.findMany({
        where: {
          orgId,
          deletedAt: null,
          ...(industry ? { industry: { equals: industry, mode: 'insensitive' } } : {}),
          ...(companyId ? { companyId } : {}),
          ...(tag ? { tags: { has: tag } } : {}),
          ...(search
            ? {
                OR: [
                  { title: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { company: { select: { id: true, name: true, logoUrl: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return reply.send({ items: items.map(serializeReference) });
    },
  });

  // POST /api/v1/references — create a reference
  app.post('/references', {
    schema: {
      body: z.object({
        companyId: z.string().uuid().optional(),
        title: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        industry: z.string().max(100).optional(),
        valueMicros: z.number().int().min(0).max(1_000_000_000_000_000).optional(),
        contactName: z.string().max(255).optional(),
        contactEmail: z.string().email().optional(),
        documentUrl: z.string().url().optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
      }),
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const body = req.body;

      // Multi-tenant guard: a reference may link a Company, but the FK comes
      // straight from the request body. Without this check a caller could point
      // companyId at ANOTHER org's company and leak its name/logo via the
      // GET /references include. Mirror the proposals.ts opportunity check.
      if (body.companyId && !(await tenantEntityBelongsToOrg('company', body.companyId, orgId))) {
        return reply.notFound('Company not found');
      }

      const ref = await prisma.reference.create({
        data: {
          orgId,
          companyId: body.companyId ?? null,
          title: body.title,
          description: body.description ?? null,
          industry: body.industry ?? null,
          valueMicros: body.valueMicros !== undefined ? BigInt(body.valueMicros) : null,
          contactName: body.contactName ?? null,
          contactEmail: body.contactEmail ?? null,
          documentUrl: body.documentUrl ?? null,
          tags: body.tags ?? [],
        },
      });

      // Background-embed so Spotlight Ref + story-match can retrieve this
      // reference semantically. Fire-and-forget (fail-open if Redis is down).
      void enqueueRfpEmbedReference({
        orgId,
        referenceId: ref.id,
        contentText: referenceEmbedContent(ref),
      });

      return reply.status(201).send(serializeReference(ref));
    },
  });

  // PATCH /api/v1/references/:id — update a reference
  app.patch('/references/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(2000).optional(),
        industry: z.string().max(100).optional(),
        valueMicros: z.number().int().min(0).max(1_000_000_000_000_000).optional(),
        contactName: z.string().max(255).optional(),
        contactEmail: z.string().email().optional(),
        documentUrl: z.string().url().optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
      }),
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;
      const body = req.body;

      const existing = await prisma.reference.findFirst({
        where: { id, orgId },
      });
      if (!existing) {
        throw server.httpErrors.notFound('Reference not found');
      }

      const updateResult = await prisma.reference.updateMany({
        where: { id, orgId, deletedAt: null },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.industry !== undefined ? { industry: body.industry } : {}),
          ...(body.valueMicros !== undefined ? { valueMicros: BigInt(body.valueMicros) } : {}),
          ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
          ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
          ...(body.documentUrl !== undefined ? { documentUrl: body.documentUrl } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
        },
      });

      if (updateResult.count === 0) {
        throw server.httpErrors.notFound('Reference not found');
      }

      const updated = await prisma.reference.findFirstOrThrow({
        where: { id, orgId, deletedAt: null },
      });

      // Re-embed on content change (content-hash deduped in the worker, so a
      // no-op edit is cheap). Fire-and-forget.
      void enqueueRfpEmbedReference({
        orgId,
        referenceId: updated.id,
        contentText: referenceEmbedContent(updated),
      });

      return reply.send(serializeReference(updated));
    },
  });

  // DELETE /api/v1/references/:id
  app.delete('/references/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      const existing = await prisma.reference.findFirst({
        where: { id, orgId, deletedAt: null },
      });
      if (!existing) {
        throw server.httpErrors.notFound('Reference not found');
      }

      const updateResult = await prisma.reference.updateMany({
        where: { id, orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (updateResult.count === 0) {
        throw server.httpErrors.notFound('Reference not found');
      }
      return reply.status(204).send();
    },
  });

  // POST /api/v1/references/:id/use — mark reference as used
  app.post('/references/:id/use', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      const existing = await prisma.reference.findFirst({
        where: { id, orgId, deletedAt: null },
      });
      if (!existing) {
        throw server.httpErrors.notFound('Reference not found');
      }

      const updateResult = await prisma.reference.updateMany({
        where: { id, orgId, deletedAt: null },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
      if (updateResult.count === 0) {
        throw server.httpErrors.notFound('Reference not found');
      }

      const updated = await prisma.reference.findFirstOrThrow({
        where: { id, orgId, deletedAt: null },
      });

      return reply.send(serializeReference(updated));
    },
  });
};
