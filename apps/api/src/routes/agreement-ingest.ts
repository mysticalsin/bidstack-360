// Agreement pull by API (slice 13a).
//
//   POST /ingest/agreements              msa:write   inbound document (REST)
//   GET  /ingest/agreements/:id          msa:read    item status
//   GET  /msa/sources                    msa:read    SharePoint / DocuSign sources
//   POST /msa/sources                    msa:admin   add a source (user session)
//   PATCH /msa/sources/:id               msa:admin   rename / turn off
//   POST /msa/sources/:id/sync           msa:admin   Sync now (202 + runId)
//   GET  /msa/sources/:id/runs/:runId    msa:read    run state for polling
//   GET  /msa/connections                msa:read    the org's SharePoint / DocuSign grants
//   POST /msa/connections/:provider/start msa:admin  admin consent / account OAuth URL
//   DELETE /msa/connections/:id          msa:admin   revoke
//   GET  /integrations/agreements/:provider/callback  public, sealed state
//
// Every inbound document becomes an intake draft (or a new file version of an
// agreement it already became). A person confirms every draft.
import { createHash, randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AgreementStageError, INGEST_ITEM_SELECT, prisma, type Prisma, serializeIngestItem, stageAgreementIngest } from '@bidstack/db';
import {
  AgreementConnectionList,
  AgreementIngestItem,
  AgreementIngestRequest,
  AgreementSource,
  AgreementSourceCreate,
  AgreementSourceKind,
  AgreementSourceList,
  AgreementSourceUpdate,
  AgreementSyncRun,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope, isApiKeyActor } from '../lib/access-scope.js';
import { OAuthStateError } from '../lib/oauth-state.js';
import { enqueueAgreementIngest } from '../queues/agreement-ingest.js';
import {
  completeDocuSignConsent,
  completeSharePointConsent,
  ConnectionError,
  connectionReady,
  findOrgConnection,
  isSingleTenantDeployment,
  listOrgConnections,
  resolveSourceAccess,
  revokeConnection,
  serializeConnection,
  startConnection,
} from '../services/agreement-sources/connections.js';
import { markRunQueued, runStateFromJson } from '../services/agreement-sources/sync.js';

const IdParams = z.object({ id: z.string().uuid() });

/** Matches agreement_ingest_items.idempotency_key VARCHAR(128). */
export const IDEMPOTENCY_KEY_MAX = 128;
const IDEMPOTENCY_KEY_MIN = 8;

class IdempotencyKeyError extends Error {}

function idempotencyKey(req: FastifyRequest): string | null {
  const raw = req.headers['idempotency-key'];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return null;
  if (value.length < IDEMPOTENCY_KEY_MIN || value.length > IDEMPOTENCY_KEY_MAX) {
    throw new IdempotencyKeyError(`Idempotency-Key must be ${IDEMPOTENCY_KEY_MIN} to ${IDEMPOTENCY_KEY_MAX} characters`);
  }
  return value;
}

function apiKeyId(req: FastifyRequest): string | null {
  return isApiKeyActor(req.auth.userId) ? req.auth.userId.slice('apikey:'.length) : null;
}

/** Deterministic run id: the same Idempotency-Key always names the same run. */
export function syncRunId(orgId: string, sourceId: string, idempotencyKey: string | null): string {
  if (!idempotencyKey) return randomUUID();
  return createHash('sha256').update(`${orgId}\0${sourceId}\0${idempotencyKey}`).digest('hex').slice(0, 32);
}

type SourceRow = {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: Prisma.JsonValue;
  connectionId: string | null;
  lastSyncAt: Date | null;
  lastResult: Prisma.JsonValue | null;
  updatedAt: Date;
};

const SOURCE_SELECT = {
  id: true,
  kind: true,
  name: true,
  enabled: true,
  config: true,
  connectionId: true,
  lastSyncAt: true,
  lastResult: true,
  updatedAt: true,
} as const;

/** A queued or running run older than this is treated as lost. */
const RUN_STALE_MS = 30 * 60_000;

/** A run that never finished inside the stale window shows as failed, so Sync now unlocks. */
function visibleRun(row: { id: string; lastResult: Prisma.JsonValue | null; updatedAt: Date }): AgreementSource['lastRun'] {
  const run = runStateFromJson(row.lastResult, row.id);
  if (!run || (run.state !== 'queued' && run.state !== 'running')) return run;
  if (Date.now() - row.updatedAt.getTime() < RUN_STALE_MS) return run;
  return { ...run, state: 'failed', reasons: [...run.reasons, 'The run did not finish; start it again'] };
}

