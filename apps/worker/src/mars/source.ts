/**
 * Picks the MARS source from env. Names only here; values are never logged.
 *
 *   MARS_SOURCE            powerbi | api | file_export | auto (default auto:
 *                          Power BI when configured, else the REST API)
 *   Power BI (primary):    MARS_PBI_TENANT_ID, MARS_PBI_CLIENT_ID,
 *                          MARS_PBI_CLIENT_SECRET, MARS_PBI_WORKSPACE_ID,
 *                          MARS_PBI_DATASET_ID, MARS_PBI_COLUMNS (JSON
 *                          MarsColumnMap, default placeholder names),
 *                          MARS_PBI_WATERMARK (updatedAt | meetingDate),
 *                          MARS_PBI_BACKFILL_DAYS, MARS_PBI_LOOKBACK_DAYS,
 *                          MARS_PBI_PAGE_ROWS, MARS_PBI_IMPERSONATED_UPN
 *   REST API:              see marsClientFromEnv in client.ts
 *   File export:           mock only, so env selection reports not configured
 */
import { DEFAULT_MARS_COLUMN_MAP, MarsColumnMap } from '@bidstack/shared';

import { type MarsClient, marsClientFromEnv, notConfiguredMarsClient } from './client.js';
import { powerBiMarsSource } from './powerbi.js';

const num = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function marsColumnMapFromEnv(env: NodeJS.ProcessEnv = process.env): MarsColumnMap {
  const raw = env.MARS_PBI_COLUMNS?.trim();
  if (!raw) return DEFAULT_MARS_COLUMN_MAP;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('MARS_PBI_COLUMNS is not valid JSON');
  }
  const r = MarsColumnMap.safeParse(json);
  if (!r.success) throw new Error(`MARS_PBI_COLUMNS is invalid: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return r.data;
}

export function powerBiSourceFromEnv(env: NodeJS.ProcessEnv = process.env): MarsClient | null {
  const tenantId = env.MARS_PBI_TENANT_ID?.trim();
  const clientId = env.MARS_PBI_CLIENT_ID?.trim();
  const clientSecret = env.MARS_PBI_CLIENT_SECRET;
  const workspaceId = env.MARS_PBI_WORKSPACE_ID?.trim();
  const datasetId = env.MARS_PBI_DATASET_ID?.trim();
  if (!tenantId || !clientId || !clientSecret || !workspaceId || !datasetId) return null;
  const wm = env.MARS_PBI_WATERMARK?.trim();
  return powerBiMarsSource({
    tenantId,
    clientId,
    clientSecret,
    workspaceId,
    datasetId,
    columns: marsColumnMapFromEnv(env),
    ...(wm === 'updatedAt' || wm === 'meetingDate' ? { watermark: wm } : {}),
    backfillDays: num(env.MARS_PBI_BACKFILL_DAYS),
    lookbackDays: num(env.MARS_PBI_LOOKBACK_DAYS),
    pageRows: num(env.MARS_PBI_PAGE_ROWS),
    ...(env.MARS_PBI_IMPERSONATED_UPN?.trim() ? { impersonatedUserName: env.MARS_PBI_IMPERSONATED_UPN.trim() } : {}),
  });
}

/** Never throws: a bad MARS config must not stop the worker; the sync then records not_configured. */
export function marsSourceFromEnv(env: NodeJS.ProcessEnv = process.env): MarsClient {
  try {
    return pickSource(env);
  } catch (err) {
    console.warn(`[mars] source config rejected: ${(err as Error).message}`);
    return notConfiguredMarsClient;
  }
}

function pickSource(env: NodeJS.ProcessEnv): MarsClient {
  const pick = (env.MARS_SOURCE ?? 'auto').trim().toLowerCase();
  if (pick === 'powerbi') return powerBiSourceFromEnv(env) ?? notConfiguredMarsClient;
  if (pick === 'api') return marsClientFromEnv(env);
  if (pick === 'file_export') return notConfiguredMarsClient; // mock only until a Graph store is approved
  return powerBiSourceFromEnv(env) ?? marsClientFromEnv(env);
}
