// Settings → Data sources: per-org encrypted API keys for external enrichment
// providers, with a live "Test" that actually calls the provider. Same encrypted
// integration_configs storage + RBAC as the LLM agent-provider routes.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { encryptSecret } from '@bidstack/shared/server-crypto';

import {
  DATA_PROVIDERS,
  DATA_PROVIDER_CONFIG_TYPE,
  DATA_PROVIDER_META,
  dataProviderName,
  listDataProviderStatuses,
  resolveDataProviderApiKey,
  type DataProvider,
} from '../lib/data-provider-credentials.js';
import { fetchSeamlessCompany } from '../providers/company-seamless-enrichment.js';

const ProviderParam = z.object({ provider: z.enum(DATA_PROVIDERS) });

const DataProviderSummary = z.object({
  provider: z.enum(DATA_PROVIDERS),
  label: z.string(),
  description: z.string(),
  docsUrl: z.string(),
  configured: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});

const DataProviderList = z.object({ items: z.array(DataProviderSummary) });

const TestResult = z.object({
  provider: z.enum(DATA_PROVIDERS),
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  sample: z.string().nullable(),
  error: z.string().nullable(),
});

async function listSummaries(orgId: string): Promise<z.infer<typeof DataProviderList>> {
  const statuses = await listDataProviderStatuses(orgId);
  return {
    items: statuses.map((s) => ({
      provider: s.provider,
      label: DATA_PROVIDER_META[s.provider].label,
      description: DATA_PROVIDER_META[s.provider].description,
      docsUrl: DATA_PROVIDER_META[s.provider].docsUrl,
      configured: s.configured,
      updatedAt: s.updatedAt,
    })),
  };
}

// Live connectivity probe per provider — runs a tiny real enrichment with the
// org's stored key. Returns ok:false (not a 5xx) with a structured error.
async function probe(
  provider: DataProvider,
  apiKey: string,
): Promise<{ ok: boolean; sample: string | null; error: string | null }> {
  if (provider === 'seamless') {
    const company = await fetchSeamlessCompany({ name: 'Sanofi', apiKey });
    if (!company) return { ok: false, sample: null, error: 'No result (check the key / plan).' };
    return { ok: true, sample: `${company.legalName ?? 'match'} · ${company.domain ?? ''}`.trim(), error: null };
  }
  return { ok: false, sample: null, error: 'No tester for this provider yet.' };
}

export const dataProviderCredentialsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/data-providers/credentials',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: DataProviderList } },
    },
    async (req) => listSummaries(req.auth.orgId),
  );

  server.put(
    '/data-providers/credentials/:provider',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('integrations:write'), server.requireRole('admin')],
      schema: {
        params: ProviderParam,
        body: z.object({ apiKey: z.string().trim().min(1).max(2_000) }),
        response: { 200: DataProviderSummary },
      },
    },
    async (req) => {
      const provider = req.params.provider;
      const name = dataProviderName(provider);
      const credentials = JSON.stringify({ encrypted: encryptSecret(JSON.stringify({ apiKey: req.body.apiKey })) });
      const config = JSON.stringify({ provider });

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`${req.auth.orgId}:${DATA_PROVIDER_CONFIG_TYPE}:${name}`}))
        `;
        const affected = await tx.$executeRaw`
          UPDATE integration_configs
          SET config = ${config}::jsonb, credentials = ${credentials}::jsonb,
              is_active = true, deleted_at = NULL, updated_at = now()
          WHERE org_id = ${req.auth.orgId}::uuid AND type::text = ${DATA_PROVIDER_CONFIG_TYPE} AND name = ${name}
        `;
        if (affected === 0) {
          await tx.$executeRaw`
            INSERT INTO integration_configs
              (id, org_id, type, name, config, credentials, is_active, created_at, updated_at)
            VALUES
              (gen_random_uuid(), ${req.auth.orgId}::uuid, ${DATA_PROVIDER_CONFIG_TYPE}::integration_type,
               ${name}, ${config}::jsonb, ${credentials}::jsonb, true, now(), now())
          `;
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'data_provider.credentials.upsert',
            targetType: 'IntegrationConfig',
            targetId: null,
            diff: { provider },
          },
        });
      });

      const [summary] = (await listSummaries(req.auth.orgId)).items.filter((i) => i.provider === provider);
      return summary;
    },
  );

  server.delete(
    '/data-providers/credentials/:provider',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('integrations:write'), server.requireRole('admin')],
      schema: { params: ProviderParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const affected = await prisma.$executeRaw`
        UPDATE integration_configs
        SET is_active = false, deleted_at = now(), updated_at = now()
        WHERE org_id = ${req.auth.orgId}::uuid
          AND type::text = ${DATA_PROVIDER_CONFIG_TYPE}
          AND name = ${dataProviderName(req.params.provider)}
          AND deleted_at IS NULL
      `;
      if (affected === 0) throw server.httpErrors.notFound('No credentials configured');
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'data_provider.credentials.delete',
          targetType: 'IntegrationConfig',
          targetId: null,
          diff: { provider: req.params.provider },
        },
      });
      return reply.code(204).send(null);
    },
  );

  server.post(
    '/data-providers/credentials/:provider/test',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('integrations:read'), server.requireRole('admin')],
      schema: { params: ProviderParam, response: { 200: TestResult } },
    },
    async (req) => {
      const provider = req.params.provider;
      const apiKey = await resolveDataProviderApiKey(req.auth.orgId, provider);
      if (!apiKey) {
        return { provider, ok: false, latencyMs: 0, sample: null, error: 'No key saved yet.' };
      }
      const startedAt = Date.now();
      try {
        const r = await probe(provider, apiKey);
        return { provider, ok: r.ok, latencyMs: Date.now() - startedAt, sample: r.sample, error: r.error };
      } catch (err) {
        return {
          provider,
          ok: false,
          latencyMs: Date.now() - startedAt,
          sample: null,
          error: (err as Error).message?.slice(0, 300) ?? 'Provider call failed.',
        };
      }
    },
  );
};
