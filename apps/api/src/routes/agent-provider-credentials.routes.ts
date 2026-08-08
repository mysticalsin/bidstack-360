import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { encryptSecret } from '@bidstack/shared/server-crypto';
import { completeChat } from '@bidstack/shared/llm';

import {
  agentProviderCredentialName,
  AGENT_PROVIDER_ACTIVE_NAME,
  AGENT_PROVIDER_CONFIG_TYPE,
  DIRECT_AGENT_PROVIDERS,
  type DirectAgentProvider,
  credentialToResolvedLlm,
  getOrgActiveAgentProvider,
  listOrgAgentProviderCredentials,
  resolveOrgAgentProviderCredential,
} from '../lib/agent-provider-credentials.js';
import { isPublicHostname } from '../lib/ssrf-guard.js';
import { maskApiKey } from '../lib/dust-credentials.js';

const ProviderParam = z.object({
  provider: z.enum(DIRECT_AGENT_PROVIDERS),
});

const ProviderCredentialSummary = z.object({
  provider: z.enum(DIRECT_AGENT_PROVIDERS),
  configured: z.boolean(),
  source: z.literal('org').nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  apiKeyMasked: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
});

const ProviderCredentialList = z.object({
  items: z.array(ProviderCredentialSummary),
  // The org's active default provider (drives every AI step), or null if none.
  active: z.enum(DIRECT_AGENT_PROVIDERS).nullable(),
});

const SetActiveBody = z.object({
  // null clears the selection (falls back to deployment env provider, then Dust).
  provider: z.enum(DIRECT_AGENT_PROVIDERS).nullable(),
});

