// Consulting partners on an account (slice 15): which third-party consulting
// firms work with the client and how we position against each one. The worker
// stores evidence rows (apps/worker/src/lib/consulting-partners); these routes
// filter them by the caller's access and compose the cards. No fetch happens
// on a read.
//
// Security model
//  * RBAC: account-intel:read for reads, account-intel:write to queue a refresh.
//  * Org + scope isolation: the company must be in the caller's org and access
//    scope (applyCompanyScope). Misses answer 404.
//  * Internal evidence: each row is shown only if the caller can read the
//    record it quotes (consulting-partners/visibility.ts). API keys get public
//    evidence only.
//  * Audit: reads (once per window) and refreshes write audit_log.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  type Prisma,
  countPartnerEngagements,
  loadOrgFirmCatalog,
  loadPartnerEvidenceRows,
  loadPartnerRun,
  prisma,
  toPartnerEvidence,
} from '@bidstack/db';
import {
  composeConsultingPartners,
  ConsultingPartnersRefreshResponse,
  ConsultingPartnersSummary,
  FirmKey,
  PartnerEvidenceQuery,
  PartnerEvidencePage,
} from '@bidstack/shared';

import { visiblePartnerRows } from '../consulting-partners/visibility.js';
import { applyCompanyScope, applyOpportunityScope, getAccessScope, type AccessScope } from '../lib/access-scope.js';
import { enqueueConsultingPartners } from '../queues/consulting-partners.js';

const idParam = z.object({ id: z.string().uuid() });
const partnerParam = z.object({ id: z.string().uuid(), partnerId: FirmKey });
const READ = { permission: 'account-intel:read' as const, rateLimit: { max: 60, timeWindow: '1 minute' } };
const READ_AUDIT_WINDOW_MS = 5 * 60_000;
const lastReadAudit = new Map<string, number>();

function shouldAuditRead(key: string, now = Date.now()): boolean {
  const last = lastReadAudit.get(key);
  if (last !== undefined && now - last < READ_AUDIT_WINDOW_MS) return false;
  if (lastReadAudit.size > 10_000) lastReadAudit.clear();
  lastReadAudit.set(key, now);
  return true;
}

async function audit(req: FastifyRequest, action: string, targetId: string, diff: Record<string, unknown> = {}): Promise<void> {
  await prisma.auditLog.create({
    data: { orgId: req.auth.orgId, userId: req.auth.userId, action, targetType: 'company', targetId, diff: diff as Prisma.InputJsonValue },
  });
}

async function loadCompany(req: FastifyRequest): Promise<{ company: { id: string; name: string } | null; scope: AccessScope }> {
  const params = req.params as { id: string };
  const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
  const company = await prisma.company.findFirst({
    where: applyCompanyScope({ id: params.id, orgId: req.auth.orgId, deletedAt: null }, scope),
    select: { id: true, name: true },
  });
  return { company, scope };
}

/** Consulting partner routes under /companies/:id/consulting-partners. */
export const consultingPartnersRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/companies/:id/consulting-partners',
    { config: READ, schema: { params: idParam, response: { 200: ConsultingPartnersSummary } } },
    async (req) => {
      const { company, scope } = await loadCompany(req);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const orgId = req.auth.orgId;
      const [rows, firms, run, engagements] = await Promise.all([
        loadPartnerEvidenceRows(prisma, orgId, company.id),
        loadOrgFirmCatalog(prisma, orgId, process.env.CONSULTING_PARTNER_FIRMS),
        loadPartnerRun(prisma, orgId, company.id),
        server.hasPermission(req, 'opportunities:read').then((ok) =>
          ok ? countPartnerEngagements(prisma, orgId, company.id, applyOpportunityScope({}, scope)) : { won: 0, open: 0 },
        ),
      ]);
      const visible = await visiblePartnerRows(server, req, rows);
      if (shouldAuditRead(`${orgId}:${req.auth.userId}:${company.id}:partners`)) await audit(req, 'partners.view', company.id);
      return composeConsultingPartners({
        companyId: company.id,
        clientName: company.name,
        firms,
        evidence: visible.map(toPartnerEvidence),
        engagements,
        run,
        now: new Date(),
      });
    },
  );

  server.get(
    '/companies/:id/consulting-partners/:partnerId/evidence',
    { config: READ, schema: { params: partnerParam, querystring: PartnerEvidenceQuery, response: { 200: PartnerEvidencePage } } },
    async (req) => {
      const { company } = await loadCompany(req);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const { partnerId } = req.params;
      const { cursor, limit, origin } = req.query;
      const rows = (await loadPartnerEvidenceRows(prisma, req.auth.orgId, company.id)).filter((r) => r.firmKey === partnerId);
      const visible = (await visiblePartnerRows(server, req, rows)).map(toPartnerEvidence).filter((e) => !origin || e.origin === origin);
      const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
      const items = visible.slice(start, start + limit);
      const next = start + items.length;
      return { firmKey: partnerId, items, nextCursor: next < visible.length ? String(next) : null };
    },
  );

  server.post(
    '/companies/:id/consulting-partners/refresh',
    {
      config: { permission: 'account-intel:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: idParam, response: { 202: ConsultingPartnersRefreshResponse } },
    },
    async (req, reply) => {
      const { company } = await loadCompany(req);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const orgId = req.auth.orgId;
      const key = { orgId_companyId: { orgId, companyId: company.id } };
      const before = await prisma.consultingPartnerRun.findUnique({ where: key });
      // Queued is written first so a fast worker's final status is never overwritten.
      await prisma.consultingPartnerRun.upsert({ where: key, create: { orgId, companyId: company.id, status: 'queued' }, update: { status: 'queued' } });
      const jobId = await enqueueConsultingPartners({ kind: 'refresh', orgId, companyId: company.id, requestedBy: req.auth.userId });
      if (!jobId) {
        if (before) await prisma.consultingPartnerRun.update({ where: key, data: { status: before.status } });
        else await prisma.consultingPartnerRun.delete({ where: key });
      }
      await audit(req, 'partners.refresh', company.id, { queued: jobId !== null });
      reply.code(202);
      return { queued: jobId !== null, run: await loadPartnerRun(prisma, orgId, company.id) };
    },
  );
};
