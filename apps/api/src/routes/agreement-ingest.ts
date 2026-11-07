// Agreement pull by API (slice 13a).
//
//   POST /ingest/agreements              msa:write   inbound document (REST)
//   GET  /ingest/agreements/:id          msa:read    item status
//   GET  /msa/sources                    msa:read    SharePoint / DocuSign sources
//   POST /msa/sources                    msa:admin   add a source (user session)
//   PATCH /msa/sources/:id               msa:admin   rename / turn off
//   POST /msa/sources/:id/sync           msa:admin   Sync now (202 + runId)
//   GET  /msa/sources/:id/runs/:runId    msa:read    run state for polling
//
// Every inbound document becomes an intake draft (or a new file version of an
// agreement it already became). A person confirms every draft.
import { createHash, randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AgreementStageError, INGEST_ITEM_SELECT, prisma, type Prisma, serializeIngestItem, stageAgreementIngest } from '@bidstack/db';
import {
  AgreementIngestItem,
  AgreementIngestRequest,
  AgreementSource,
  AgreementSourceCreate,
  AgreementSourceList,
  AgreementSourceUpdate,
  AgreementSyncRun,
} from '@bidstack/shared';

import { getAccessScope, isApiKeyActor } from '../lib/access-scope.js';
import { enqueueAgreementIngest } from '../queues/agreement-ingest.js';
import { docuSignCredentialsFromEnv } from '../services/agreement-sources/docusign-envelopes.js';
import { graphCredentialsFromEnv } from '../services/agreement-sources/graph-drive.js';
import { markRunQueued, runStateFromJson } from '../services/agreement-sources/sync.js';

const IdParams = z.object({ id: z.string().uuid() });

function headerValue(req: FastifyRequest, name: string): string | null {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed && trimmed.length >= 8 && trimmed.length <= 200 ? trimmed : null;
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
  lastSyncAt: true,
  lastResult: true,
  updatedAt: true,
} as const;

/** A queued or running run older than this is treated as lost. */
const RUN_STALE_MS = 30 * 60_000;

function credentialsConfigured(kind: string): boolean {
  return kind === 'sharepoint' ? graphCredentialsFromEnv() !== null : docuSignCredentialsFromEnv() !== null;
}

function serializeSource(row: SourceRow): AgreementSource {
  return {
    id: row.id,
    kind: row.kind as AgreementSource['kind'],
    name: row.name,
    enabled: row.enabled,
    config: (row.config ?? {}) as Record<string, unknown>,
    configured: credentialsConfigured(row.kind),
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastRun: runStateFromJson(row.lastResult, row.id),
  };
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
      let companyScope: string[] | null = null;
      if (keyId) {
        const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
        companyScope = scope.unrestricted ? null : scope.companyIds;
      }
      try {
        const { item, created } = await stageAgreementIngest({
          orgId: req.auth.orgId,
          channel: 'rest',
          actor: keyId ? { kind: 'api_key', keyId } : { kind: 'user', userId: req.auth.userId },
          companyScope,
          idempotencyKey: headerValue(req, 'idempotency-key'),
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
      return { items: rows.map(serializeSource) };
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
      const row = await prisma.agreementSource.create({
        data: {
          orgId: req.auth.orgId,
          kind: req.body.kind,
          name: req.body.name,
          config: req.body.config as Prisma.InputJsonValue,
          createdById: req.auth.userId,
        },
        select: SOURCE_SELECT,
      });
      await audit(req, 'agreement.source.created', row.id, { kind: row.kind, name: row.name });
      return reply.code(201).send(serializeSource(row));
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
      return serializeSource(row);
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
      if (!credentialsConfigured(source.kind)) throw server.httpErrors.conflict('Source credentials are not configured');
      const current = runStateFromJson(source.lastResult, source.id);
      const runId = syncRunId(req.auth.orgId, source.id, headerValue(req, 'idempotency-key'));
      const active =
        current &&
        (current.state === 'queued' || current.state === 'running') &&
        Date.now() - source.updatedAt.getTime() < RUN_STALE_MS;
      if (current && (current.runId === runId || active)) {
        return reply.code(202).send(current);
      }
      const run = await markRunQueued(source.id, req.auth.orgId, runId);
      await audit(req, 'sync_now.start', source.id, { kind: source.kind, runId });
      await enqueueAgreementIngest({ kind: 'sync', orgId: req.auth.orgId, sourceId: source.id, runId, userId: req.auth.userId });
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
        select: { lastResult: true },
      });
      const run = source ? runStateFromJson(source.lastResult, req.params.id) : null;
      if (!run || run.runId !== req.params.runId) throw server.httpErrors.notFound('Run not found');
      return run;
    },
  );
};
