// Ranked MSA whitespace and "who works with them" (slice 13b).
//
//   GET  /msa/whitespace                  msa:read   ranked flags, filters
//   GET  /msa/whitespace/digest           msa:read   my top 3 new flags + email draft
//   GET  /msa/:id/whitespace              msa:read   flag for one MSA
//   POST /msa/:id/whitespace/accept       msa:write  CrossSellAction (+ draft opportunity)
//   POST /msa/:id/whitespace/dismiss      msa:write  dismiss one line with a reason
//   GET  /companies/:id/relationship-map  msa:read   entities, lines, owners, activity
//
// Accept and dismiss need a user session and are audited. Nothing is created
// until a person clicks.
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { loadRelationshipMap, loadWhitespaceFlags, prisma, type Prisma } from '@bidstack/db';
import {
  buildWhitespaceDigest,
  isoWeek,
  labelBusinessLine,
  normalizeName,
  RelationshipMap,
  resolveWhitespaceDecision,
  WhitespaceAccept,
  WhitespaceDecisionResponse,
  WhitespaceDismiss,
  WhitespaceFlag,
  WhitespaceListQuery,
  WhitespaceListResponse,
  type WhitespaceFacets as WhitespaceFacetsT,
  type WhitespaceFlag as WhitespaceFlagT,
} from '@bidstack/shared';

import { applyCompanyScope, applyOpportunityScope, getAccessScope, isApiKeyActor } from '../lib/access-scope.js';
import { isUniqueViolation, mintNextCode } from './opportunities.helpers.js';

const IdParams = z.object({ id: z.string().uuid() });

async function scopedCompanyWhere(req: FastifyRequest): Promise<Prisma.CompanyWhereInput> {
  const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
  return applyCompanyScope({ orgId: req.auth.orgId, deletedAt: null }, scope);
}

/**
 * Decision time strictly after the line's latest decision. Read under the MSA
 * row lock: now() would be the transaction start, which can predate a
 * decision committed while this transaction waited for the lock.
 */
function later(latest: Date | undefined): Date {
  const now = new Date();
  return latest && latest.getTime() >= now.getTime() ? new Date(latest.getTime() + 1) : now;
}

async function nextDecidedAt(tx: Prisma.TransactionClient, orgId: string, contractId: string, line: string): Promise<Date> {
  const latest = await tx.msaWhitespaceDecision.findFirst({
    where: { orgId, contractId, line },
    orderBy: { decidedAt: 'desc' },
    select: { decidedAt: true },
  });
  return later(latest?.decidedAt);
}

/** Lines a person can filter, including a decision whose line is not on `lines`. */
export function whitespaceFlagLines(flag: WhitespaceFlagT): string[] {
  return [...new Set([...flag.lines, ...flag.decisions.map((decision) => decision.line)])];
}

export function whitespaceFacets(flags: WhitespaceFlagT[]): WhitespaceFacetsT {
  const entities = new Map<string, string>();
  const owners = new Map<string, string>();
  const countries = new Set<string>();
  const lines = new Set<string>();
  for (const f of flags) {
    entities.set(f.signingEntity.id, f.signingEntity.name);
    if (f.owner) owners.set(f.owner.id, f.owner.name);
    f.countries.forEach((c) => countries.add(c));
    whitespaceFlagLines(f).forEach((l) => lines.add(l));
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    entities: [...entities].map(([id, name]) => ({ id, name })).sort(byName),
    countries: [...countries].sort(),
    lines: [...lines].sort(),
    owners: [...owners].map(([id, name]) => ({ id, name })).sort(byName),
  };
}

export function filterWhitespace(flags: WhitespaceFlagT[], q: z.infer<typeof WhitespaceListQuery>): WhitespaceFlagT[] {
  return flags.filter(
    (f) =>
      (q.state === 'all' || f.state === q.state) &&
      (!q.line || whitespaceFlagLines(f).includes(q.line)) &&
      (!q.signingEntityId || f.signingEntity.id === q.signingEntityId) &&
      (!q.country || f.global || f.countries.includes(q.country)) &&
      (!q.ownerId || f.owner?.id === q.ownerId) &&
      (!q.companyId || f.companyId === q.companyId),
  );
}

