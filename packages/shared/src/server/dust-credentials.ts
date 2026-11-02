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
  /** Space `sId` that owns the data source. Not the space display name. */
  spaceId?: string;
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
/**
 * Workspace id is the path segment in https://dust.tt/w/<id> or
 * https://eu.dust.tt/w/<id>. A display name (whitespace) is not an id.
 * Returns null when the value cannot be used as that path segment.
 */
export function canonicalDustWorkspaceId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let id = trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === 'dust.tt' || host === 'eu.dust.tt' || host === 'app.dust.tt') {
      const parts = url.pathname.split('/').filter(Boolean);
      const index = parts.indexOf('w');
      const segment = index >= 0 ? parts[index + 1] : undefined;
      if (!segment) return null;
      id = decodeURIComponent(segment);
    } else if (trimmed.includes('://')) {
      return null;
    }
  } catch {
    // Not a URL. Keep the trimmed string and reject display names below.
  }
  if (!id || /\s/.test(id) || id.includes('/') || id.includes('@') || id.includes('://')) {
    return null;
  }
  return id;
}

/** Space sId. A display name is dropped so document calls are not built from it. */
export function canonicalDustSpaceId(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const id = raw.trim();
  if (!id || /\s/.test(id) || id.includes('/') || id.includes('@') || id.includes('://')) {
    return undefined;
  }
  return id;
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
  const workspaceId = canonicalDustWorkspaceId(str(cfg.workspaceId));
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
    spaceId: canonicalDustSpaceId(str(cfg.spaceId)),
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
  const workspaceId = canonicalDustWorkspaceId(env.DUST_WORKSPACE_ID);
  if (!apiKey || !workspaceId) return null;
  return {
    apiKey,
    workspaceId,
    baseUrl: str(env.DUST_BASE_URL),
    spaceId: canonicalDustSpaceId(env.DUST_SPACE_ID),
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
