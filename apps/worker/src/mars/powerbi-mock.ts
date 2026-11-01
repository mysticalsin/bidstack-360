/**
 * Mock Power BI (Entra token endpoint plus executeQueries) for tests. It
 * runs the query shape buildMarsDax produces against an in-memory table:
 * the account IN { } filter (case-insensitive whole value, like DAX), the
 * watermark comparison, TOPN with ties and the row cap. No network.
 */
import { type MarsColumnMap, type MarsTabularField, normalizeMarsAccountKey } from '@bidstack/shared';

import type { PbiFetch, PbiResponse } from './powerbi.js';
import { toDate } from './tabular.js';

export type MockPbiStep =
  | { status: number; retryAfter?: string; body?: unknown }
  | { capError: true };

const res = (status: number, body: unknown, headers: Record<string, string> = {}): PbiResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  // Power BI prefixes its JSON with a BOM; the client must cope.
  text: async () => `\uFEFF${JSON.stringify(body)}`,
});

function parseKeys(list: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"]|"")*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(list))) out.push(m[1]!.replace(/""/g, '"'));
  return out;
}

export function mockPowerBi(map: MarsColumnMap, table: () => Array<Record<string, unknown>>, opts: { rowCap?: number; tokenTtl?: number } = {}) {
  const steps: MockPbiStep[] = [];
  const calls = { token: 0, queries: [] as string[], bodies: [] as Array<Record<string, unknown>>, urls: [] as string[], tokenBodies: [] as string[], auth: [] as string[] };
  let tokenN = 0;

  const fetch: PbiFetch = async (url, init) => {
    calls.urls.push(url);
    if (url.includes('/oauth2/v2.0/token')) {
      calls.token++;
      calls.tokenBodies.push(init.body ?? '');
      return res(200, { token_type: 'Bearer', access_token: `tok-${++tokenN}`, expires_in: opts.tokenTtl ?? 3599 });
    }
    calls.auth.push(init.headers.authorization ?? '');
    const step = steps.shift();
    if (step && 'status' in step) return res(step.status, step.body ?? { error: { code: 'Mock', message: 'mock failure' } }, step.retryAfter ? { 'retry-after': step.retryAfter } : {});
    const body = JSON.parse(init.body ?? '{}') as { queries: Array<{ query: string }> };
    calls.bodies.push(body);
    const q = body.queries[0]!.query;
    calls.queries.push(q);
    if (step && 'capError' in step) return res(200, { results: [{ tables: [{ rows: [], error: { code: 'DatasetExecuteQueriesError', message: 'More than 100000 rows in a query result' } }] }] });

    const keys = new Set(parseKeys(/IN \{ (.*) \} &&/.exec(q)?.[1] ?? '').map(normalizeMarsAccountKey));
    const d = /VAR __since = DATETIME\((\d+), (\d+), (\d+), (\d+), (\d+), (\d+)\)/.exec(q)!;
    const since = Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!, +d[4]!, +d[5]!, +d[6]!);
    const inclusive = /\] >= __since/.test(q);
    const n = Number(/TOPN\(\n\s+(\d+),/.exec(q)![1]);
    const wmField = /ORDER BY \[mars_(\w+)\] ASC/.exec(q)![1] as MarsTabularField;
    const col = (f: MarsTabularField) => map.columns[f]!;
    const wmOf = (r: Record<string, unknown>) => toDate(r[col(wmField)])?.getTime() ?? 0;

    const hits = table()
      .filter((r) => keys.has(normalizeMarsAccountKey(String(r[col('account')] ?? ''))))
      .filter((r) => (inclusive ? wmOf(r) >= since : wmOf(r) > since))
      .sort((a, b) => wmOf(a) - wmOf(b));
    let out = hits.slice(0, n);
    if (out.length === n) {
      const last = wmOf(out[n - 1]!);
      out = hits.filter((r, i) => i < n || wmOf(r) === last); // TOPN keeps ties
    }
    if (opts.rowCap && out.length > opts.rowCap) {
      return res(200, { results: [{ tables: [{ rows: [], error: { code: 'DatasetExecuteQueriesError', message: `More than ${opts.rowCap} rows in a query result` } }] }] });
    }
    const fields = (Object.keys(map.columns) as MarsTabularField[]).filter((f) => !!map.columns[f] && q.includes(`"mars_${f}"`));
    const rows = out.map((r) => Object.fromEntries(fields.map((f) => [`[mars_${f}]`, r[col(f)] ?? null])));
    return res(200, { results: [{ tables: [{ rows }] }] });
  };

  return { fetch, calls, steps };
}

/** Power BI style datetime: no zone, seconds precision. */
export const pbiDate = (d: Date) => d.toISOString().slice(0, 19);
