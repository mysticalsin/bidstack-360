/**
 * Document template CRUD routes with version history.
 *
 * All routes are org-scoped via req.auth. No cross-tenant access.
 * Version history is append-only — there is no route to delete versions.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { DocumentTemplateCreate, DocumentTemplatePatch, TemplateKind } from '@bidstack/shared';
import { renderTemplate } from '../services/documents/document.service.js';

// ─── Response shapes ─────────────────────────────────────────────────────────

const TemplateResponse = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  kind: TemplateKind,
  description: z.string().nullable(),
  bodyHtml: z.string(),
  defaultVariables: z.record(z.string()),
  currentVersion: z.number().int(),
  createdAt: z.string(),
});

const TemplateVersionResponse = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  version: z.number().int(),
  bodyHtml: z.string(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});

function serializeTemplate(row: {
  id: string;
  orgId: string;
  name: string;
  kind: string;
  description: string | null;
  bodyHtml: string;
  defaultVariables: unknown;
  createdAt: Date;
  versions?: Array<{ version: number }>;
}): z.infer<typeof TemplateResponse> {
  const currentVersion = row.versions?.reduce((max, v) => Math.max(max, v.version), 0) ?? 0;
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    kind: row.kind as z.infer<typeof TemplateKind>,
    description: row.description,
    bodyHtml: row.bodyHtml,
    defaultVariables: (row.defaultVariables ?? {}) as Record<string, string>,
    currentVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const documentTemplatesRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── GET /document-templates ───────────────────────────────────────────────
  server.get(
    '/document-templates',
    {
      schema: {
        querystring: z.object({
          kind: TemplateKind.optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: z.object({
            items: z.array(TemplateResponse),
            total: z.number().int(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { kind, page, limit } = req.query;
      const skip = (page - 1) * limit;

      const where = { orgId, deletedAt: null, ...(kind ? { kind } : {}) };

      const [items, total] = await Promise.all([
        prisma.documentTemplate.findMany({
          where,
          include: { versions: { select: { version: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.documentTemplate.count({ where }),
      ]);

      return reply.send({ items: items.map(serializeTemplate), total });
    },
  );

  // ── POST /document-templates ──────────────────────────────────────────────
  server.post(
    '/document-templates',
    {
      schema: {
        body: DocumentTemplateCreate,
        response: { 201: TemplateResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const body = req.body;

      const template = await prisma.$transaction(async (tx) => {
        const created = await tx.documentTemplate.create({
          data: {
            orgId,
            name: body.name,
            kind: body.kind,
            description: body.description ?? null,
            bodyHtml: body.bodyHtml,
            defaultVariables: body.defaultVariables as object,
          },
        });
        // Record version 1 immediately
        await tx.documentTemplateVersion.create({
          data: {
            templateId: created.id,
            version: 1,
            bodyHtml: body.bodyHtml,
            createdBy: userId,
          },
        });
        return created;
      });

      return reply.status(201).send(serializeTemplate({ ...template, versions: [{ version: 1 }] }));
    },
  );

  // ── GET /document-templates/:id ───────────────────────────────────────────
  server.get(
    '/document-templates/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: TemplateResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      const template = await prisma.documentTemplate.findFirst({
        where: { id, orgId, deletedAt: null },
        include: { versions: { select: { version: true } } },
      });

      if (!template) return reply.notFound(`Template ${id} not found`);
      return reply.send(serializeTemplate(template));
    },
  );

  // ── PATCH /document-templates/:id ────────────────────────────────────────
  server.patch(
    '/document-templates/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: DocumentTemplatePatch,
        response: { 200: TemplateResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { id } = req.params;
      const body = req.body;

      const existing = await prisma.documentTemplate.findFirst({
        where: { id, orgId, deletedAt: null },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });

      if (!existing) return reply.notFound(`Template ${id} not found`);

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.documentTemplate.update({
          where: { id },
          data: {
            ...(body.name ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.bodyHtml ? { bodyHtml: body.bodyHtml } : {}),
            ...(body.defaultVariables ? { defaultVariables: body.defaultVariables as object } : {}),
          },
          include: { versions: { select: { version: true } } },
        });

        // If bodyHtml changed, record a new version
        if (body.bodyHtml && body.bodyHtml !== existing.bodyHtml) {
          const lastVersion = existing.versions[0]?.version ?? 0;
          await tx.documentTemplateVersion.create({
            data: {
              templateId: id,
              version: lastVersion + 1,
              bodyHtml: body.bodyHtml,
              createdBy: userId,
            },
          });
        }

        return result;
      });

      return reply.send(serializeTemplate(updated));
    },
  );

  // ── DELETE /document-templates/:id ───────────────────────────────────────
  server.delete(
    '/document-templates/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      const existing = await prisma.documentTemplate.findFirst({
        where: { id, orgId, deletedAt: null },
      });
      if (!existing) return reply.notFound(`Template ${id} not found`);

      // Soft delete
      await prisma.documentTemplate.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return reply.status(204).send();
    },
  );

  // ── GET /document-templates/:id/versions ─────────────────────────────────
  server.get(
    '/document-templates/:id/versions',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.array(TemplateVersionResponse) },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      const template = await prisma.documentTemplate.findFirst({
        where: { id, orgId, deletedAt: null },
      });
      if (!template) return reply.notFound(`Template ${id} not found`);

      const versions = await prisma.documentTemplateVersion.findMany({
        where: { templateId: id },
        orderBy: { version: 'asc' },
      });

      return reply.send(
        versions.map((v) => ({
          id: v.id,
          templateId: v.templateId,
          version: v.version,
          bodyHtml: v.bodyHtml,
          createdAt: v.createdAt.toISOString(),
          createdBy: v.createdBy,
        })),
      );
    },
  );

  // ── POST /document-templates/:id/render ──────────────────────────────────
  // Preview: render with supplied variables, return HTML.
  server.post(
    '/document-templates/:id/render',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ variables: z.record(z.string()).default({}) }),
        response: { 200: z.object({ html: z.string() }) },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id } = req.params;
      const { variables } = req.body;

      const { html } = await renderTemplate({ templateId: id, orgId, variables });
      return reply.send({ html });
    },
  );
};
