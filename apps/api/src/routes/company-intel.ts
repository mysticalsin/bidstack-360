// Account intelligence read model: direction, hiring, financials and news for
// one CRM company. The worker fetches and stores facts with their evidence
// (apps/worker/src/lib/account-intel); these routes compose and read.
//
// Security model
//  * RBAC: account-intel:read for reads, account-intel:write to queue a refresh.
//  * Org + scope isolation: the company must be in the caller's org and access
//    scope (applyCompanyScope). Misses answer 404.
//  * Audit: every read and refresh writes audit_log (targetType company).
//  * Rate limits per route; refresh never blocks on the fetch.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  type Prisma,
  loadCompanyIntel,
  prisma,
  readCompanyIntelSummaries,
  readImportBatches,
} from '@bidstack/db';
import {
  AccountDirection,
  AccountFinancialsIntel,
  AccountHiringIntel,
  AccountNewsIntel,
  CompanyIntelSummary,
  composeAccountIntel,
  INTEL_SOURCE_LABEL,
  IntelRefreshBody,
  IntelImportBatchView,
  IntelRefreshResponse,
  type IntelSourceStatus,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { enqueueAccountIntel, enqueueCompanyFullRefresh } from '../queues/account-intel.js';

const idParam = z.object({ id: z.string().uuid() });
/** One read audit per user, account and view in this window; refresh polling would otherwise write one per poll. */
const READ_AUDIT_WINDOW_MS = 5 * 60_000;
const lastReadAudit = new Map<string, number>();

function shouldAuditRead(key: string, now = Date.now()): boolean {
  const last = lastReadAudit.get(key);
  if (last !== undefined && now - last < READ_AUDIT_WINDOW_MS) return false;
  if (lastReadAudit.size > 10_000) lastReadAudit.clear();
  lastReadAudit.set(key, now);
  return true;
}
const READ = {
  permission: 'account-intel:read' as const,
  rateLimit: { max: 60, timeWindow: '1 minute' },
};

async function audit(
  req: FastifyRequest,
  action: string,
  targetId: string,
  diff: Record<string, unknown> = {},
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      orgId: req.auth.orgId,
      userId: req.auth.userId,
      action,
      targetType: 'company',
      targetId,
      diff: diff as Prisma.InputJsonValue,
    },
  });
}

async function loadCompany(req: FastifyRequest, id: string): Promise<{ id: string } | null> {
  const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
  return prisma.company.findFirst({
    where: applyCompanyScope({ id, orgId: req.auth.orgId, deletedAt: null }, scope),
    select: { id: true },
  });
}

/** Import progress rows stay on the Companies page for a day. */
const IMPORT_BATCH_WINDOW_MS = 24 * 60 * 60_000;

/** Account intelligence routes under /companies/:id/intel/*. */
export const companyIntelRoutes: FastifyPluginAsyncZod = async (server) => {
  async function composed(req: FastifyRequest, id: string, view: string) {
    const company = await loadCompany(req, id);
    if (!company) throw server.httpErrors.notFound('Company not found');
    const snapshot = await loadCompanyIntel(prisma, req.auth.orgId, company.id, new Date());
    if (!snapshot) throw server.httpErrors.notFound('Company not found');
    if (shouldAuditRead(`${req.auth.orgId}:${req.auth.userId}:${company.id}:${view}`))
      await audit(req, `intel.${view}.view`, company.id);
    return composeAccountIntel(snapshot);
  }

  server.get(
    '/companies/:id/intel/direction',
    { config: READ, schema: { params: idParam, response: { 200: AccountDirection } } },
    async (req) => (await composed(req, req.params.id, 'direction')).direction,
  );

  server.get(
    '/companies/:id/intel/hiring',
    { config: READ, schema: { params: idParam, response: { 200: AccountHiringIntel } } },
    async (req) => (await composed(req, req.params.id, 'hiring')).hiring,
  );

  server.get(
    '/companies/:id/intel/financials',
    { config: READ, schema: { params: idParam, response: { 200: AccountFinancialsIntel } } },
    async (req) => (await composed(req, req.params.id, 'financials')).financials,
  );

  server.get(
    '/companies/:id/intel/news',
    { config: READ, schema: { params: idParam, response: { 200: AccountNewsIntel } } },
    async (req) => (await composed(req, req.params.id, 'news')).news,
  );

  server.post(
    '/companies/:id/intel/refresh',
    {
      config: { permission: 'account-intel:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: idParam, body: IntelRefreshBody, response: { 202: IntelRefreshResponse } },
    },
    async (req, reply) => {
      const company = await loadCompany(req, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const orgId = req.auth.orgId;
      const source = req.body.source;
      const key = { orgId_companyId_source: { orgId, companyId: company.id, source } };
      const before = await prisma.intelSourceRun.findUnique({ where: key });
      // Queued is written first so a fast worker's final status is never overwritten.
      const row = await prisma.intelSourceRun.upsert({
        where: key,
        create: { orgId, companyId: company.id, source, status: 'queued' },
        update: { status: 'queued' },
      });
      const jobId = await enqueueAccountIntel({
        kind: 'refresh',
        orgId,
        companyId: company.id,
        sources: [source],
        requestedBy: req.auth.userId,
      });
      if (!jobId) {
        if (before)
          await prisma.intelSourceRun.update({ where: key, data: { status: before.status } });
        else await prisma.intelSourceRun.delete({ where: key });
      }
      const shown = jobId ? row : before;
      await audit(req, 'intel.refresh', company.id, { source, queued: jobId !== null });
      const result = (shown?.result ?? {}) as Partial<IntelSourceStatus['result']>;
      reply.code(202);
      return {
        queued: jobId !== null,
        source,
        status: {
          key: source,
          label: INTEL_SOURCE_LABEL[source],
          status: (shown?.status as IntelSourceStatus['status'] | undefined) ?? 'never',
          lastFetchedAt: shown?.lastFetchedAt?.toISOString() ?? null,
          result: {
            new: result.new ?? 0,
            updated: result.updated ?? 0,
            skipped: result.skipped ?? 0,
            failed: result.failed ?? 0,
          },
          detail: shown?.detail ?? null,
        },
      };
    },
  );

  server.get(
    '/companies/:id/intel/summary',
    {
      config: READ,
      schema: {
        params: idParam,
        response: { 200: z.object({ summary: CompanyIntelSummary.nullable() }) },
      },
    },
    async (req) => {
      const company = await loadCompany(req, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const summaries = await readCompanyIntelSummaries(prisma, req.auth.orgId, [company.id]);
      return { summary: summaries.get(company.id) ?? null };
    },
  );

  server.post(
    '/companies/:id/intel/refresh-all',
    {
      config: { permission: 'account-intel:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: idParam,
        body: z.object({}).strict().nullish(),
        response: { 202: z.object({ queued: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const company = await loadCompany(req, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const jobId = await enqueueCompanyFullRefresh({
        kind: 'full-refresh',
        orgId: req.auth.orgId,
        companyId: company.id,
        batchId: null,
        force: true,
        requestedBy: req.auth.userId,
      });
      await audit(req, 'intel.refresh_all', company.id, { queued: jobId !== null });
      reply.code(202);
      return { queued: jobId !== null };
    },
  );

  server.get(
    '/companies/intel-imports',
    {
      config: READ,
      schema: { response: { 200: z.object({ items: z.array(IntelImportBatchView) }) } },
    },
    async (req) => ({
      items: await readImportBatches(prisma, req.auth.orgId, {
        since: new Date(Date.now() - IMPORT_BATCH_WINDOW_MS),
        limit: 5,
      }),
    }),
  );
};