const ProviderTestResult = z.object({
  provider: z.enum(DIRECT_AGENT_PROVIDERS),
  ok: z.boolean(),
  model: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

const PutProviderCredentialBody = z.object({
  apiKey: z.string().trim().min(1).max(1_000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.string().trim().url().max(300).optional(),
});

function isLocalGemmaUrl(provider: DirectAgentProvider, parsed: URL): boolean {
  if (provider !== 'gemma' || process.env.NODE_ENV === 'production') return false;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
}

function assertSafeProviderBaseUrl(
  provider: DirectAgentProvider,
  baseUrl: string | undefined,
  server: Parameters<FastifyPluginAsyncZod>[0],
) {
  if (!baseUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw server.httpErrors.badRequest('Base URL must be a valid URL.');
  }

  if (isLocalGemmaUrl(provider, parsed)) return;

  if (parsed.protocol !== 'https:' || !isPublicHostname(parsed.hostname)) {
    throw server.httpErrors.badRequest(
      provider === 'gemma'
        ? 'Gemma base URL must be public https:// in production, or localhost in local development.'
        : 'Base URL must be a public https:// endpoint.',
    );
  }
}

function emptySummary(provider: DirectAgentProvider): z.infer<typeof ProviderCredentialSummary> {
  return {
    provider,
    configured: false,
    source: null,
    model: null,
    baseUrl: null,
    apiKeyMasked: null,
    updatedAt: null,
  };
}

function toSummary(
  provider: DirectAgentProvider,
  credential: Awaited<ReturnType<typeof resolveOrgAgentProviderCredential>>,
): z.infer<typeof ProviderCredentialSummary> {
  if (!credential) return emptySummary(provider);
  return {
    provider,
    configured: true,
    source: 'org',
    model: credential.model ?? null,
    baseUrl: credential.baseUrl ?? null,
    apiKeyMasked: maskApiKey(credential.apiKey),
    updatedAt: credential.updatedAt.toISOString(),
  };
}

async function listSummaries(orgId: string): Promise<z.infer<typeof ProviderCredentialList>> {
  const [rows, active] = await Promise.all([
    listOrgAgentProviderCredentials(orgId),
    getOrgActiveAgentProvider(orgId),
  ]);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return {
    items: DIRECT_AGENT_PROVIDERS.map((provider) =>
      toSummary(provider, byProvider.get(provider) ?? null),
    ),
    active,
  };
}

export const agentProviderCredentialsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/agent-providers/credentials',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: ProviderCredentialList } },
    },
    async (req) => listSummaries(req.auth.orgId),
  );

  server.put(
    '/agent-providers/credentials/:provider',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('integrations:write'), server.requireRole('admin')],
      schema: {
        params: ProviderParam,
        body: PutProviderCredentialBody,
        response: { 200: ProviderCredentialSummary },
      },
    },
    async (req) => {
      const provider = req.params.provider;
      const existing = await resolveOrgAgentProviderCredential(req.auth.orgId, provider);
      const apiKey = req.body.apiKey ?? existing?.apiKey;
      const model = req.body.model ?? existing?.model;
      const baseUrl = req.body.baseUrl ?? existing?.baseUrl;

      if (provider !== 'gemma' && !apiKey) {
        throw server.httpErrors.badRequest('API key is required for this provider.');
      }
      if (provider === 'claude' && !model) {
        throw server.httpErrors.badRequest('Model is required for Claude credentials.');
      }

      assertSafeProviderBaseUrl(provider, baseUrl, server);

      const config: Record<string, unknown> = { provider };
      if (model) config.model = model;
      if (baseUrl) config.baseUrl = baseUrl;
      const credentials: Record<string, unknown> = {};
      if (apiKey) credentials.encrypted = encryptSecret(JSON.stringify({ apiKey }));

      const name = agentProviderCredentialName(provider);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`${req.auth.orgId}:${AGENT_PROVIDER_CONFIG_TYPE}:${name}`}))
        `;
        const affected = await tx.$executeRaw`
          UPDATE integration_configs
          SET
            config = ${JSON.stringify(config)}::jsonb,
            credentials = ${JSON.stringify(credentials)}::jsonb,
            is_active = true,
            deleted_at = NULL,
            updated_at = now()
          WHERE org_id = ${req.auth.orgId}::uuid
            AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
            AND name = ${name}
        `;
        if (affected === 0) {
          await tx.$executeRaw`
            INSERT INTO integration_configs
              (id, org_id, type, name, config, credentials, is_active, created_at, updated_at)
            VALUES
              (gen_random_uuid(), ${req.auth.orgId}::uuid, ${AGENT_PROVIDER_CONFIG_TYPE}::integration_type,
               ${name}, ${JSON.stringify(config)}::jsonb,
               ${JSON.stringify(credentials)}::jsonb, true, now(), now())
          `;
        }

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'agent_provider.credentials.upsert',
            targetType: 'IntegrationConfig',
            targetId: null,
            diff: {
              provider,
              hasApiKey: Boolean(apiKey),
              hasModel: Boolean(model),
              hasBaseUrl: Boolean(baseUrl),
            },
          },
        });
      });

      return toSummary(provider, await resolveOrgAgentProviderCredential(req.auth.orgId, provider));
    },
  );

  server.delete(
    '/agent-providers/credentials/:provider',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('integrations:write'), server.requireRole('admin')],
      schema: { params: ProviderParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const provider = req.params.provider;
      const affected = await prisma.$executeRaw`
        UPDATE integration_configs
        SET is_active = false, deleted_at = now(), updated_at = now()
        WHERE org_id = ${req.auth.orgId}::uuid
          AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
          AND name = ${agentProviderCredentialName(provider)}
          AND deleted_at IS NULL
      `;
      if (affected === 0) {
        throw server.httpErrors.notFound('No provider credentials configured for this org');
      }

      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'agent_provider.credentials.delete',
          targetType: 'IntegrationConfig',
          targetId: null,
          diff: { provider },
        },
      });
      // Clearing a provider that is currently active leaves a dangling selector.
      // Drop the active selector too so execution falls back cleanly to env/Dust.
      if ((await getOrgActiveAgentProvider(req.auth.orgId)) === provider) {
        await prisma.$executeRaw`
          UPDATE integration_configs
          SET is_active = false, deleted_at = now(), updated_at = now()
          WHERE org_id = ${req.auth.orgId}::uuid
            AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
            AND name = ${AGENT_PROVIDER_ACTIVE_NAME}
            AND deleted_at IS NULL
        `;
      }
      return reply.code(204).send(null);
    },
  );

  // ── Active-provider selector (vendor switch, no redeploy) ──────────────────
  // Picks which configured provider drives every AI step for this org. Switching
  // is a single-row rewrite; null clears it (falls back to env provider → Dust).
  server.put(
    '/agent-providers/active',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('integrations:write'), server.requireRole('admin')],
      schema: { body: SetActiveBody, response: { 200: ProviderCredentialList } },
    },
    async (req) => {
      const provider = req.body.provider;
      if (provider) {
        // Can only activate a provider that actually has stored credentials.
        const cred = await resolveOrgAgentProviderCredential(req.auth.orgId, provider);
        if (!cred) {
          throw server.httpErrors.badRequest(
            'Configure this provider (save its key) before making it active.',
          );
        }
      }

      const name = AGENT_PROVIDER_ACTIVE_NAME;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`${req.auth.orgId}:${AGENT_PROVIDER_CONFIG_TYPE}:${name}`}))
        `;
        if (provider === null) {
          await tx.$executeRaw`
            UPDATE integration_configs
            SET is_active = false, deleted_at = now(), updated_at = now()
            WHERE org_id = ${req.auth.orgId}::uuid
              AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
              AND name = ${name}
              AND deleted_at IS NULL
          `;
        } else {
          const config = JSON.stringify({ provider });
          const affected = await tx.$executeRaw`
            UPDATE integration_configs
            SET config = ${config}::jsonb, is_active = true, deleted_at = NULL, updated_at = now()
            WHERE org_id = ${req.auth.orgId}::uuid
              AND type::text = ${AGENT_PROVIDER_CONFIG_TYPE}
              AND name = ${name}
          `;
          if (affected === 0) {
            await tx.$executeRaw`
              INSERT INTO integration_configs
                (id, org_id, type, name, config, credentials, is_active, created_at, updated_at)
              VALUES
                (gen_random_uuid(), ${req.auth.orgId}::uuid, ${AGENT_PROVIDER_CONFIG_TYPE}::integration_type,
                 ${name}, ${config}::jsonb, '{}'::jsonb, true, now(), now())
            `;
          }
        }

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'agent_provider.active.set',
            targetType: 'IntegrationConfig',
            targetId: null,
            diff: { provider },
          },
        });
      });

      return listSummaries(req.auth.orgId);
    },
  );

  // ── Live "is it alive?" test call ──────────────────────────────────────────
  // Sends a minimal completion to the org's stored credentials so an admin can
  // confirm the key + endpoint actually work RIGHT NOW. The key is never logged
  // or returned. Errors come back as a structured result (ok:false), not a 5xx.
  server.post(
    '/agent-providers/credentials/:provider/test',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('integrations:read'), server.requireRole('admin')],
      schema: { params: ProviderParam, response: { 200: ProviderTestResult } },
    },
    async (req) => {
      const provider = req.params.provider;
      const cred = await resolveOrgAgentProviderCredential(req.auth.orgId, provider);
      const llm = cred ? credentialToResolvedLlm(cred) : null;
      if (!llm) {
        return {
          provider,
          ok: false,
          model: cred?.model ?? null,
          latencyMs: 0,
          error: 'No usable credentials configured for this provider.',
        };
      }
      const startedAt = Date.now();
      try {
        const text = await completeChat(llm, {
          system: 'You are a connectivity probe. Reply with the single word OK.',
          user: 'Reply with the single word OK.',
          maxTokens: 16,
          timeoutMs: 12_000,
        });
        return {
          provider,
          ok: text.trim().length > 0,
          model: llm.model,
          latencyMs: Date.now() - startedAt,
          error: null,
        };
      } catch (err) {
        return {
          provider,
          ok: false,
          model: llm.model,
          latencyMs: Date.now() - startedAt,
          // completeChat throws HTTP-status / timeout messages — no secret material.
          error: (err as Error).message?.slice(0, 300) ?? 'Provider call failed.',
        };
      }
    },
  );
};
