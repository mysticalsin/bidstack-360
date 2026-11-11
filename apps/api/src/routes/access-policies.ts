/**
 * Access policies (factory slice 5).
 *
 * A policy version moves draft -> pending -> approved -> published as vN. A
 * second admin approves: the author or submitter never can, and only the
 * author edits. Publishing supersedes the live version; rollback files an
 * earlier version's rules as a new pending request that needs the same second
 * approval. Each transition is conditional on the status and updatedAt it was
 * read with and writes to the hash-chained audit log in the same transaction.
 *
 * Rules only narrow the RBAC matrix. Enforcement (lib/access-policy-
 * enforcement.ts) is off unless ACCESS_POLICIES_ENFORCE=true; the simulation
 * works either way so admins can preview a policy before turning it on.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { Prisma, prisma, type AccessPolicyVersion } from '@bidstack/db';
import {
  ACCESS_POLICY_LIMITS,
  ACCESS_POLICY_STATUSES,
  AccessPolicyRulesSchema,
  accessPolicyFromStatuses,
  accessPolicyStatusAfter,
  accessPolicyTransition,
} from '@bidstack/shared';

import {
  accessPolicyEnforcementEnabled,
  invalidateAccessPolicyCache,
  parseStoredRules,
} from '../lib/access-policy-enforcement.js';
import { simulateAccessPolicy } from '../lib/access-policy-simulation.js';

const STATUSES = ACCESS_POLICY_STATUSES;
const LIST_CAP = 100;

const PolicyDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(STATUSES),
  version: z.number().int().nullable(),
  rules: z.any(),
  createdById: z.string().uuid(),
  createdByName: z.string().nullable(),
  submittedById: z.string().uuid().nullable(),
  submittedAt: z.string().datetime().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  rollbackOfId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const IdParams = z.object({ id: z.string().uuid() });
const NoBody = z.object({}).strict().nullish();
const DecisionBody = z
  .object({
    note: z.string().trim().max(ACCESS_POLICY_LIMITS.noteLength).optional(),
    /** The updatedAt of the version the reviewer read; a later edit makes the decision stale. */
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();
const Name = z.string().trim().min(1).max(ACCESS_POLICY_LIMITS.nameLength);

