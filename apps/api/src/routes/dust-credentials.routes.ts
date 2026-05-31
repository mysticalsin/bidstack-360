// Admin-managed, per-org Dust credentials (the "plug and play" Settings surface).
//
// An org admin enters their Dust API key + workspace ID once; we validate them
// against Dust, encrypt the key at rest (INTEGRATION_TOKEN_KEY), and store them
// on the org's IntegrationConfig (type='dust', name='dust'). Every Dust consumer
// then resolves per-org credentials via lib/dust-credentials.ts.
//
// SECURITY: the API key is NEVER returned to the client (only a masked tail),
// NEVER logged, and NEVER serialized into a job payload. Mutations are
// admin-only (requireRole('admin'), matching the crew-infra precedent).
//
// Raw SQL (not prisma.integrationConfig.*) because the 'dust' IntegrationType
// enum value isn't in the generated client until it's regenerated — Azure/Linux
// regenerates cleanly; the local Windows DLL lock blocks it.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { Logger as PinoLogger } from 'pino';
import { DustClient } from '@bidstack/dust-client';
import { encryptSecret } from '@bidstack/shared/server-crypto';

import { isPublicHostname } from '../lib/ssrf-guard.js';

import {
  resolveOrgDustCredentials,
  maskApiKey,
  type DustCredentials,
} from '../lib/dust-credentials.js';

const DustCredentialsSummary = z.object({
  configured: z.boolean(),
  /** 'org' = saved in Settings; 'env' = the global fallback; null = unconfigured. */
  source: z.enum(['org', 'env']).nullable(),
  workspaceId: z.string().nullable(),
  baseUrl: z.string().nullable(),
  dataSourceId: z.string().nullable(),
  agentIds: z.record(z.string()),
  apiKeyMasked: z.string().nullable(),
});

const PutCredentialsBody = z.object({
  apiKey: z.string().min(10).max(200),
  workspaceId: z.string().min(1).max(100),
  baseUrl: z.string().url().max(300).optional(),
  dataSourceId: z.string().max(200).optional(),
  /** Optional purpose -> Dust agent id map (e.g. { crew, sectionDraft, qaReview }). */
  agentIds: z.record(z.string().max(200)).optional(),
});

/** Shape the resolved credentials into a client-safe summary (never the key). */
function toSummary(creds: DustCredentials | null): z.infer<typeof DustCredentialsSummary> {
  if (!creds) {
    return {
      configured: false,
      source: null,
      workspaceId: null,
      baseUrl: null,
      dataSourceId: null,
      agentIds: {},
      apiKeyMasked: null,
    };
  }
  return {
    configured: true,
    source: creds.source,
    workspaceId: creds.workspaceId,
    baseUrl: creds.baseUrl ?? null,
    dataSourceId: creds.dataSourceId ?? null,
    agentIds: creds.agentIds,
    // Only ever mask the org's OWN key — never expose the shared env key's tail
    // to a tenant admin.
    apiKeyMasked: creds.source === 'org' ? maskApiKey(creds.apiKey) : null,
  };
}

export const dustCredentialsRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/v1/integrations/dust/credentials — masked status for the Settings UI.
  server.get(
    '/dust/credentials',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: DustCredentialsSummary } },
    },
    async (req) => toSummary(await resolveOrgDustCredentials(req.auth.orgId)),
  );

  // PUT /api/v1/integrations/dust/credentials — admin saves/updates the keys.
  server.put(
    '/dust/credentials',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requireRole('admin'),
      schema: { body: PutCredentialsBody, response: { 200: DustCredentialsSummary } },
    },
    async (req) => {
      const { apiKey, workspaceId, baseUrl, dataSourceId, agentIds } = req.body;

      // SSRF guard: baseUrl is admin-supplied and the server fetches it now (and
      // on every later Dust call), so it must be a public https endpoint — never
      // an internal/metadata address (e.g. 169.254.169.254) or loopback.
      if (baseUrl) {
        let parsed: URL;
        try {
          parsed = new URL(baseUrl);
        } catch {
          throw server.httpErrors.badRequest('Base URL must be a valid URL.');
        }
        if (parsed.protocol !== 'https:' || !isPublicHostname(parsed.hostname)) {
          throw server.httpErrors.badRequest('Base URL must be a public https:// endpoint.');
        }
      }

      // Validate against Dust BEFORE persisting so the admin gets honest,
      // immediate feedback — the whole point of plug-and-play.
      try {
        const probe = new DustClient({
          apiKey,
          workspaceId,
          baseUrl,
          timeoutMs: 10_000,
          logger: req.log.child({ kind: 'dust-validate' }) as unknown as PinoLogger,
        });
        await probe.listAgents('list');
      } catch (err) {
        req.log.warn(
          { orgId: req.auth.orgId, err: err instanceof Error ? err.message : 'unknown' },
          'dust credentials validation failed',
        );
        throw server.httpErrors.badRequest(
          'Could not authenticate with Dust using these credentials. Check the API key and workspace ID.',
        );
      }

      const encrypted = encryptSecret(JSON.stringify({ apiKey }));
      const config: Record<string, unknown> = { workspaceId };
      if (baseUrl) config.baseUrl = baseUrl;
      if (dataSourceId) config.dataSourceId = dataSourceId;
      if (agentIds) config.agentIds = agentIds;

      // Parameterized upsert; ::jsonb casts the bound string params.
      await prisma.$executeRaw`
        INSERT INTO integration_configs
          (id, org_id, type, name, config, credentials, is_active, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${req.auth.orgId}::uuid, 'dust', 'dust',
           ${JSON.stringify(config)}::jsonb, ${JSON.stringify({ encrypted })}::jsonb,
           true, now(), now())
        ON CONFLICT ON CONSTRAINT integration_configs_org_type_name_key
        DO UPDATE SET
          config = EXCLUDED.config,
          credentials = EXCLUDED.credentials,
          is_active = true,
          deleted_at = NULL,
          updated_at = now()
      `;

      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'dust.credentials.upsert',
          targetType: 'IntegrationConfig',
          targetId: null,
          // Never log the key — only non-secret shape.
          diff: {
            workspaceId,
            hasBaseUrl: Boolean(baseUrl),
            hasDataSourceId: Boolean(dataSourceId),
            agentCount: agentIds ? Object.keys(agentIds).length : 0,
          },
        },
      });

      return toSummary({
        apiKey,
        workspaceId,
        baseUrl,
        dataSourceId,
        agentIds: agentIds ?? {},
        source: 'org',
      });
    },
  );

  // DELETE /api/v1/integrations/dust/credentials — admin removes org keys
  // (soft delete; the global env fallback, if any, takes over again).
  server.delete(
    '/dust/credentials',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requireRole('admin'),
      schema: { response: { 204: z.null() } },
    },
    async (req, reply) => {
      const affected = await prisma.$executeRaw`
        UPDATE integration_configs
        SET is_active = false, deleted_at = now(), updated_at = now()
        WHERE org_id = ${req.auth.orgId}::uuid AND type::text = 'dust' AND name = 'dust'
          AND deleted_at IS NULL
      `;
      if (affected === 0) {
        throw server.httpErrors.notFound('No Dust credentials configured for this org');
      }
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'dust.credentials.delete',
          targetType: 'IntegrationConfig',
          targetId: null,
          diff: {},
        },
      });
      return reply.code(204).send(null);
    },
  );
};
