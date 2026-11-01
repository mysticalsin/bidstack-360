/**
 * Power BI as the MARS source (primary). The MARS dashboard sits on a Power
 * BI dataset, so Polo reads the same rows the dashboard shows, per account,
 * with a service principal and the executeQueries REST API.
 *
 *  - Auth: Entra ID (Azure AD) client credentials, scope
 *    https://analysis.windows.net/powerbi/api/.default. Tenant id, client id
 *    and secret come from env only and never reach logs or errors.
 *  - Query: one DAX query per mapped account, built from the column map.
 *    Every name and value is escaped (table 'x''y', column [x]]y], string
 *    "x""y"); the account filter is IN { exact values }, never SEARCH or
 *    CONTAINSSTRING, so it is whole value only.
 *  - Incremental: watermark on updatedAt when mapped, else meeting date, with
 *    a lookback window at the start of each run for late edits.
 *  - Paging: TOPN on the watermark. TOPN keeps every tie of the last row, so
 *    a page always ends on a complete watermark value and the next page asks
 *    for strictly later values; nothing is skipped or split mid value.
 *  - Row caps: executeQueries allows 100,000 rows or 1,000,000 values per
 *    query and 15 MB. The page size is kept well under the value cap for the
 *    number of mapped columns; a "too many rows" result (HTTP 200 with an
 *    error) halves the page and retries the same window.
 *  - Throttling: 120 queries per minute per caller, so requests are spaced
 *    (minIntervalMs) and a 429 honours Retry-After, inline when short, else
 *    MarsRateLimitedError so the job retries later. 5xx back off and retry.
 *
 * Doc: fleet/polo-mars-integration.md, section "Power BI source".
 */
import type { MarsColumnMap, MarsTabularField } from '@bidstack/shared';

import { type MarsClient, MarsHttpError, type MarsPage, MarsRateLimitedError, retryAfterMs } from './client.js';
import { type MarsTabularRow, rowsToEntries, toDate } from './tabular.js';

export const PBI_MAX_ROWS = 100_000;
export const PBI_MAX_VALUES = 1_000_000;
const MIN_PAGE_ROWS = 50;

export interface PowerBiConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
  datasetId: string;
  columns: MarsColumnMap;
  /** Default: updatedAt when mapped, else meetingDate. */
  watermark?: 'updatedAt' | 'meetingDate';
  /** First run window. Default 730 days. */
  backfillDays?: number;
  /** Re-read window at the start of each run. Default 0 with updatedAt, 14 days with meeting date. */
  lookbackDays?: number;
  /** Rows per query before the cap check. Default 5000. */
  pageRows?: number;
  /** Only for an RLS dataset queried with a user identity; ignored by Power BI otherwise. */
  impersonatedUserName?: string;
  minIntervalMs?: number;
  maxRetries?: number;
  /** Longest Retry-After waited inline; longer waits go back to the queue. */
  maxInlineWaitMs?: number;
  timeoutMs?: number;
  authorityHost?: string;
  apiBase?: string;
}

export interface PbiResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type PbiFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<PbiResponse>;

export class PowerBiQueryError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`Power BI query failed (${code}): ${detail.slice(0, 200)}`);
    this.name = 'PowerBiQueryError';
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

// ─── DAX building (every identifier and value escaped) ─────────────────────

export const daxTable = (t: string) => `'${t.replace(/'/g, "''")}'`;
export const daxColumn = (table: string, c: string) => `${daxTable(table)}[${c.replace(/\]/g, ']]')}]`;
export const daxString = (s: string) => `"${s.replace(/"/g, '""')}"`;
export const daxDateTime = (d: Date) =>
  `DATETIME(${d.getUTCFullYear()}, ${d.getUTCMonth() + 1}, ${d.getUTCDate()}, ${d.getUTCHours()}, ${d.getUTCMinutes()}, ${d.getUTCSeconds()})`;
const alias = (f: MarsTabularField) => `mars_${f}`;

export function mappedFields(map: MarsColumnMap): MarsTabularField[] {
  return (Object.keys(map.columns) as MarsTabularField[]).filter((f) => !!map.columns[f]);
}

/**
 * The parameterised pull: account values and watermark are the parameters,
 * passed as escaped literals (executeQueries has no bind variables).
 */