const SimulationSide = z.object({
  count: z.number().int(),
  userCount: z.number().int(),
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
type Status = (typeof STATUSES)[number];

/** Display names only: emails stay out of a response every admin screen reads. */
async function userNames(orgId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { orgId, id: { in: unique } }, select: { id: true, name: true }, take: unique.length });
  return new Map(users.flatMap((u) => (u.name ? [[u.id, u.name] as const] : [])));
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
    submittedById: p.submittedById,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    approvedById: p.approvedById,
    approvedByName: p.approvedById ? (names.get(p.approvedById) ?? null) : null,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    decisionNote: p.decisionNote,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    rollbackOfId: p.rollbackOfId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
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

  /**
   * Moves a row only if it still has the status and updatedAt it was read
   * with, so concurrent transitions cannot both win.
   */
  async function transition(
    tx: Tx,
    row: AccessPolicyVersion,
    from: readonly Status[],
    data: Prisma.AccessPolicyVersionUpdateManyMutationInput,
  ): Promise<AccessPolicyVersion> {
    const moved = await tx.accessPolicyVersion.updateMany({
      where: { id: row.id, orgId: row.orgId, status: { in: [...from] }, updatedAt: row.updatedAt },
      data,
    });
    if (moved.count === 0) {
      throw server.httpErrors.conflict('This policy changed since it was loaded. Reload and try again.');
    }
    return tx.accessPolicyVersion.findFirstOrThrow({ where: { id: row.id, orgId: row.orgId } });
  }

  function assertAuthor(req: FastifyRequest, row: AccessPolicyVersion, what: string): void {
    if (row.createdById !== req.auth.userId) {
      throw server.httpErrors.forbidden(`Only the author can ${what} this policy. Start your own draft instead.`);
    }
  }

  function assertValidRules(row: AccessPolicyVersion): void {
    if (!AccessPolicyRulesSchema.safeParse(row.rules).success) {
      throw server.httpErrors.conflict('These rules no longer pass validation. Start a new draft from them.');
    }
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
      const [rows, published, max] = await Promise.all([
        prisma.accessPolicyVersion.findMany({
          where: { orgId: req.auth.orgId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: LIST_CAP,
        }),
        // Read on its own so the live version shows however many drafts follow it.
        prisma.accessPolicyVersion.findFirst({ where: { orgId: req.auth.orgId, status: 'published' } }),
        prisma.accessPolicyVersion.aggregate({ where: { orgId: req.auth.orgId }, _max: { version: true } }),
      ]);
      const names = await userNames(
        req.auth.orgId,
        [...rows, ...(published ? [published] : [])].flatMap((r) => [r.createdById, r.approvedById]),
      );
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
      // Only the author edits, so a reviewer can never approve rules they wrote.
      assertAuthor(req, row, 'edit');
      if (row.status !== 'draft' && row.status !== 'rejected') {
        throw server.httpErrors.conflict(`A ${row.status} policy cannot be edited. Start a new draft.`);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const next = await transition(tx, row, ['draft', 'rejected'], {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.rules !== undefined ? { rules: req.body.rules as Prisma.InputJsonValue } : {}),
          status: 'draft',
          submittedById: null,
          submittedAt: null,
          approvedById: null,
          approvedAt: null,
          decisionNote: null,
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
      assertAuthor(req, row, 'submit');
      if (!accessPolicyTransition(row.status, 'submit').ok) {
        throw server.httpErrors.conflict(`Only a draft can be submitted (this one is ${row.status})`);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const next = await transition(tx, row, accessPolicyFromStatuses('submit'), {
          status: accessPolicyStatusAfter(row.status, 'submit'),
          submittedById: req.auth.userId,
          submittedAt: new Date(),
          decisionNote: null,
        });
        await audit(tx, req, 'submit', row.id, { name: row.name });
        return next;
      });
      return dto(updated);
    },
  );

  server.post(
    '/access-policies/:id/withdraw',
    {
      preHandler: [server.requirePermission('access-policies:write'), server.requireHumanActor()],
      schema: { params: IdParams, body: NoBody, response: { 200: PolicyDto } },
    },
    async (req) => {
      const row = await owned(req, req.params.id);
      if (row.createdById !== req.auth.userId && row.submittedById !== req.auth.userId) {
        throw server.httpErrors.forbidden('Only the author or submitter can withdraw this policy.');
      }
      if (!accessPolicyTransition(row.status, 'withdraw').ok) {
        throw server.httpErrors.conflict(`Only a pending policy can be withdrawn (this one is ${row.status})`);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const next = await transition(tx, row, accessPolicyFromStatuses('withdraw'), {
          status: accessPolicyStatusAfter(row.status, 'withdraw'),
          submittedById: null,
          submittedAt: null,
        });
        await audit(tx, req, 'withdraw', row.id, { name: row.name });
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
        schema: { params: IdParams, body: DecisionBody, response: { 200: PolicyDto } },
      },
      async (req) => {
        const row = await owned(req, req.params.id);
        if (row.createdById === req.auth.userId || row.submittedById === req.auth.userId) {
          throw server.httpErrors.forbidden('A second admin must review this policy. You wrote or submitted it.');
        }
        const review = decision === 'approve' ? 'approve' : 'reject';
        if (!accessPolicyTransition(row.status, review).ok) {
          throw server.httpErrors.conflict(`Only a pending policy can be reviewed (this one is ${row.status})`);
        }
        if (row.updatedAt.toISOString() !== req.body.expectedUpdatedAt) {
          throw server.httpErrors.conflict('This policy changed after you opened it. Reload and review it again.');
        }
        const note = req.body.note || null;
        const updated = await prisma.$transaction(async (tx) => {
          const next = await transition(
            tx,
            row,
            accessPolicyFromStatuses(review),
            decision === 'approve'
              ? { status: accessPolicyStatusAfter(row.status, 'approve'), approvedById: req.auth.userId, approvedAt: new Date(), decisionNote: note }
              : { status: accessPolicyStatusAfter(row.status, 'reject'), approvedById: null, approvedAt: null, decisionNote: note },
          );
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
      if (!accessPolicyTransition(row.status, 'publish').ok) {
        throw server.httpErrors.conflict(`Only an approved policy can be published (this one is ${row.status})`);
      }
      assertValidRules(row);
      const published = await prisma
        .$transaction(async (tx) => {
          const version = await nextVersion(tx, req.auth.orgId);
          const previous = await tx.accessPolicyVersion.findFirst({
            where: { orgId: req.auth.orgId, status: 'published' },
            select: { id: true, version: true },
          });
          if (previous) {
            await tx.accessPolicyVersion.updateMany({
              where: { id: previous.id, orgId: req.auth.orgId, status: 'published' },
              data: { status: accessPolicyStatusAfter('published', 'supersede') },
            });
          }
          const next = await transition(tx, row, accessPolicyFromStatuses('publish'), {
            status: accessPolicyStatusAfter(row.status, 'publish'),
            version,
            publishedAt: new Date(),
            publishedById: req.auth.userId,
          });
          await audit(tx, req, 'publish', row.id, {
            version,
            supersedes: previous?.version ?? null,
            approvedById: row.approvedById,
            ...(row.rollbackOfId ? { rollbackOfId: row.rollbackOfId } : {}),
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
      schema: { params: IdParams, body: NoBody, response: { 201: PolicyDto } },
    },
    async (req, reply) => {
      const target = await owned(req, req.params.id);
      if (target.status !== 'superseded' || target.version === null) {
        throw server.httpErrors.conflict('Only an earlier published version can be rolled back to');
      }
      assertValidRules(target);
      // A rollback can loosen the live policy, so it goes through the same
      // second-admin approval as any other change before it is published.
      const request = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const created = await tx.accessPolicyVersion.create({
          data: {
            orgId: req.auth.orgId,
            name: `Rollback to v${target.version}`,
            status: 'pending',
            rules: target.rules as Prisma.InputJsonValue,
            createdById: req.auth.userId,
            submittedById: req.auth.userId,
            submittedAt: now,
            rollbackOfId: target.id,
          },
        });
        await audit(tx, req, 'rollback_request', created.id, { restoresVersion: target.version, rollbackOfId: target.id });
        return created;
      });
      return reply.code(201).send(await dto(request));
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
            recordOnly: z.number().int(),
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
