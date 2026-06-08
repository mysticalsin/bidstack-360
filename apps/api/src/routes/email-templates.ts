// EmailTemplate management routes: CRUD, render-with-context preview, and
// usage tracking for the compose workflow.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  EmailTemplate,
  EmailTemplateCreate,
  EmailTemplatePatch,
  EmailTemplateList,
  EmailTemplateRenderRequest,
  EmailTemplateRenderResponse,
} from '@bidstack/shared';

import { renderEmailTemplate } from '../lib/email-template-render.js';

const IdParam = z.object({ id: z.string().uuid() });

export const emailTemplateRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── GET /api/v1/email-templates ──────────────────────────────────────
  server.get(
    '/email-templates',
    {
      schema: {
        querystring: z.object({
          includeArchived: z.coerce.boolean().default(false),
          category: z.string().max(40).optional(),
        }),
        response: { 200: EmailTemplateList },
      },
    },
    async (req) => {
      const items = await prisma.emailTemplate.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.includeArchived ? {} : { archived: false }),
          ...(req.query.category ? { category: req.query.category } : {}),
        },
        orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
        take: 200,
      });
      return { items: items.map(serialize) };
    },
  );

  // ─── POST /api/v1/email-templates ─────────────────────────────────────
  server.post(
    '/email-templates',
    {
      schema: {
        body: EmailTemplateCreate,
        response: { 201: EmailTemplate },
      },
    },
    async (req, reply) => {
      const tpl = await prisma.emailTemplate.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          subject: req.body.subject,
          bodyHtml: req.body.bodyHtml,
          bodyText: req.body.bodyText ?? null,
          category: req.body.category ?? null,
          createdById: req.auth.userId,
        },
      });
      return reply.code(201).send(serialize(tpl));
    },
  );

  // ─── PATCH /api/v1/email-templates/:id ────────────────────────────────
  server.patch(
    '/email-templates/:id',
    {
      schema: {
        params: IdParam,
        body: EmailTemplatePatch,
        response: { 200: EmailTemplate },
      },
    },
    async (req) => {
      const tpl = await prisma.emailTemplate.update({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.subject !== undefined ? { subject: req.body.subject } : {}),
          ...(req.body.bodyHtml !== undefined ? { bodyHtml: req.body.bodyHtml } : {}),
          ...(req.body.bodyText !== undefined ? { bodyText: req.body.bodyText } : {}),
          ...(req.body.category !== undefined ? { category: req.body.category } : {}),
          ...(req.body.archived !== undefined ? { archived: req.body.archived } : {}),
        },
      });
      return serialize(tpl);
    },
  );

  // ─── DELETE /api/v1/email-templates/:id ───────────────────────────────
  // Soft delete. Archived workflow runs still resolve historical templates
  // via the `deletedAt IS NULL` filter being relaxed at lookup-time when
  // a workflow run references a known id.
  server.delete(
    '/email-templates/:id',
    {
      schema: {
        params: IdParam,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await prisma.emailTemplate.update({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send(null);
    },
  );

  // ─── POST /api/v1/email-templates/render ──────────────────────────────
  // Preview / pre-send render. The UI calls this when the user selects a
  // record + template combination to fill the compose form.
  server.post(
    '/email-templates/render',
    {
      schema: {
        body: EmailTemplateRenderRequest,
        response: { 200: EmailTemplateRenderResponse },
      },
    },
    async (req) => {
      return renderEmailTemplate({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        templateId: req.body.templateId,
        context: req.body.context,
      });
    },
  );

  // ─── POST /api/v1/email-templates/:id/track-use ───────────────────────
  // Increment use count + stamp lastUsedAt. Called by the compose flow on
  // actual send. Soft endpoint — failures don't block the send.
  server.post(
    '/email-templates/:id/track-use',
    {
      schema: {
        params: IdParam,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await prisma.emailTemplate.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      return { ok: true as const };
    },
  );
};

function serialize(row: {
  id: string;
  orgId: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  category: string | null;
  archived: boolean;
  useCount: number;
  lastUsedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof EmailTemplate> {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    category: row.category,
    archived: row.archived,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
