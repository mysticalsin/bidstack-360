/**
 * Access policies (factory slice 5).
 *
 * A policy version moves draft -> pending -> approved -> published as vN. A
 * second admin approves: the author or submitter never can. Publishing
 * supersedes the live version; rollback republishes an earlier version's
 * rules as a new version. Every transition writes to the hash-chained audit
 * log in the same transaction.
 *
 * Rules only narrow the RBAC matrix. Enforcement (lib/access-policy-
 * enforcement.ts) is off unless ACCESS_POLICIES_ENFORCE=true; the simulation
 * works either way so admins can preview a policy before turning it on.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { Prisma, prisma, type AccessPolicyVersion } from '@bidstack/db';
import { ACCESS_POLICY_LIMITS, AccessPolicyRulesSchema } from '@bidstack/shared';

import {
  accessPolicyEnforcementEnabled,
  invalidateAccessPolicyCache,
  parseStoredRules,
} from '../lib/access-policy-enforcement.js';
import { simulateAccessPolicy } from '../lib/access-policy-simulation.js';

const STATUSES = ['draft', 'pending', 'approved', 'rejected', 'published', 'superseded'] as const;
const LIST_CAP = 100;

const PolicyDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(STATUSES),
  version: z.number().int().nullable(),
  rules: z.any(),
  createdById: z.string().uuid(),
  createdByName: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  rollbackOfId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

const IdParams = z.object({ id: z.string().uuid() });
const NoBody = z.object({}).strict().nullish();
const NoteBody = z.object({ note: z.string().trim().max(ACCESS_POLICY_LIMITS.noteLength).optional() }).strict();
const Name = z.string().trim().min(1).max(ACCESS_POLICY_LIMITS.nameLength);

const SimulationSide = z.object({
  count: z.number().int(),
  users: z.array(z.object({ userId: z.string(), name: z.string(), count: z.number().int() })),
  examples: z.array(
    z.object({
      at: z.string(),
      userId: z.string(),
      userName: z.string(),
      action: z.string(),
      resource: z.string(),
      targetId: z.string().nullable(),
      ruleId: z.string().nullable(),
    }),
  ),
});

type Tx = Prisma.TransactionClient;

async function userNames(orgId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { orgId, id: { in: unique } }, select: { id: true, name: true, email: true }, take: unique.length });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

function toDto(p: AccessPolicyVersion, names: Map<string, string>): z.infer<typeof PolicyDto> {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    version: p.version,
    rules: p.rules,
    createdById: p.createdById,
    createdByName: names.get(p.createdById) ?? null,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    approvedById: p.approvedById,
    approvedByName: p.approvedById ? (names.get(p.approvedById) ?? null) : null,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    decisionNote: p.decisionNote,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    rollbackOfId: p.rollbackOfId,
    createdAt: p.createdAt.toISOString(),
  };
}

async function dto(p: AccessPolicyVersion) {
  return toDto(p, await userNames(p.orgId, [p.createdById, p.approvedById]));
}

async function audit(tx: Tx, req: FastifyRequest, action: string, targetId: string, diff: Prisma.InputJsonObject) {
  await tx.auditLog.create({
    data: {
      org: { connect: { id: req.auth.orgId } },
      user: { connect: { id: req.auth.userId } },
      action: `access_policy.${action}`,
      targetType: 'access_policy',
      targetId,
      diff,
    },
  });
}

async function nextVersion(tx: Tx, orgId: string): Promise<number> {
  const max = await tx.accessPolicyVersion.aggregate({ where: { orgId }, _max: { version: true } });
  return (max._max.version ?? 0) + 1;
}

export const accessPoliciesRoutes: FastifyPluginAsyncZod = async (server) => {
  async function owned(req: FastifyRequest, id: string): Promise<AccessPolicyVersion> {
    const row = await prisma.accessPolicyVersion.findFirst({ where: { id, orgId: req.auth.orgId } });
    if (!row) throw server.httpErrors.notFound('Access policy not found');
    return row;
  }

  function conflictOnRace(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw server.httpErrors.conflict('Another version was published at the same time. Reload and try again.');
    }
    throw err;
  }

  server.get(
    '/access-policies',
    {
      preHandler: server.requirePermission('access-policies:read'),
      schema: {
        response: {
          200: z.object({
            items: z.array(PolicyDto),
            published: PolicyDto.nullable(),
            nextVersion: z.number().int(),
            enforcement: z.boolean(),
            viewerId: z.string(),
          }),
        },
      },
    },
    async (req) => {
      const rows = await prisma.accessPolicyVersion.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIST_CAP,
      });
      const names = await userNames(req.auth.orgId, rows.flatMap((r) => [r.createdById, r.approvedById]));
      const published = rows.find((r) => r.status === 'published') ?? null;
      const max = await prisma.accessPolicyVersion.aggregate({ where: { orgId: req.auth.orgId }, _max: { version: true } });
      return {
        items: rows.map((r) => toDto(r, names)),
        published: published ? toDto(published, names) : null,
        nextVersion: (max._max.version ?? 0) + 1,
        enforcement: accessPolicyEnforcementEnabled(),
        viewerId: req.auth.userId,
      };
    },
  );

  server.post(
    '/access-policies',
    {
      preHandler: [server.requirePermission('access-policies:write'), server.requireHumanActor()],
      schema: {
        body: z.object({ name: Name, rules: AccessPolicyRulesSchema }).strict(),
        response: { 201: PolicyDto },
      },
    },
    async (req, reply) => {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.accessPolicyVersion.create({
          data: {
            orgId: req.auth.orgId,
            name: req.body.name,
            rules: req.body.rules as Prisma.InputJsonValue,
            createdById: req.auth.userId,
          },
        });
        await audit(tx, req, 'create', created.id, { name: created.name, rules: req.body.rules.length });
        return created;
      });
      return reply.code(201).send(await dto(row));
    },
  );

  server.patch(
    '/access-policies/:id',
    {
      preHandler: [server.requirePermission('access-policies:write'), server.requireHumanActor()],
      schema: {
        params: IdParams,
        body: z.object({ name: Name.optional(), rules: AccessPolicyRulesSchema.optional() }).strict(),
        response: { 200: PolicyDto },
      },
    },
    async (req) => {
      const row = await owned(req, req.params.id);
      if (row.status !== 'draft' && row.status !== 'rejected') {
        throw server.httpErrors.conflict(`A ${row.status} policy cannot be edited. Start a new draft.`);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.accessPolicyVersion.update({
          where: { id: row.id },
          data: {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.rules !== undefined ? { rules: req.body.rules as Prisma.InputJsonValue } : {}),
            status: 'draft',
            submittedById: null,
            submittedAt: null,
          },
        });
        await audit(tx, req, 'update', row.id, {
          from: row.status,
          ...(req.body.rules !== undefined ? { rules: req.body.rules.length } : {}),
        });
        return next;
      });
      return dto(updated);
    },
  );

  server.post(
    '/access-policies/:id/submit',
    {
      preHandler: [server.requirePermission('access-policies:write'), server.requireHumanActor()],
      schema: { params: IdParams, body: NoBody, response: { 200: PolicyDto } },
    },
    async (req) => {
      const row = await owned(req, req.params.id);
      if (row.status !== 'draft' && row.status !== 'rejected') {
        throw server.httpErrors.conflict(`Only a draft can be submitted (this one is ${row.status})`);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.accessPolicyVersion.update({
          where: { id: row.id },
          data: { status: 'pending', submittedById: req.auth.userId, submittedAt: new Date(), decisionNote: null },
        });
        await audit(tx, req, 'submit', row.id, { name: row.name });
        return next;
      });
      return dto(updated);
    },
  );

  for (const decision of ['approve', 'reject'] as const) {
    server.post(
      `/access-policies/:id/${decision}`,
      {
        preHandler: [server.requirePermission('access-policies:approve'), server.requireHumanActor()],
        schema: { params: IdParams, body: NoteBody, response: { 200: PolicyDto } },
      },
      async (req) => {
        const row = await owned(req, req.params.id);
        if (row.createdById === req.auth.userId || row.submittedById === req.auth.userId) {
          throw server.httpErrors.forbidden('A second admin must review this policy. You wrote or submitted it.');
        }
        if (row.status !== 'pending') {
          throw server.httpErrors.conflict(`Only a pending policy can be reviewed (this one is ${row.status})`);
        }
        const note = req.body.note || null;
        const updated = await prisma.$transaction(async (tx) => {
          const next = await tx.accessPolicyVersion.update({
            where: { id: row.id },
            data:
              decision === 'approve'
                ? { status: 'approved', approvedById: req.auth.userId, approvedAt: new Date(), decisionNote: note }
                : { status: 'rejected', decisionNote: note },
          });
          await audit(tx, req, decision, row.id, { name: row.name, note });
          return next;
        });
        return dto(updated);
      },
    );
  }

  server.post(
    '/access-policies/:id/publish',
    {
      preHandler: [server.requirePermission('access-policies:write'), server.requireHumanActor()],
      schema: { params: IdParams, body: NoBody, response: { 200: PolicyDto } },
    },
    async (req) => {
      const row = await owned(req, req.params.id);
      if (row.status !== 'approved') {
        throw server.httpErrors.conflict(`Only an approved policy can be published (this one is ${row.status})`);
      }
      const published = await prisma
        .$transaction(async (tx) => {
          const version = await nextVersion(tx, req.auth.orgId);
          const previous = await tx.accessPolicyVersion.findFirst({
            where: { orgId: req.auth.orgId, status: 'published' },
            select: { id: true, version: true },
          });
          if (previous) {
            await tx.accessPolicyVersion.update({ where: { id: previous.id }, data: { status: 'superseded' } });
          }
          const next = await tx.accessPolicyVersion.update({
            where: { id: row.id },
            data: { status: 'published', version, publishedAt: new Date(), publishedById: req.auth.userId },
          });
          await audit(tx, req, 'publish', row.id, {
            version,
            supersedes: previous?.version ?? null,
            approvedById: row.approvedById,
          });
          return next;
        })
        .catch(conflictOnRace);
      invalidateAccessPolicyCache(req.auth.orgId);
      return dto(published);
    },
  );

  server.post(
    '/access-policies/:id/rollback',
    {
      preHandler: [server.requirePermission('access-policies:write'), server.requireHumanActor()],
      schema: { params: IdParams, body: NoBody, response: { 200: PolicyDto } },
    },
    async (req) => {
      const target = await owned(req, req.params.id);
      if (target.status !== 'superseded' || target.version === null) {
        throw server.httpErrors.conflict('Only an earlier published version can be rolled back to');
      }
      const restored = await prisma
        .$transaction(async (tx) => {
          const version = await nextVersion(tx, req.auth.orgId);
          const live = await tx.accessPolicyVersion.findFirst({
            where: { orgId: req.auth.orgId, status: 'published' },
            select: { id: true, version: true },
          });
          if (live) await tx.accessPolicyVersion.update({ where: { id: live.id }, data: { status: 'superseded' } });
          const now = new Date();
          const next = await tx.accessPolicyVersion.create({
            data: {
              orgId: req.auth.orgId,
              name: `Rollback to v${target.version}`,
              status: 'published',
              version,
              rules: target.rules as Prisma.InputJsonValue,
              createdById: req.auth.userId,
              publishedById: req.auth.userId,
              publishedAt: now,
              rollbackOfId: target.id,
            },
          });
          await audit(tx, req, 'rollback', next.id, {
            version,
            restoresVersion: target.version,
            supersedes: live?.version ?? null,
          });
          return next;
        })
        .catch(conflictOnRace);
      invalidateAccessPolicyCache(req.auth.orgId);
      return dto(restored);
    },
  );

  server.post(
    '/access-policies/simulate',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('access-policies:write'),
      schema: {
        body: z.object({ rules: AccessPolicyRulesSchema }).strict(),
        response: {
          200: z.object({
            window: z.object({ from: z.string(), to: z.string() }),
            evaluated: z.number().int(),
            baselineVersion: z.number().int().nullable(),
            gained: SimulationSide,
            lost: SimulationSide,
            byDay: z.array(z.object({ day: z.string(), gained: z.number().int(), lost: z.number().int() })),
          }),
        },
      },
    },
    async (req) => {
      const live = await prisma.accessPolicyVersion.findFirst({
        where: { orgId: req.auth.orgId, status: 'published' },
        select: { version: true, rules: true },
      });
      return simulateAccessPolicy({
        orgId: req.auth.orgId,
        draft: req.body.rules,
        baseline: live ? parseStoredRules(live.rules) : [],
        baselineVersion: live?.version ?? null,
      });
    },
  );
};
