// Contacts routes — CRUD over the people / decision-unit table. The
// `customer` field is a free-text customer-account tag (same convention as
// Notes / Files) so contacts can attach to accounts that aren't yet
// first-class CrmCompany rows.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma, type Sentiment as PrismaSentiment } from '@bidstack/db';
import { Contact, ContactCreate, ContactFilter, ContactPage, ContactPatch } from '@bidstack/shared';

import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';

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
        querystring: ContactFilter,
        response: { 200: ContactPage },
      },
    },
    async (req) => {
      const { customer, search: s, cursor, limit } = req.query;
      const items = await prisma.contact.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(customer ? { customer } : {}),
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
        select: {
          id: true,
          customer: true,
          name: true,
          role: true,
          email: true,
          phone: true,
          influence: true,
          sentiment: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      const hasMore = items.length > limit;
      const sliced = hasMore ? items.slice(0, -1) : items;
      const nextCursor = hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null;
      return { items: sliced.map(serializeContact), nextCursor };
    },
  );

  server.get(
    '/contacts/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: Contact },
      },
    },
    async (req) => {
      const contact = await prisma.contact.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!contact) throw req.server.httpErrors.notFound('Contact not found');
      const customFieldValues = await prisma.customFieldValue.findMany({
        where: { orgId: req.auth.orgId, entityType: 'contact', entityId: contact.id },
        select: { id: true, definitionId: true, value: true },
        take: 100,
      });
      return { ...serializeContact(contact), customFieldValues };
    },
  );

  server.post(
    '/contacts',
    {
      preHandler: [server.requirePermission('contacts:write')],
      schema: {
        body: ContactCreate,
        response: { 201: Contact },
      },
    },
    async (req, reply) => {
      const created = await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.create({
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
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'contact.create',
            targetType: 'contact',
            targetId: contact.id,
            diff: { customer: contact.customer, name: contact.name },
          },
        });
        return contact;
      });
      // Fan-out webhook event — fire-and-forget (fail-open).
      void fanOutWebhookEvent(req.auth.orgId, 'contact.created', {
        id: created.id,
        name: created.name,
        customer: created.customer,
      });
      return reply.code(201).send(serializeContact(created));
    },
  );

  server.patch(
    '/contacts/:id',
    {
      preHandler: [server.requirePermission('contacts:write')],
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
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contact not found');

      const updated = await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.update({
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
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'contact.update',
            targetType: 'contact',
            targetId: contact.id,
            diff: req.body as object,
          },
        });
        // CF upserts inside the transaction so a CF failure rolls back the
        // contact update — prevents partial-update / data corruption (P0 #5).
        if (req.body.customFieldValues !== undefined) {
          await Promise.all(
            req.body.customFieldValues.map(({ definitionId, value }) =>
              tx.customFieldValue.upsert({
                where: {
                  orgId_entityType_entityId_definitionId: {
                    orgId: req.auth.orgId,
                    entityType: 'contact',
                    entityId: existing.id,
                    definitionId,
                  },
                },
                update: { value: value as Prisma.InputJsonValue },
                create: {
                  orgId: req.auth.orgId,
                  definitionId,
                  entityType: 'contact',
                  entityId: existing.id,
                  value: value as Prisma.InputJsonValue,
                },
              })
            )
          );
        }
        return contact;
      });

      return serializeContact(updated);
    },
  );

  server.delete(
    '/contacts/:id',
    {
      preHandler: [server.requirePermission('contacts:write')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.contact.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, customer: true, name: true },
      });
      if (!existing) throw server.httpErrors.notFound('Contact not found');

      await prisma.$transaction([
        prisma.contact.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'contact.delete',
            targetType: 'contact',
            targetId: existing.id,
            diff: { customer: existing.customer, name: existing.name },
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );
};
