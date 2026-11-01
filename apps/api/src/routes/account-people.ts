import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { PermissionKey } from '@bidstack/shared';
import {
  AccountWork,
  ContactFactCreate,
  CustomerCommitmentCreate,
  CustomerCommitmentPatch,
  CustomerCommitmentRow,
  FactDecisionBody,
  PeopleMap,
  PersonFact,
  WORK_PAGE,
} from '@bidstack/shared';

import { apiKeyScopeSatisfiesPermission } from '../lib/api-key-scopes.js';
import { userHasPermission } from '../lib/rbac-decision-cache.js';
import {
  applyFactDecision,
  assertContactInOrg,
  badRequest,
  intakeCommitment,
  intakePersonFact,
  linkedFactTargets,
  notFound,
  peopleMapForCompany,
  peopleMapForOpportunity,
  reportingLineLoops,
  syncReportsTo,
} from '../services/people-map.js';

const IdParam = z.object({ id: z.string().uuid() });

const WRITE_PERMISSIONS = ['contacts:write', 'kam:write', 'opportunities:write'] as const satisfies readonly PermissionKey[];

async function requirePeopleWrite(req: FastifyRequest): Promise<void> {
  if (req.auth.role === 'api' || req.auth.userId.startsWith('apikey:')) {
    const allowed = WRITE_PERMISSIONS.some((permission) =>
      apiKeyScopeSatisfiesPermission(req.auth.scopes, permission),
    );
    if (!allowed) {
      throw req.server.httpErrors.forbidden(
        'Requires permission: contacts:write, kam:write, or opportunities:write',
      );
    }
    return;
  }
  for (const permission of WRITE_PERMISSIONS) {
    if (await userHasPermission(req.auth.orgId, req.auth.userId, permission)) return;
  }
  throw req.server.httpErrors.forbidden(
    'Requires permission: contacts:write, kam:write, or opportunities:write',
  );
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

async function loadWork(orgId: string, where: { companyId?: string; opportunityId?: string }) {
  const commitmentWhere = {
    orgId,
    deletedAt: null,
    ...(where.opportunityId
      ? { opportunityId: where.opportunityId }
      : { companyId: where.companyId }),
  };
  const taskWhere = where.opportunityId
    ? { orgId, deletedAt: null, oppId: where.opportunityId }
    : {
        orgId,
        deletedAt: null,
        OR: [
          { accountId: where.companyId },
          { opportunity: { companyId: where.companyId, orgId, deletedAt: null } },
        ],
      };
  const [commitments, tasks] = await Promise.all([
    (async () => {
      const rows = await prisma.customerCommitment.findMany({
        where: commitmentWhere,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }],
        take: WORK_PAGE,
        select: {
          id: true,
          promise: true,
          dueDate: true,
          status: true,
          ownerContactId: true,
          opportunityId: true,
          sourceNote: true,
          ownerContact: { select: { name: true } },
        },
      });
      const capped = rows.length === WORK_PAGE && (await prisma.customerCommitment.count({ where: commitmentWhere })) > WORK_PAGE;
      return { rows, capped };
    })(),
    (async () => {
      const rows = await prisma.task.findMany({
        where: taskWhere,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }],
        take: WORK_PAGE,
        select: {
          id: true,
          title: true,
          dueDate: true,
          status: true,
          assignee: { select: { email: true } },
        },
      });
      const capped = rows.length === WORK_PAGE && (await prisma.task.count({ where: taskWhere })) > WORK_PAGE;
      return { rows, capped };
    })(),
  ]);
  return {
    commitmentsCapped: commitments.capped,
    tasksCapped: tasks.capped,
    commitments: commitments.rows.map((row) => ({
      recordKind: 'customer_commitment' as const,
      id: row.id,
      promise: row.promise,
      dueDate: isoDate(row.dueDate),
      status: row.status,
      ownerContactId: row.ownerContactId,
      ownerName: row.ownerContact?.name ?? null,
      opportunityId: row.opportunityId,
      sourceNote: row.sourceNote,
    })),
    internalTasks: tasks.rows.map((row) => ({
      recordKind: 'internal_task' as const,
      id: row.id,
      title: row.title,
      dueDate: isoDate(row.dueDate),
      status: row.status,
      assigneeEmail: row.assignee?.email ?? null,
    })),
  };
}