export const msaWhitespaceRoutes: FastifyPluginAsyncZod = async (server) => {
  function assertHuman(req: FastifyRequest): void {
    if (req.auth.role === 'api' || isApiKeyActor(req.auth.userId)) {
      throw server.httpErrors.forbidden('Whitespace decisions need a user session');
    }
  }

  async function flagFor(req: FastifyRequest, msaId: string): Promise<WhitespaceFlagT> {
    const where = await scopedCompanyWhere(req);
    const [flag] = await loadWhitespaceFlags(prisma, req.auth.orgId, where, { msaId });
    if (!flag) throw server.httpErrors.notFound('No whitespace for this MSA');
    return flag;
  }

  async function refreshed(req: FastifyRequest, msaId: string): Promise<WhitespaceFlagT | null> {
    const where = await scopedCompanyWhere(req);
    const [flag] = await loadWhitespaceFlags(prisma, req.auth.orgId, where, { msaId });
    return flag ?? null;
  }

  server.get(
    '/msa/whitespace',
    { config: { permission: 'msa:read' }, schema: { querystring: WhitespaceListQuery, response: { 200: WhitespaceListResponse } } },
    async (req) => {
      const where = await scopedCompanyWhere(req);
      const all = await loadWhitespaceFlags(prisma, req.auth.orgId, where, { companyId: req.query.companyId });
      const filtered = filterWhitespace(all, req.query);
      const byLine = new Map<string, { count: number; topScore: number }>();
      for (const f of filtered) {
        for (const line of whitespaceFlagLines(f)) {
          const row = byLine.get(line) ?? { count: 0, topScore: 0 };
          row.count += 1;
          row.topScore = Math.max(row.topScore, f.score);
          byLine.set(line, row);
        }
      }
      return {
        items: filtered.slice(0, req.query.limit),
        total: filtered.length,
        byLine: [...byLine.entries()].map(([line, v]) => ({ line, ...v })).sort((a, b) => b.count - a.count),
        facets: whitespaceFacets(all),
      };
    },
  );

  server.get(
    '/msa/whitespace/digest',
    {
      config: { permission: 'msa:read' },
      schema: {
        response: {
          200: z.object({
            week: z.string(),
            digest: z
              .object({
                flags: z.array(WhitespaceFlag),
                url: z.string(),
                title: z.string(),
                body: z.string(),
                email: z.object({ subject: z.string(), body: z.string() }),
              })
              .nullable(),
          }),
        },
      },
    },
    async (req) => {
      assertHuman(req);
      const week = isoWeek(new Date());
      const where = await scopedCompanyWhere(req);
      const all = await loadWhitespaceFlags(prisma, req.auth.orgId, where);
      const mine = all.filter((f) => f.owner?.id === req.auth.userId);
      return { week, digest: buildWhitespaceDigest(mine, { ownerName: mine[0]?.owner?.name ?? 'there', week }) };
    },
  );

  server.get(
    '/msa/:id/whitespace',
    { config: { permission: 'msa:read' }, schema: { params: IdParams, response: { 200: z.object({ flag: WhitespaceFlag.nullable() }) } } },
    async (req) => ({ flag: await refreshed(req, req.params.id) }),
  );

  server.post(
    '/msa/:id/whitespace/accept',
    {
      config: { permission: 'msa:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: IdParams, body: WhitespaceAccept, response: { 201: WhitespaceDecisionResponse } },
    },
    async (req, reply) => {
      assertHuman(req);
      const flag = await flagFor(req, req.params.id);
      const { line, ownerId, dueDate, createOpportunity, note } = req.body;
      if (!flag.lines.includes(line) && !flag.decisions.some((d) => d.line === line)) {
        throw server.httpErrors.badRequest('This line is not open on this MSA');
      }
      if (flag.decisions.some((d) => d.line === line && d.state === 'accepted')) {
        throw server.httpErrors.conflict('This line is already accepted');
      }
      const owner = await prisma.user.findFirst({ where: { id: ownerId, orgId: req.auth.orgId, deletedAt: null }, select: { id: true } });
      if (!owner) throw server.httpErrors.badRequest('Owner is not a member of this org');
      const label = labelBusinessLine(line);
      const entity = flag.signingEntity.slug === 'hema' ? 'HEMA' : flag.signingEntity.name;

      let result: { crossSellActionId: string; opportunityId: string | null } | null = null;
      for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
        try {
          result = await prisma.$transaction(async (tx) => {
            // Serialize accepts on this MSA so a double click cannot create two actions.
            await tx.$queryRaw`SELECT id FROM contract_agreements WHERE id = ${flag.msaId}::uuid FOR UPDATE`;
            const taken = await tx.msaWhitespaceDecision.findFirst({
              where: { orgId: req.auth.orgId, contractId: flag.msaId, line, state: 'accepted' },
              select: { id: true },
            });
            if (taken) throw server.httpErrors.conflict('This line is already accepted');
            const decidedAt = await nextDecidedAt(tx, req.auth.orgId, flag.msaId, line);
            const action = await tx.crossSellAction.create({
              data: {
                orgId: req.auth.orgId,
                accountKey: normalizeName(flag.companyName),
                description: `${flag.headline}. Open ${label} under the ${entity} MSA.`.slice(0, 1000),
                requestingUnit: entity,
                assignedUnit: label,
                assigneeId: ownerId,
                dueDate: new Date(`${dueDate}T00:00:00.000Z`),
                notes: note ?? null,
                createdById: req.auth.userId,
              },
              select: { id: true },
            });
            let opportunityId: string | null = null;
            if (createOpportunity) {
              const opp = await tx.opportunity.create({
                data: {
                  orgId: req.auth.orgId,
                  code: await mintNextCode(tx, req.auth.orgId),
                  customer: flag.companyName,
                  companyId: flag.companyId,
                  name: `${flag.companyName} ${label} via ${entity} MSA`.slice(0, 200),
                  stage: 's1_lead',
                  ownerId,
                  dueDate: new Date(`${dueDate}T00:00:00.000Z`),
                  country: flag.countries[0] ?? null,
                },
                select: { id: true },
              });
              opportunityId = opp.id;
            }
            await tx.msaWhitespaceDecision.create({
              data: {
                orgId: req.auth.orgId,
                contractId: flag.msaId,
                companyId: flag.companyId,
                line,
                state: 'accepted',
                evidenceHash: flag.evidenceHash,
                score: flag.score,
                decidedById: req.auth.userId,
                crossSellActionId: action.id,
                opportunityId,
                decidedAt,
              },
            });
            await tx.auditLog.create({
              data: {
                orgId: req.auth.orgId,
                userId: req.auth.userId,
                action: 'msa.whitespace.accepted',
                targetType: 'contract_agreement',
                targetId: flag.msaId,
                diff: { line, score: flag.score, evidenceHash: flag.evidenceHash, crossSellActionId: action.id, opportunityId, ownerId, dueDate },
              },
            });
            return { crossSellActionId: action.id, opportunityId };
          });
        } catch (err) {
          if (!isUniqueViolation(err) || attempt === 2) throw err;
        }
      }
      return reply.code(201).send({ flag: await refreshed(req, flag.msaId), ...result! });
    },
  );

  server.post(
    '/msa/:id/whitespace/dismiss',
    {
      config: { permission: 'msa:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: IdParams, body: WhitespaceDismiss, response: { 200: WhitespaceDecisionResponse } },
    },
    async (req) => {
      assertHuman(req);
      const flag = await flagFor(req, req.params.id);
      const { line, reason } = req.body;
      if (!flag.lines.includes(line) || flag.decisions.some((d) => d.line === line)) {
        throw server.httpErrors.badRequest('This line is not open on this MSA');
      }
      await prisma.$transaction(async (tx) => {
        // Same lock as accept, then decide again: an accept that committed
        // while this request was reading wins.
        await tx.$queryRaw`SELECT id FROM contract_agreements WHERE id = ${flag.msaId}::uuid FOR UPDATE`;
        const latest = await tx.msaWhitespaceDecision.findFirst({
          where: { orgId: req.auth.orgId, contractId: flag.msaId, line },
          orderBy: { decidedAt: 'desc' },
          select: { line: true, state: true, evidenceHash: true, reason: true, decidedAt: true },
        });
        const decidedAt = later(latest?.decidedAt);
        if (latest) {
          const current = resolveWhitespaceDecision(
            [{ ...latest, state: latest.state as 'accepted' | 'dismissed', decidedAt: latest.decidedAt.toISOString() }],
            line,
            flag.evidenceHash,
          );
          if (current.state !== 'new') throw server.httpErrors.conflict(`This line is already ${current.state}`);
        }
        await tx.msaWhitespaceDecision.create({
          data: {
            orgId: req.auth.orgId,
            contractId: flag.msaId,
            companyId: flag.companyId,
            line,
            state: 'dismissed',
            reason,
            evidenceHash: flag.evidenceHash,
            score: flag.score,
            decidedById: req.auth.userId,
            decidedAt,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'msa.whitespace.dismissed',
            targetType: 'contract_agreement',
            targetId: flag.msaId,
            diff: { line, reason, score: flag.score, evidenceHash: flag.evidenceHash },
          },
        });
      });
      return { flag: await refreshed(req, flag.msaId), crossSellActionId: null, opportunityId: null };
    },
  );

  server.get(
    '/companies/:id/relationship-map',
    { config: { permission: 'msa:read' }, schema: { params: IdParams, response: { 200: RelationshipMap } } },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const where = applyCompanyScope({ orgId: req.auth.orgId, deletedAt: null }, scope);
      const opportunityWhere = applyOpportunityScope({ orgId: req.auth.orgId }, scope);
      const map = await loadRelationshipMap(prisma, req.auth.orgId, req.params.id, where, opportunityWhere);
      if (!map) throw server.httpErrors.notFound('Account not found');
      return map;
    },
  );
};