export function buildMarsDax(map: MarsColumnMap, p: { accountKeys: readonly string[]; watermarkField: 'updatedAt' | 'meetingDate'; since: Date; inclusive: boolean; rows: number }): string {
  const t = map.table;
  const col = (f: MarsTabularField) => daxColumn(t, map.columns[f]!);
  const wmCol = map.columns[p.watermarkField] ? col(p.watermarkField) : col('meetingDate');
  const keys = [...new Set(p.accountKeys)].map(daxString).join(', ');
  const select = mappedFields(map).map((f) => `    ${daxString(alias(f))}, ${col(f)}`).join(',\n');
  const wmAlias = `[${alias(map.columns[p.watermarkField] ? p.watermarkField : 'meetingDate')}]`;
  return [
    '// Polo MARS pull, one account per query',
    'DEFINE',
    `  VAR __since = ${daxDateTime(p.since)}`,
    'EVALUATE',
    'TOPN(',
    `  ${Math.max(1, Math.floor(p.rows))},`,
    '  SELECTCOLUMNS(',
    '    FILTER(',
    `      ${daxTable(t)},`,
    `      ${col('account')} IN { ${keys} } && ${wmCol} ${p.inclusive ? '>=' : '>'} __since`,
    '    ),',
    select,
    '  ),',
    `  ${wmAlias}, ASC`,
    ')',
    `ORDER BY ${wmAlias} ASC`,
  ].join('\n');
}

/** "[mars_account]" or "Table[mars_account]" to "account". */
function logicalRow(raw: Record<string, unknown>): MarsTabularRow {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = /\[mars_([A-Za-z]+)\]$/.exec(k) ?? /^mars_([A-Za-z]+)$/.exec(k);
    if (m) out[m[1]!] = v;
  }
  return out as MarsTabularRow;
}

// ─── cursor: pbi1:<w|p>:<iso>. w = end of a run (lookback applies), p = mid run ──

