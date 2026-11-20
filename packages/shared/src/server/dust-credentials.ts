// Per-org Dust credential resolution — server-only, PURE (no DB, no network).
//
// This owns the SECURITY-critical part — what is secret, how it is decrypted,
// and org-vs-env precedence — so that logic lives in exactly one place. The
// thin per-app DB query + DustClient construction live in each app's
// lib/dust-credentials.ts (they have prisma + the Dust client). Keeping this
// pure means @bidstack/shared stays a leaf package (no db/dust-client deps) and
// the web bundle never pulls server code in.

import { decryptSecret } from '../utils/crypto.js';

export interface DustCredentials {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
  dataSourceId?: string;
  /** Purpose -> Dust agent id (e.g. { crew, sectionDraft, qaReview, default }). */
  agentIds: Record<string, string>;
  /** 'org' = the org's IntegrationConfig; 'env' = the global DUST_* fallback. */
  source: 'org' | 'env';
}

/** Canonical IntegrationConfig coordinates for an org's Dust integration. */
export const DUST_INTEGRATION = { type: 'dust', name: 'dust' } as const;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function asStringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(asRecord(v))) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

/**
 * Build credentials from an org's IntegrationConfig row (type='dust',
 * name='dust'). The apiKey is decrypted from credentials.encrypted; the
 * non-secret config (workspaceId/baseUrl/dataSourceId/agentIds) is read in
 * plaintext. Returns null when the row is absent, has no encrypted key, no
 * workspaceId, or the blob fails to decrypt (so the caller falls back to env).
 */
export function dustCredentialsFromConfigRow(
  row: { config: unknown; credentials: unknown } | null | undefined,
): DustCredentials | null {
  if (!row) return null;
  const cfg = asRecord(row.config);
  const workspaceId = str(cfg.workspaceId);
  const encrypted = str(asRecord(row.credentials).encrypted);
  if (!workspaceId || !encrypted) return null;

  let apiKey: string | undefined;
  try {
    const parsed = JSON.parse(decryptSecret(encrypted)) as { apiKey?: unknown };
    apiKey = str(parsed.apiKey);
  } catch {
    return null; // tampered or rotated key — caller falls back to env
  }
  if (!apiKey) return null;

  return {
    apiKey,
    workspaceId,
    baseUrl: str(cfg.baseUrl),
    dataSourceId: str(cfg.dataSourceId),
    agentIds: asStringMap(cfg.agentIds),
    source: 'org',
  };
}

/** Global DUST_* env fallback (keeps existing single-tenant deployments working
 *  until an org admin enters keys; org config always takes precedence). */
export function dustCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): DustCredentials | null {
  const apiKey = str(env.DUST_API_KEY);
  const workspaceId = str(env.DUST_WORKSPACE_ID);
  if (!apiKey || !workspaceId) return null;
  return {
    apiKey,
    workspaceId,
    baseUrl: str(env.DUST_BASE_URL),
    dataSourceId: str(env.DUST_DATA_SOURCE_ID),
    agentIds: {},
    source: 'env',
  };
}

/** Resolve a purpose-specific Dust agent id: org config first, then env fallback. */
export function resolveAgentId(
  creds: DustCredentials | null,
  purpose: string,
  envFallback?: string,
): string | undefined {
  return str(creds?.agentIds[purpose]) ?? str(envFallback);
}

/** Mask an apiKey for safe display (never return the plaintext to a client). */
export function maskApiKey(apiKey: string | undefined): string | null {
  if (!apiKey) return null;
  return apiKey.length <= 4 ? '****' : `****${apiKey.slice(-4)}`;
}
