// Per-org Dust client resolution for the API. The security-critical decrypt/
// merge/precedence logic lives once in '@bidstack/shared/server'; this is the
// thin org-scoped DB query + DustClient construction (mirrors the worker copy —
// the boilerplate is duplicated so the shared layer stays db-free + web-safe).

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
 * when neither is configured. Raw SQL because the 'dust' enum value isn't in
 * the generated client until regen (Linux/Azure regenerates cleanly).
 */
export async function resolveOrgDustCredentials(orgId: string): Promise<DustCredentials | null> {
  const rows = await prisma.$queryRaw<{ config: unknown; credentials: unknown }[]>`
    SELECT config, credentials FROM integration_configs
    WHERE org_id = ${orgId}::uuid AND type::text = 'dust' AND name = 'dust'
      AND is_active = true AND deleted_at IS NULL
    LIMIT 1
  `;
  return dustCredentialsFromConfigRow(rows[0] ?? null) ?? dustCredentialsFromEnv(process.env);
}

/**
 * Resolve the org's credentials AND a ready Dust client in a single lookup.
 * Callers that also need purpose-specific agent ids (resolveAgentId) use this;
 * client/creds are null together when nothing is configured.
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