async function serializeCommitment(orgId: string, id: string) {
  const row = await prisma.customerCommitment.findFirst({
    where: { id, orgId, deletedAt: null },
    select: {
      id: true,
      promise: true,
      dueDate: true,
      status: true,
      ownerContactId: true,
      opportunityId: true,
      sourceNote: true,
      ownerContact: { select: { name: true } },
    },
  });
  if (!row) return null;
  return {
    recordKind: 'customer_commitment' as const,
    id: row.id,
    promise: row.promise,
    dueDate: isoDate(row.dueDate),
    status: row.status,
    ownerContactId: row.ownerContactId,
    ownerName: row.ownerContact?.name ?? null,
    opportunityId: row.opportunityId,
    sourceNote: row.sourceNote,
  };
}

export const accountPeopleRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/companies/:id/people-map',
    { config: { permission: 'companies:read' }, schema: { params: IdParam, response: { 200: PeopleMap } } },
    async (req) => {
      const map = await peopleMapForCompany(req.auth.orgId, req.params.id);
      if (!map) notFound(server, 'Company not found');
      return map;
    },
  );

  server.get(
    '/opportunities/:id/people-map',
    { config: { permission: 'opportunities:read' }, schema: { params: IdParam, response: { 200: PeopleMap } } },
    async (req) => {
      const map = await peopleMapForOpportunity(req.auth.orgId, req.params.id);
      if (!map) notFound(server, 'Opportunity not found');
      return map;
    },
  );

  server.post(
    '/contacts/:id/facts',
    {
      preHandler: requirePeopleWrite,
      schema: { params: IdParam, body: ContactFactCreate, response: { 201: PersonFact } },
    },
    async (req, reply) => {
      const contact = await assertContactInOrg(req.auth.orgId, req.params.id);
      if (!contact) notFound(server, 'Contact not found');
      const link = intakePersonFact({
        kind: req.body.kind,
        ambiguous: req.body.ambiguous === true,
        reportsToContactId: req.body.reportsToContactId ?? null,
        opportunityId: req.body.opportunityId ?? null,
        companyId: req.body.companyId ?? null,
        linkLabel: req.body.linkLabel ?? null,
      });
      try {
        await linkedFactTargets(req.auth.orgId, link);
      } catch (error) {
        if (error instanceof Error && error.message === 'TARGET_NOT_IN_ORG') {
          badRequest(server, 'That person, company, or deal is not in this account');
        }
        throw error;
      }
      if (link.reportsToContactId && (await reportingLineLoops(req.auth.orgId, contact.id, link.reportsToContactId))) {
        badRequest(server, 'That reporting line would loop');
      }
      const created = await prisma.contactFact.create({
        data: {
          orgId: req.auth.orgId,
          contactId: contact.id,
          kind: req.body.kind,
          status: link.status,
          claim: req.body.claim,
          reportsToContactId: link.reportsToContactId,
          opportunityId: link.opportunityId,
          companyId: link.companyId,
          linkLabel: link.linkLabel,
          evidenceDetail: req.body.evidenceDetail ?? null,
          observedAt: req.body.observedAt ? new Date(req.body.observedAt) : null,
        },
        select: {
          id: true,
          kind: true,
          status: true,
          claim: true,
          reportsToContactId: true,
          opportunityId: true,
          companyId: true,
          linkLabel: true,
          evidenceDetail: true,
          observedAt: true,
        },
      });
      return reply.code(201).send({
        ...created,
        observedAt: created.observedAt ? created.observedAt.toISOString() : null,
        stale: false,
      });
    },
  );

  server.post(
    '/contact-facts/:id/decision',
    {
      preHandler: requirePeopleWrite,
      schema: { params: IdParam, body: FactDecisionBody, response: { 200: PersonFact } },
    },
    async (req) => {
      const existing = await prisma.contactFact.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) notFound(server, 'Fact not found');
      if (existing.status === 'dismissed') badRequest(server, 'A dismissed fact stays dismissed');
      const next = applyFactDecision(
        {
          kind: existing.kind,
          status: existing.status,
          reportsToContactId: existing.reportsToContactId,
          opportunityId: existing.opportunityId,
          companyId: existing.companyId,
          linkLabel: existing.linkLabel,
        },
        req.body.decision,
        {
          reportsToContactId: req.body.reportsToContactId,
          opportunityId: req.body.opportunityId,
          companyId: req.body.companyId,
          linkLabel: req.body.linkLabel,
        },
      );
      try {
        await linkedFactTargets(req.auth.orgId, next);
      } catch (error) {
        if (error instanceof Error && error.message === 'TARGET_NOT_IN_ORG') {
          badRequest(server, 'That person, company, or deal is not in this account');
        }
        throw error;
      }
      if (
        next.reportsToContactId &&
        (await reportingLineLoops(req.auth.orgId, existing.contactId, next.reportsToContactId))
      ) {
        badRequest(server, 'That reporting line would loop');
      }
      await prisma.contactFact.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId },
        data: {
          status: next.status,
          reportsToContactId: next.reportsToContactId,
          opportunityId: next.opportunityId,
          companyId: next.companyId,
          linkLabel: next.linkLabel,
          decidedByUserId: req.auth.userId,
          decidedAt: new Date(),
        },
      });
      if (next.status === 'accepted' || req.body.decision === 'dismiss') {
        await syncReportsTo(req.auth.orgId, existing.contactId);
      }
      const saved = await prisma.contactFact.findFirst({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!saved) notFound(server, 'Fact not found');
      return {
        id: saved.id,
        kind: saved.kind,
        status: saved.status,
        claim: saved.claim,
        reportsToContactId: saved.reportsToContactId,
        opportunityId: saved.opportunityId,
        companyId: saved.companyId,
        linkLabel: saved.linkLabel,
        evidenceDetail: saved.evidenceDetail,
        observedAt: saved.observedAt ? saved.observedAt.toISOString() : null,
        stale: false,
      };
    },
  );

  server.get(
    '/companies/:id/commitments',
    { config: { permission: 'companies:read' }, schema: { params: IdParam, response: { 200: AccountWork } } },
    async (req) => {
      const company = await prisma.company.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!company) notFound(server, 'Company not found');
      return loadWork(req.auth.orgId, { companyId: company.id });
    },
  );

  server.get(
    '/opportunities/:id/commitments',
    { config: { permission: 'opportunities:read' }, schema: { params: IdParam, response: { 200: AccountWork } } },
    async (req) => {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!opportunity) notFound(server, 'Opportunity not found');
      return loadWork(req.auth.orgId, { opportunityId: opportunity.id });
    },
  );

  server.post(
    '/companies/:id/commitments',
    {
      preHandler: requirePeopleWrite,
      schema: {
        params: IdParam,
        body: CustomerCommitmentCreate,
        response: { 201: CustomerCommitmentRow },
      },
    },
    async (req, reply) => {
      const company = await prisma.company.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!company) notFound(server, 'Company not found');
      const intake = intakeCommitment({
        opportunityId: req.body.opportunityId ?? null,
        ambiguous: req.body.ambiguous === true,
      });
      if (req.body.ownerContactId) {
        const owner = await assertContactInOrg(req.auth.orgId, req.body.ownerContactId);
        if (!owner) badRequest(server, 'The customer owner is not in this account');
      }
      if (intake.opportunityId) {
        const deal = await prisma.opportunity.findFirst({
          where: { id: intake.opportunityId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!deal) badRequest(server, 'That deal is not in this account');
      }
      const created = await prisma.customerCommitment.create({
        data: {
          orgId: req.auth.orgId,
          companyId: company.id,
          opportunityId: intake.opportunityId,
          promise: req.body.promise,
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          ownerContactId: req.body.ownerContactId ?? null,
          status: intake.status,
          sourceNote: req.body.sourceNote ?? null,
          createdByUserId: req.auth.userId,
        },
        select: { id: true },
      });
      const row = await serializeCommitment(req.auth.orgId, created.id);
      if (!row) notFound(server, 'Commitment not found');
      return reply.code(201).send(row);
    },
  );

  server.post(
    '/opportunities/:id/commitments',
    {
      preHandler: requirePeopleWrite,
      schema: {
        params: IdParam,
        body: CustomerCommitmentCreate,
        response: { 201: CustomerCommitmentRow },
      },
    },
    async (req, reply) => {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, companyId: true },
      });
      if (!opportunity) notFound(server, 'Opportunity not found');
      if (!opportunity.companyId) {
        badRequest(server, 'Link this deal to an account before recording a customer commitment');
      }
      const intake = intakeCommitment({
        opportunityId: req.body.ambiguous === true ? null : opportunity.id,
        ambiguous: req.body.ambiguous === true,
      });
      if (req.body.ownerContactId) {
        const owner = await assertContactInOrg(req.auth.orgId, req.body.ownerContactId);
        if (!owner) badRequest(server, 'The customer owner is not in this account');
      }
      const created = await prisma.customerCommitment.create({
        data: {
          orgId: req.auth.orgId,
          companyId: opportunity.companyId,
          opportunityId: intake.opportunityId,
          promise: req.body.promise,
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          ownerContactId: req.body.ownerContactId ?? null,
          status: intake.status,
          sourceNote: req.body.sourceNote ?? null,
          createdByUserId: req.auth.userId,
        },
        select: { id: true },
      });
      const row = await serializeCommitment(req.auth.orgId, created.id);
      if (!row) notFound(server, 'Commitment not found');
      return reply.code(201).send(row);
    },
  );

  server.patch(
    '/commitments/:id',
    {
      preHandler: requirePeopleWrite,
      schema: { params: IdParam, body: CustomerCommitmentPatch, response: { 200: CustomerCommitmentRow } },
    },
    async (req) => {
      const existing = await prisma.customerCommitment.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) notFound(server, 'Commitment not found');
      let opportunityId = req.body.opportunityId;
      if (existing.status === 'needs_review' && opportunityId && req.body.status === undefined) {
        opportunityId = undefined;
      }
      if (opportunityId) {
        const deal = await prisma.opportunity.findFirst({
          where: { id: opportunityId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!deal) badRequest(server, 'That deal is not in this account');
      }
      if (req.body.ownerContactId) {
        const owner = await assertContactInOrg(req.auth.orgId, req.body.ownerContactId);
        if (!owner) badRequest(server, 'The customer owner is not in this account');
      }
      await prisma.customerCommitment.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId },
        data: {
          ...(req.body.promise !== undefined ? { promise: req.body.promise } : {}),
          ...(req.body.dueDate !== undefined
            ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
            : {}),
          ...(req.body.ownerContactId !== undefined ? { ownerContactId: req.body.ownerContactId } : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
          ...(req.body.sourceNote !== undefined ? { sourceNote: req.body.sourceNote } : {}),
          ...(opportunityId !== undefined ? { opportunityId } : {}),
        },
      });
      const row = await serializeCommitment(req.auth.orgId, existing.id);
      if (!row) notFound(server, 'Commitment not found');
      return row;
    },
  );
};