async function readiness(orgId: string): Promise<Record<AgreementSourceKind, boolean>> {
  const [sharepoint, docusign] = await Promise.all([connectionReady(orgId, 'sharepoint'), connectionReady(orgId, 'docusign')]);
  return { sharepoint, docusign };
}

function serializeSource(row: SourceRow, ready: Record<AgreementSourceKind, boolean>): AgreementSource {
  return {
    id: row.id,
    kind: row.kind as AgreementSource['kind'],
    name: row.name,
    enabled: row.enabled,
    config: (row.config ?? {}) as Record<string, unknown>,
    connectionId: row.connectionId,
    configured: ready[row.kind as AgreementSourceKind] ?? false,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastRun: visibleRun(row),
  };
}

function webReturn(provider: AgreementSourceKind, result: 'connected' | 'failed'): string {
  return `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/agreements?connection=${provider}&result=${result}`;
}

export const agreementIngestRoutes: FastifyPluginAsyncZod = async (server) => {
  function assertHuman(req: FastifyRequest): void {
    if (req.auth.role === 'api' || isApiKeyActor(req.auth.userId)) {
      throw server.httpErrors.forbidden('Agreement sources are managed from a user session');
    }
  }

  async function audit(req: FastifyRequest, action: string, targetId: string, diff: Record<string, unknown>) {
    const keyId = apiKeyId(req);
    await prisma.auditLog.create({
      data: {
        orgId: req.auth.orgId,
        userId: keyId ? null : req.auth.userId,
        action,
        targetType: 'agreement_source',
        targetId,
        diff: { ...diff, ...(keyId ? { apiKeyId: keyId } : {}) } as Prisma.InputJsonValue,
      },
    });
  }

  server.post(
    '/ingest/agreements',
    {
      config: { permission: 'msa:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      bodyLimit: 10 * 1024 * 1024,
      schema: { body: AgreementIngestRequest, response: { 202: AgreementIngestItem } },
    },
    async (req, reply) => {
      const keyId = apiKeyId(req);
      let key: string | null;
      try {
        key = idempotencyKey(req);
      } catch (err) {
        if (err instanceof IdempotencyKeyError) throw server.httpErrors.badRequest(err.message);
        throw err;
      }
      let companyScope: string[] | null = null;
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      if (keyId) {
        companyScope = scope.unrestricted ? null : scope.companyIds;
      } else if (!scope.unrestricted && req.body.metadata?.companyId) {
        const visible = await prisma.company.findFirst({
          where: applyCompanyScope({ orgId: req.auth.orgId, id: req.body.metadata.companyId, deletedAt: null }, scope),
          select: { id: true },
        });
        if (!visible) throw server.httpErrors.forbidden('metadata.companyId is outside your access');
      }
      try {
        const { item, created } = await stageAgreementIngest({
          orgId: req.auth.orgId,
          channel: 'rest',
          actor: keyId ? { kind: 'api_key', keyId } : { kind: 'user', userId: req.auth.userId },
          companyScope,
          idempotencyKey: key,
          request: req.body,
        });
        if (created) await enqueueAgreementIngest({ kind: 'process', orgId: req.auth.orgId, itemId: item.id });
        return reply.code(202).send(item);
      } catch (err) {
        if (err instanceof AgreementStageError) {
          if (err.code === 'out_of_scope') throw server.httpErrors.forbidden(err.message);
          if (err.code === 'too_large') throw server.httpErrors.payloadTooLarge(err.message);
          throw server.httpErrors.badRequest(err.message);
        }
        throw err;
      }
    },
  );

  server.get(
    '/ingest/agreements/:id',
    { config: { permission: 'msa:read' }, schema: { params: IdParams, response: { 200: AgreementIngestItem } } },
    async (req) => {
      const keyId = apiKeyId(req);
      const row = await prisma.agreementIngestItem.findFirst({
        where: {
          id: req.params.id,
          orgId: req.auth.orgId,
          ...(keyId ? { actorType: 'api_key', actorId: keyId } : {}),
        },
        select: INGEST_ITEM_SELECT,
      });
      if (!row) throw server.httpErrors.notFound('Ingest item not found');
      return serializeIngestItem(row);
    },
  );

  server.get(
    '/msa/sources',
    { config: { permission: 'msa:read' }, schema: { response: { 200: AgreementSourceList } } },
    async (req) => {
      const rows = await prisma.agreementSource.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: SOURCE_SELECT,
      });
      const ready = await readiness(req.auth.orgId);
      return { items: rows.map((r) => serializeSource(r, ready)) };
    },
  );

  server.post(
    '/msa/sources',
    {
      config: { permission: 'msa:admin', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { body: AgreementSourceCreate, response: { 201: AgreementSource } },
    },
    async (req, reply) => {
      assertHuman(req);
      const orgId = req.auth.orgId;
      // Only this org's own connection; a foreign id is simply not found.
      const conn = await findOrgConnection(orgId, req.body.kind, req.body.connectionId ?? null);
      if (req.body.connectionId && !conn) throw server.httpErrors.notFound('Connection not found');
      if (conn && conn.status !== 'connected') throw server.httpErrors.conflict('The connection is not active; connect it again');
      if (!conn && !isSingleTenantDeployment()) {
        throw server.httpErrors.conflict(`Connect ${req.body.kind === 'sharepoint' ? 'SharePoint' : 'DocuSign'} for this organization first`);
      }
      const connectionId = conn?.id ?? null;
      try {
        await resolveSourceAccess({ orgId, kind: req.body.kind, connectionId, config: req.body.config as Prisma.JsonValue });
      } catch (err) {
        if (err instanceof ConnectionError) {
          if (err.code === 'ownership') throw server.httpErrors.unprocessableEntity(err.message);
          if (err.code === 'not_found') throw server.httpErrors.notFound(err.message);
          throw server.httpErrors.conflict(err.message);
        }
        req.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'agreement source check failed');
        throw server.httpErrors.badGateway('Could not reach the provider to check this source');
      }
      const row = await prisma.agreementSource.create({
        data: {
          orgId,
          kind: req.body.kind,
          name: req.body.name,
          config: req.body.config as Prisma.InputJsonValue,
          connectionId,
          createdById: req.auth.userId,
        },
        select: SOURCE_SELECT,
      });
      await audit(req, 'agreement.source.created', row.id, { kind: row.kind, name: row.name, connectionId });
      return reply.code(201).send(serializeSource(row, await readiness(orgId)));
    },
  );

  server.patch(
    '/msa/sources/:id',
    {
      config: { permission: 'msa:admin', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: IdParams, body: AgreementSourceUpdate, response: { 200: AgreementSource } },
    },
    async (req) => {
      assertHuman(req);
      const res = await prisma.agreementSource.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        data: req.body,
      });
      if (res.count === 0) throw server.httpErrors.notFound('Source not found');
      const row = await prisma.agreementSource.findFirstOrThrow({ where: { id: req.params.id, orgId: req.auth.orgId }, select: SOURCE_SELECT });
      await audit(req, 'agreement.source.updated', row.id, { ...req.body });
      return serializeSource(row, await readiness(req.auth.orgId));
    },
  );

  server.post(
    '/msa/sources/:id/sync',
    {
      config: { permission: 'msa:admin', rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: { params: IdParams, body: z.object({}).strict().nullish(), response: { 202: AgreementSyncRun } },
    },
    async (req, reply) => {
      assertHuman(req);
      const source = await prisma.agreementSource.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: SOURCE_SELECT,
      });
      if (!source) throw server.httpErrors.notFound('Source not found');
      if (!source.enabled) throw server.httpErrors.conflict('Source is turned off');
      if (!(await connectionReady(req.auth.orgId, source.kind as AgreementSourceKind))) {
        throw server.httpErrors.conflict('Source credentials are not configured');
      }
      let key: string | null;
      try {
        key = idempotencyKey(req);
      } catch (err) {
        if (err instanceof IdempotencyKeyError) throw server.httpErrors.badRequest(err.message);
        throw err;
      }
      const current = runStateFromJson(source.lastResult, source.id);
      const runId = syncRunId(req.auth.orgId, source.id, key);
      const active =
        current &&
        (current.state === 'queued' || current.state === 'running') &&
        Date.now() - source.updatedAt.getTime() < RUN_STALE_MS;
      if (current && (current.runId === runId || active)) {
        return reply.code(202).send(current);
      }
      const run = await markRunQueued(source.id, req.auth.orgId, runId, source.updatedAt);
      if (!run) {
        const now = await prisma.agreementSource.findFirst({ where: { id: source.id, orgId: req.auth.orgId }, select: { lastResult: true } });
        const winner = now ? runStateFromJson(now.lastResult, source.id) : null;
        if (!winner) throw server.httpErrors.conflict('Another sync just started');
        return reply.code(202).send(winner);
      }
      await audit(req, 'sync_now.start', source.id, { kind: source.kind, runId });
      await enqueueAgreementIngest({
        kind: 'sync',
        orgId: req.auth.orgId,
        sourceId: source.id,
        runId,
        userId: req.auth.userId,
        claimId: randomUUID(),
      });
      return reply.code(202).send(run);
    },
  );

  server.get(
    '/msa/sources/:id/runs/:runId',
    {
      config: { permission: 'msa:read' },
      schema: {
        params: z.object({ id: z.string().uuid(), runId: z.string().min(1).max(64) }),
        response: { 200: AgreementSyncRun },
      },
    },
    async (req) => {
      const source = await prisma.agreementSource.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, lastResult: true, updatedAt: true },
      });
      const run = source ? visibleRun(source) : null;
      if (!run || run.runId !== req.params.runId) throw server.httpErrors.notFound('Run not found');
      return run;
    },
  );

  server.get(
    '/msa/connections',
    { config: { permission: 'msa:read' }, schema: { response: { 200: AgreementConnectionList } } },
    async (req) => {
      const rows = await listOrgConnections(req.auth.orgId);
      return { items: rows.map(serializeConnection), singleTenant: isSingleTenantDeployment() };
    },
  );

  server.post(
    '/msa/connections/:provider/start',
    {
      config: { permission: 'msa:admin', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ provider: AgreementSourceKind }),
        body: z.object({}).strict().nullish(),
        response: { 200: z.object({ url: z.string().url(), connectionId: z.string().uuid() }) },
      },
    },
    async (req) => {
      assertHuman(req);
      try {
        const started = await startConnection(req.params.provider, { orgId: req.auth.orgId, userId: req.auth.userId });
        await audit(req, 'agreement.connection.started', started.connectionId, { provider: req.params.provider });
        return started;
      } catch (err) {
        if (err instanceof ConnectionError) throw server.httpErrors.conflict(err.message);
        throw err;
      }
    },
  );

  server.delete(
    '/msa/connections/:id',
    { config: { permission: 'msa:admin', rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { params: IdParams } },
    async (req, reply) => {
      assertHuman(req);
      if (!(await revokeConnection(req.auth.orgId, req.auth.userId, req.params.id))) throw server.httpErrors.notFound('Connection not found');
      return reply.code(204).send();
    },
  );

  async function finishCallback(
    provider: AgreementSourceKind,
    run: () => Promise<unknown>,
    reply: FastifyReply,
    req: FastifyRequest,
  ) {
    try {
      await run();
      return reply.redirect(webReturn(provider, 'connected'));
    } catch (err) {
      if (err instanceof OAuthStateError) {
        req.log.warn({ provider, reason: err.reason }, 'agreement connection state rejected');
        throw server.httpErrors.forbidden('Invalid or used connection state; start again');
      }
      req.log.warn({ provider, err: err instanceof Error ? err.message : String(err) }, 'agreement connection callback failed');
      return reply.redirect(webReturn(provider, 'failed'));
    }
  }

  server.get(
    '/integrations/agreements/sharepoint/callback',
    {
      // The Microsoft redirect carries no Polo session; identity comes from the sealed state.
      config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          state: z.string().max(4000).optional(),
          tenant: z.string().max(100).optional(),
          admin_consent: z.string().max(10).optional(),
          error: z.string().max(200).optional(),
          error_description: z.string().max(2000).optional(),
        }),
      },
    },
    async (req, reply) => {
      const q = req.query;
      if (q.error || !q.state) return reply.redirect(webReturn('sharepoint', 'failed'));
      const state = q.state;
      return finishCallback('sharepoint', () => completeSharePointConsent({ state, tenant: q.tenant, adminConsent: q.admin_consent }), reply, req);
    },
  );

  server.get(
    '/integrations/agreements/docusign/callback',
    {
      // The DocuSign redirect carries no Polo session; identity comes from the sealed state.
      config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          state: z.string().max(4000).optional(),
          code: z.string().max(4000).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const q = req.query;
      if (q.error || !q.state || !q.code) return reply.redirect(webReturn('docusign', 'failed'));
      const { state, code } = q;
      return finishCallback('docusign', () => completeDocuSignConsent({ state, code }), reply, req);
    },
  );
};
