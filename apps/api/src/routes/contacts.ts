// Contacts routes — CRUD over the people / decision-unit table. The
// `customer` field is a free-text customer-account tag (same convention as
// Notes / Files) so contacts can attach to accounts that aren't yet
// first-class CrmCompany rows.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Sentiment as PrismaSentiment } from '@bidstack/db';
import { Contact, ContactCreate, ContactPatch } from '@bidstack/shared';

function serializeContact(c: {
  id: string;
  customer: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  influence: number | null;
  sentiment: PrismaSentiment | null;
  createdAt: Date;
}): z.infer<typeof Contact> {
  return {
    id: c.id,
    customer: c.customer,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    influence: c.influence,
    sentiment: c.sentiment,
    createdAt: c.createdAt.toISOString(),
  };
}

export const contactsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/contacts',
    {
      schema: {
        querystring: z.object({
          customer: z.string().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.object({ items: z.array(Contact) }) },
      },
    },
    async (req) => {
      // `search` is a simple substring across name/email/role/customer.
      // Postgres `mode: 'insensitive'` is supported by Prisma; trigram
      // index can be added later if this turns into a hot path.
      const s = req.query.search;
      const items = await prisma.contact.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(req.query.customer ? { customer: req.query.customer } : {}),
          ...(s
            ? {
                OR: [
                  { name: { contains: s, mode: 'insensitive' } },
                  { customer: { contains: s, mode: 'insensitive' } },
                  { email: { contains: s, mode: 'insensitive' } },
                  { role: { contains: s, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { items: items.map(serializeContact) };
    },
  );

  server.post(
    '/contacts',
    {
      schema: {
        body: ContactCreate,
        response: { 201: Contact },
      },
    },
    async (req, reply) => {
      const created = await prisma.contact.create({
        data: {
          orgId: req.auth.orgId,
          customer: req.body.customer,
          name: req.body.name,
          role: req.body.role,
          email: req.body.email,
          phone: req.body.phone,
          influence: req.body.influence,
          sentiment: req.body.sentiment as PrismaSentiment | null,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'contact.create',
          targetType: 'contact',
          targetId: created.id,
          diff: { customer: created.customer, name: created.name },
        },
      });
      return reply.code(201).send(serializeContact(created));
    },
  );

  server.patch(
    '/contacts/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ContactPatch,
        response: { 200: Contact },
      },
    },
    async (req) => {
      // Two-step find-then-update enforces multi-tenancy because Prisma's
      // `update` can only match a unique key. Without this, an attacker
      // could PATCH any contact by guessing its UUID.
      const existing = await prisma.contact.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contact not found');

      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...(req.body.customer !== undefined ? { customer: req.body.customer } : {}),
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.role !== undefined ? { role: req.body.role } : {}),
          ...(req.body.email !== undefined ? { email: req.body.email } : {}),
          ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
          ...(req.body.influence !== undefined ? { influence: req.body.influence } : {}),
          ...(req.body.sentiment !== undefined
            ? { sentiment: req.body.sentiment as PrismaSentiment | null }
            : {}),
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'contact.update',
          targetType: 'contact',
          targetId: updated.id,
          diff: req.body as object,
        },
      });
      return serializeContact(updated);
    },
  );

  server.delete(
    '/contacts/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.contact.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true, customer: true, name: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contact not found');

      await prisma.contact.delete({ where: { id: existing.id } });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'contact.delete',
          targetType: 'contact',
          targetId: existing.id,
          diff: { customer: existing.customer, name: existing.name },
        },
      });
      return reply.code(204).send(null);
    },
  );
};
