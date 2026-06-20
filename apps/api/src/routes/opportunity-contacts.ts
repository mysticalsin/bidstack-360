import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Sentiment as PrismaSentiment } from '@bidstack/db';
import {
  OpportunityContact,
  OpportunityContactCreate,
  OpportunityContactPatch,
} from '@bidstack/shared';

function serialize(oc: {
  id: string;
  orgId: string;
  opportunityId: string;
  contactId: string;
  role: string;
  isPrimary: boolean;
  influence: number | null;
  sentiment: PrismaSentiment | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
  };
}): z.infer<typeof OpportunityContact> {
  return {
    id: oc.id,
    orgId: oc.orgId,
    opportunityId: oc.opportunityId,
    contactId: oc.contactId,
    role: oc.role,
    isPrimary: oc.isPrimary,
    influence: oc.influence,
    sentiment: oc.sentiment,
    notes: oc.notes,
    createdAt: oc.createdAt.toISOString(),
    updatedAt: oc.updatedAt.toISOString(),
    contact: {
      id: oc.contact.id,
      name: oc.contact.name,
      email: oc.contact.email,
      phone: oc.contact.phone,
      role: oc.contact.role,
    },
  };
}

export const opportunityContactsRoutes: FastifyPluginAsyncZod = async (server) => {
  // RBAC: link/unlink/update contacts on an opportunity require opportunities:write.
  server.addHook('preHandler', async (req) => {
    if (req.method !== 'GET') await server.requirePermission('opportunities:write')(req);
  });

  server.get(
    '/opportunities/:id/contacts',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ items: z.array(OpportunityContact) }) },
      },
    },
    async (req) => {
      const items = await prisma.opportunityContact.findMany({
        where: { opportunityId: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: {
          contact: { select: { id: true, name: true, email: true, phone: true, role: true } },
        },
        orderBy: { isPrimary: 'desc' },
        take: 500,
      });
      return { items: items.map(serialize) };
    },
  );

  server.post(
    '/opportunities/:id/contacts',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: OpportunityContactCreate,
        response: { 201: OpportunityContact },
      },
    },
    async (req, reply) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const contact = await prisma.contact.findFirst({
        where: { id: req.body.contactId, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true, email: true, phone: true, role: true },
      });
      if (!contact) throw server.httpErrors.notFound('Contact not found');

      if (req.body.isPrimary) {
        await prisma.opportunityContact.updateMany({
          where: { opportunityId: req.params.id, orgId: req.auth.orgId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const created = await prisma.opportunityContact.create({
        data: {
          orgId: req.auth.orgId,
          opportunityId: req.params.id,
          contactId: req.body.contactId,
          role: req.body.role ?? 'stakeholder',
          isPrimary: req.body.isPrimary ?? false,
        },
        include: {
          contact: { select: { id: true, name: true, email: true, phone: true, role: true } },
        },
      });

      reply.status(201);
      return serialize(created);
    },
  );

  server.patch(
    '/opportunities/:id/contacts/:contactId',
    {
      schema: {
        params: z.object({ id: z.string().uuid(), contactId: z.string().uuid() }),
        body: OpportunityContactPatch,
        response: { 200: OpportunityContact },
      },
    },
    async (req) => {
      if (req.body.isPrimary) {
        await prisma.opportunityContact.updateMany({
          where: { opportunityId: req.params.id, orgId: req.auth.orgId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const updated = await prisma.opportunityContact.updateMany({
        where: {
          opportunityId: req.params.id,
          contactId: req.params.contactId,
          orgId: req.auth.orgId,
          deletedAt: null,
        },
        data: req.body,
      });
      if (updated.count === 0) throw server.httpErrors.notFound('Link not found');

      const row = await prisma.opportunityContact.findFirstOrThrow({
        where: {
          opportunityId: req.params.id,
          contactId: req.params.contactId,
          orgId: req.auth.orgId,
        },
        include: {
          contact: { select: { id: true, name: true, email: true, phone: true, role: true } },
        },
      });
      return serialize(row);
    },
  );

  server.delete(
    '/opportunities/:id/contacts/:contactId',
    {
      schema: {
        params: z.object({ id: z.string().uuid(), contactId: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.opportunityContact.findFirst({
        where: {
          opportunityId: req.params.id,
          contactId: req.params.contactId,
          orgId: req.auth.orgId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Link not found');

      await prisma.opportunityContact.updateMany({
        where: {
          opportunityId: req.params.id,
          contactId: req.params.contactId,
          orgId: req.auth.orgId,
        },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send(null);
    },
  );
};