export function encodePbiCursor(kind: 'w' | 'p', at: Date) {
  return `pbi1:${kind}:${at.toISOString()}`;
}
export function decodePbiCursor(c: string | null): { kind: 'w' | 'p'; at: Date } | null {
  const m = /^pbi1:([wp]):(.+)$/.exec(c ?? '');
  if (!m) return null;
  const at = new Date(m[2]!);
  return Number.isNaN(at.getTime()) ? null : { kind: m[1] as 'w' | 'p', at };
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function powerBiMarsSource(
  cfg: PowerBiConfig,
  deps: { fetch?: PbiFetch; sleep?: (ms: number) => Promise<void>; now?: () => Date } = {},
): MarsClient & { lastQuery(): string | null } {
  if (!TENANT.test(cfg.tenantId)) throw new Error('MARS_PBI_TENANT_ID must be a tenant GUID or domain');
  if (!GUID.test(cfg.workspaceId) || !GUID.test(cfg.datasetId)) throw new Error('MARS_PBI_WORKSPACE_ID and MARS_PBI_DATASET_ID must be GUIDs');
  const authority = (cfg.authorityHost ?? 'https://login.microsoftonline.com').replace(/\/+$/, '');
  const api = (cfg.apiBase ?? 'https://api.powerbi.com').replace(/\/+$/, '');
  if (!/^https:\/\//.test(authority) || !/^https:\/\//.test(api)) throw new Error('Power BI endpoints must be https');

  const fetchImpl = deps.fetch ?? (fetch as unknown as PbiFetch);
  const sleep = deps.sleep ?? sleepReal;
  const now = deps.now ?? (() => new Date());
  const watermarkField = cfg.watermark ?? (cfg.columns.columns.updatedAt ? 'updatedAt' : 'meetingDate');
  const lookbackMs = (cfg.lookbackDays ?? (watermarkField === 'updatedAt' ? 0 : 14)) * 86_400_000;
  const backfillMs = (cfg.backfillDays ?? 730) * 86_400_000;
  const nCols = mappedFields(cfg.columns).length;
  const capRows = Math.max(MIN_PAGE_ROWS, Math.min(PBI_MAX_ROWS, Math.floor(PBI_MAX_VALUES / Math.max(1, nCols))));
  // Half the cap: TOPN may return more rows than asked when the last watermark value has ties.
  let pageRows = Math.max(MIN_PAGE_ROWS, Math.min(cfg.pageRows ?? 5000, Math.floor(capRows / 2)));
  const minInterval = cfg.minIntervalMs ?? 550;
  const maxRetries = cfg.maxRetries ?? 3;
  const maxInlineWait = cfg.maxInlineWaitMs ?? 30_000;
  const timeout = cfg.timeoutMs ?? 60_000;
  const queryUrl = `${api}/v1.0/myorg/groups/${cfg.workspaceId}/datasets/${cfg.datasetId}/executeQueries`;
  const tokenUrl = `${authority}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;

  let token: { value: string; exp: number } | null = null;
  let lastAt = 0;
  let lastQuery: string | null = null;

  async function call(url: string, init: Parameters<PbiFetch>[1]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function bearer(force = false): Promise<string> {
    if (!force && token && token.exp > Date.now() + 60_000) return token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: 'https://analysis.windows.net/powerbi/api/.default',
    }).toString();
    const res = await call(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
    if (!res.ok) throw new MarsHttpError(res.status); // AADSTS detail stays out of logs
    const json = parseJson(await res.text()) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!json || typeof json.access_token !== 'string') throw new MarsHttpError(502);
    token = { value: json.access_token, exp: Date.now() + (Number(json.expires_in) || 3000) * 1000 };
    return token.value;
  }

  async function execute(query: string): Promise<{ rows: Record<string, unknown>[]; capped: boolean }> {
    const body = JSON.stringify({
      queries: [{ query }],
      serializerSettings: { includeNulls: true },
      ...(cfg.impersonatedUserName ? { impersonatedUserName: cfg.impersonatedUserName } : {}),
    });
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const wait = lastAt + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      const res = await call(queryUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json', accept: 'application/json' },
        body,
      });
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await bearer(true);
        continue;
      }
      if (res.status === 429) {
        const ms = retryAfterMs(res.headers.get('retry-after'));
        if (attempt < maxRetries && ms <= maxInlineWait) {
          await sleep(ms);
          continue;
        }
        throw new MarsRateLimitedError(ms);
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(Math.min(30_000, 1000 * 2 ** attempt));
        continue;
      }
      const json = parseJson(await res.text()) as PbiBody | null;
      if (!res.ok) {
        const e = json?.error ?? json?.results?.[0]?.error;
        if (res.status === 400 && e) throw new PowerBiQueryError(String(e.code ?? 'bad_request'), String(e.message ?? e.details?.[0]?.detail?.value ?? ''));
        throw new MarsHttpError(res.status);
      }
      const result = json?.results?.[0];
      const table = result?.tables?.[0];
      const err = json?.error ?? result?.error ?? table?.error;
      if (err) {
        const msg = `${err.code ?? ''} ${err.message ?? ''}`;
        if (/more than .*rows|rows in a query result|values? in a query|exceed|15 ?mb/i.test(msg)) return { rows: [], capped: true };
        throw new PowerBiQueryError(String(err.code ?? 'query_error'), String(err.message ?? ''));
      }
      return { rows: Array.isArray(table?.rows) ? table.rows : [], capped: false };
    }
  }

  return {
    configured: true,
    kind: 'powerbi',
    scope: 'account',
    lastQuery: () => lastQuery,
    async listEntries({ cursor, updatedSince, accountKeys }): Promise<MarsPage> {
      const keys = (accountKeys ?? []).map((k) => k.trim()).filter(Boolean);
      if (!keys.length) return { items: [], nextCursor: cursor, hasMore: false };
      const c = decodePbiCursor(cursor);
      const since = c
        ? c.kind === 'w' && lookbackMs > 0 ? new Date(c.at.getTime() - lookbackMs) : c.at
        : updatedSince ?? new Date(now().getTime() - backfillMs);
      const inclusive = !c || (c.kind === 'w' && lookbackMs > 0);

      for (;;) {
        const query = buildMarsDax(cfg.columns, { accountKeys: keys, watermarkField, since, inclusive, rows: pageRows });
        lastQuery = query;
        const { rows, capped } = await execute(query);
        if (capped) {
          if (pageRows <= MIN_PAGE_ROWS) throw new PowerBiQueryError('row_cap', 'one watermark value holds more rows than a query may return');
          pageRows = Math.max(MIN_PAGE_ROWS, Math.floor(pageRows / 2));
          continue;
        }
        const logical = rows.map(logicalRow);
        const wmKey: MarsTabularField = cfg.columns.columns[watermarkField] ? watermarkField : 'meetingDate';
        const marks = logical.map((r) => toDate(r[wmKey])).filter((d): d is Date => !!d);
        const high = marks.length ? new Date(Math.max(...marks.map((d) => d.getTime()))) : null;
        const hasMore = rows.length >= pageRows && !!high;
        const { entries } = rowsToEntries(logical, { source: 'pbi', accountKeys: keys });
        // Mid run: continue strictly after this page. End of run: never move the watermark back (lookback re-reads).
        if (hasMore) return { items: entries, nextCursor: encodePbiCursor('p', high!), hasMore };
        const at = high && (!c || high > c.at) ? high : c?.at ?? null;
        return { items: entries, nextCursor: at ? encodePbiCursor('w', at) : cursor, hasMore: false };
      }
    },
  };
}

interface PbiError { code?: unknown; message?: unknown; details?: Array<{ detail?: { value?: unknown } }> }
interface PbiBody {
  error?: PbiError;
  results?: Array<{ error?: PbiError; tables?: Array<{ error?: PbiError; rows?: Record<string, unknown>[] }> }>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}
