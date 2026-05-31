// Per-org Dust client resolution for the worker. The security-critical decrypt/
// merge/precedence logic lives once in '@bidstack/shared/server'; this is the
// thin org-scoped DB query + DustClient construction.

import type pino from 'pino';
import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';
import {
  dustCredentialsFromConfigRow,
  dustCredentialsFromEnv,
  type DustCredentials,
} from '@bidstack/shared/server';

export { resolveAgentId, maskApiKey, type DustCredentials } from '@bidstack/shared/server';

/**
 * Resolve an org's Dust credentials: the per-org IntegrationConfig
 * (type='dust', name='dust') first, then the global DUST_* env fallback. null
 * when neither is configured.
 *
 * WHY raw SQL: the 'dust' IntegrationType value isn't in the generated Prisma
 * client until it's regenerated (Linux/Azure regenerates cleanly; the dev
 * Windows DLL lock blocks it). Parameterized + org-scoped.
 */
export async function resolveOrgDustCredentials(orgId: string): Promise<DustCredentials | null> {
  const rows = await prisma.$queryRaw<{ config: unknown; credentials: unknown }[]>`
    SELECT config, credentials FROM integration_configs
    WHERE org_id = ${orgId}::uuid AND type = 'dust' AND name = 'dust'
      AND is_active = true AND deleted_at IS NULL
    LIMIT 1
  `;
  return dustCredentialsFromConfigRow(rows[0] ?? null) ?? dustCredentialsFromEnv(process.env);
}

/**
 * Resolve the org's credentials AND a ready Dust client in a single lookup.
 * Workers need both — the client to run agents and the creds to resolve
 * purpose-specific agent ids (resolveAgentId). client/creds are null together
 * when nothing is configured (fail-open: the caller writes a placeholder).
 */
export async function getOrgDust(
  orgId: string,
  log: pino.Logger,
): Promise<{ client: DustClient | null; creds: DustCredentials | null }> {
  const creds = await resolveOrgDustCredentials(orgId);
  if (!creds) return { client: null, creds: null };
  return {
    client: new DustClient({
      apiKey: creds.apiKey,
      workspaceId: creds.workspaceId,
      baseUrl: creds.baseUrl,
      logger: log,
    }),
    creds,
  };
}

/** A Dust client bound to the org's credentials, or null when none are configured. */
export async function getOrgDustClient(
  orgId: string,
  log: pino.Logger,
): Promise<DustClient | null> {
  const { client } = await getOrgDust(orgId, log);
  if (!client) log.warn({ orgId }, 'dust: no per-org or global credentials configured');
  return client;
}
