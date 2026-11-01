// Power BI MARS source against a mocked Entra token endpoint and a mocked
// executeQueries: escaping, auth, strict account filter, row grouping,
// watermark paging with TOPN ties, row caps, 429 and 5xx backoff.
import { describe, expect, it } from 'vitest';

import { type MarsColumnMap, MarsEntry } from '@bidstack/shared';

import { MarsHttpError, MarsRateLimitedError } from './client.js';
import { buildMarsDax, daxColumn, daxString, daxTable, decodePbiCursor, encodePbiCursor, PBI_MAX_VALUES, powerBiMarsSource, type PowerBiConfig, PowerBiQueryError } from './powerbi.js';
import { mockPowerBi, pbiDate } from './powerbi-mock.js';
import { marsSourceFromEnv } from './source.js';

const NOW = new Date('2026-10-31T15:00:00Z');
const TENANT = '11111111-2222-3333-4444-555555555555';
const WS = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DS = 'ffffffff-0000-1111-2222-333333333333';
const SECRET = 'pbi-test-secret-value-do-not-log';

const MAP: MarsColumnMap = {
  table: "MARS 'Meetings'",
  columns: {
    account: 'Account',
    contactName: 'Contact Name',
    contactEmail: 'Contact Email',
    contactTitle: 'Contact Title',
    company: 'Company',
    meetingDate: 'Meeting Date',
    internalAttendee: 'Internal Attendee',
    notes: 'Notes',
    entryId: 'Entry ID',
    updatedAt: 'Modified [UTC]',
  },
};

const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
function row(entry: string, account: string, d: number, contact: string, extra: Record<string, unknown> = {}) {
  return {
    'Entry ID': entry,
    Account: account,
    'Contact Name': contact,
    'Contact Email': `${contact.split(' ')[0]!.toLowerCase()}@northwind-energy.example`,
    'Contact Title': 'Director',
    Company: 'Northwind Energy plc',
    'Meeting Date': pbiDate(day(d)),
    'Modified [UTC]': pbiDate(day(d - 0.5)),
    'Internal Attendee': 'Alex Turner <kam.uk@polo.example>; Sam Lee',
    Notes: `Notes ${entry}`,
    ...extra,
  };
}

const TABLE = [
  row('E1', 'Northwind Energy', 20, 'Jane Doe'),
  row('E1', 'Northwind Energy', 20, 'Raj Patel', { 'Contact Title': 'CIO' }),
  row('E2', 'NORTHWIND ENERGY ', 10, 'Lena Brandt'),
  row('E3', 'Northwind Energy Services', 9, 'Not Ours'), // substring of no key: must never come back
  row('E4', 'Contoso', 8, 'Other Account'),
  row('E5', 'NWE-UK', 5, 'Mo Khan', { 'Internal Attendee': 'kam.fr@polo.example' }),
];

const cfg = (over: Partial<PowerBiConfig> = {}): PowerBiConfig => ({
  tenantId: TENANT, clientId: 'client-id', clientSecret: SECRET, workspaceId: WS, datasetId: DS, columns: MAP, minIntervalMs: 0, ...over,
});
const make = (table = TABLE, over: Partial<PowerBiConfig> = {}, mockOpts: Parameters<typeof mockPowerBi>[2] = {}) => {
  const pbi = mockPowerBi(MAP, () => table, mockOpts);
  const sleeps: number[] = [];
  const src = powerBiMarsSource(cfg(over), { fetch: pbi.fetch, sleep: async (ms) => void sleeps.push(ms), now: () => NOW });
  return { pbi, src, sleeps };
};
const KEYS = ['Northwind Energy', 'NWE-UK'];

describe('DAX building', () => {
  it('escapes table, column and string values and filters with IN, never substring', () => {
    expect(daxTable("MARS 'Meetings'")).toBe("'MARS ''Meetings'''");
    expect(daxColumn('T', 'Modified [UTC]')).toBe("'T'[Modified [UTC]]]");
    expect(daxString('Acme "Holdings"')).toBe('"Acme ""Holdings"""');
    const q = buildMarsDax(MAP, { accountKeys: ['Acme "X"', 'Acme "X"', 'B'], watermarkField: 'updatedAt', since: new Date('2026-01-02T03:04:05Z'), inclusive: false, rows: 500 });
    expect(q).toContain(`'MARS ''Meetings'''[Account] IN { "Acme ""X""", "B" }`);
    expect(q).toContain('VAR __since = DATETIME(2026, 1, 2, 3, 4, 5)');
    expect(q).toContain("'MARS ''Meetings'''[Modified [UTC]]] > __since");
    expect(q).toMatch(/TOPN\(\n\s+500,/);
    expect(q).toContain('ORDER BY [mars_updatedAt] ASC');
    expect(q).not.toMatch(/SEARCH|CONTAINSSTRING|FIND\(/);
    // A key cannot break out of its literal.
    const evil = buildMarsDax(MAP, { accountKeys: ['x" } || TRUE() || "'], watermarkField: 'meetingDate', since: NOW, inclusive: true, rows: 10 });
    expect(evil).toContain('IN { "x"" } || TRUE() || """ }');
  });

  it('round trips cursors and rejects foreign ones', () => {
    expect(decodePbiCursor(encodePbiCursor('w', NOW))).toEqual({ kind: 'w', at: NOW });
    expect(decodePbiCursor('c3')).toBeNull();
    expect(decodePbiCursor(null)).toBeNull();
  });

  it('validates ids and endpoints before any call', () => {
    expect(() => powerBiMarsSource(cfg({ datasetId: '../../admin' }))).toThrow(/GUID/);
    expect(() => powerBiMarsSource(cfg({ tenantId: 'not a tenant' }))).toThrow(/tenant/);
    expect(() => powerBiMarsSource(cfg({ apiBase: 'http://api.powerbi.com' }))).toThrow(/https/);
  });
});

describe('powerBiMarsSource', () => {
  it('gets a service principal token, queries one account, groups rows into valid entries', async () => {
    const { pbi, src } = make();
    expect(src.kind).toBe('powerbi');
    expect(src.scope).toBe('account');
    const page = await src.listEntries({ cursor: null, updatedSince: null, limit: 100, accountKeys: KEYS });

    expect(pbi.calls.token).toBe(1);
    const form = new URLSearchParams(pbi.calls.tokenBodies[0]);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('https://analysis.windows.net/powerbi/api/.default');
    expect(form.get('client_id')).toBe('client-id');
    expect(pbi.calls.urls[0]).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    expect(pbi.calls.urls[1]).toBe(`https://api.powerbi.com/v1.0/myorg/groups/${WS}/datasets/${DS}/executeQueries`);
    expect(pbi.calls.auth[0]).toBe('Bearer tok-1');
    expect(pbi.calls.bodies[0]).toMatchObject({ serializerSettings: { includeNulls: true } });
    expect(pbi.calls.bodies[0]).not.toHaveProperty('impersonatedUserName');
    // First run: inclusive backfill window, default 730 days.
    expect(pbi.calls.queries[0]).toContain('>= __since');

    const items = page.items.map((i) => MarsEntry.parse(i));
    expect(items.map((e) => e.client.marsAccountId)).toEqual(['Northwind Energy', 'NORTHWIND ENERGY', 'NWE-UK']);
    const e1 = items[0]!;
    expect(e1.id).toBe('mt-E1');
    expect(e1.contacts.map((c) => [c.fullName, c.jobTitle])).toEqual([['Jane Doe', 'Director'], ['Raj Patel', 'CIO']]);
    expect(e1.client.name).toBe('Northwind Energy plc');
    expect(e1.loggedBy).toEqual({ email: 'kam.uk@polo.example', name: 'Alex Turner', region: null });
    expect(e1.internalAttendees).toEqual([{ name: 'Sam Lee', email: null }]);
    expect(e1.notes).toBe('Notes E1');
    expect(e1.version).toBe(Math.floor(new Date(`${pbiDate(day(19.5))}Z`).getTime() / 1000));
    expect(e1.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.hasMore).toBe(false);
    expect(decodePbiCursor(page.nextCursor)?.kind).toBe('w');
    expect(decodePbiCursor(page.nextCursor)?.at.toISOString()).toBe(`${pbiDate(day(4.5))}.000Z`);
    expect(JSON.stringify(page)).not.toContain('Not Ours');
  });

  it('returns nothing and calls nothing without account keys', async () => {
    const { pbi, src } = make();
    const page = await src.listEntries({ cursor: 'pbi1:w:2026-10-01T00:00:00.000Z', updatedSince: null, limit: 10, accountKeys: [] });
    expect(page).toEqual({ items: [], nextCursor: 'pbi1:w:2026-10-01T00:00:00.000Z', hasMore: false });
    expect(pbi.calls.urls).toHaveLength(0);
  });

  it('reads a short history in one page, then resumes strictly after the watermark', async () => {
    const table = Array.from({ length: 7 }, (_, i) => row(`P${i}`, 'Northwind Energy', 30 - i, `Person ${i}`));
    table.push(row('P2b', 'Northwind Energy', 28, 'Tie Person')); // same watermark as P2
    const { pbi, src } = make(table, { pageRows: 50 });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const p = await src.listEntries({ cursor, updatedSince: null, limit: 10, accountKeys: ['Northwind Energy'] });
      pages++;
      seen.push(...p.items.map((i) => (i as { id: string }).id));
      cursor = p.nextCursor;
      if (!p.hasMore) break;
    }
    expect(pages).toBe(1);
    expect(seen.sort()).toEqual(['mt-P0', 'mt-P1', 'mt-P2', 'mt-P2b', 'mt-P3', 'mt-P4', 'mt-P5', 'mt-P6']);

    // Second run from the stored watermark: strictly later only (no lookback with updatedAt).
    const again = await src.listEntries({ cursor, updatedSince: null, limit: 10, accountKeys: ['Northwind Energy'] });
    expect(again.items).toHaveLength(0);
    expect(pbi.calls.queries.at(-1)).toContain('> __since');
    expect(again.nextCursor).toBe(cursor);
  });

  it('splits a large history into pages that never cut a watermark value', async () => {
    // Three entries per watermark value: row 50 shares its value with rows 48 and 49, so page 1 holds 51.
    const table = Array.from({ length: 130 }, (_, i) => row(`L${i}`, 'Northwind Energy', 200 - Math.floor(i / 3), `Person ${i}`));
    const { pbi, src } = make(table, { pageRows: 50 });
    const seen = new Set<string>();
    let cursor: string | null = null;
    const kinds: string[] = [];
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const p = await src.listEntries({ cursor, updatedSince: null, limit: 10, accountKeys: ['Northwind Energy'] });
      sizes.push(p.items.length);
      for (const i of p.items) seen.add((i as { id: string }).id);
      cursor = p.nextCursor;
      kinds.push(decodePbiCursor(cursor)!.kind);
      if (!p.hasMore) break;
    }
    expect(seen.size).toBe(130);
    expect(sizes).toEqual([51, 51, 28]);
    expect(kinds).toEqual(['p', 'p', 'w']);
    expect(pbi.calls.queries[1]).toContain('> __since');
  });

  it('uses a lookback window when the watermark is the meeting date', async () => {
    const map: MarsColumnMap = { table: 'T', columns: { account: 'Account', contactName: 'Contact Name', meetingDate: 'Meeting Date' } };
    const pbi = mockPowerBi(map, () => [{ Account: 'Northwind Energy', 'Contact Name': 'Jane Doe', 'Meeting Date': '2026-10-20' }]);
    const src = powerBiMarsSource({ ...cfg(), columns: map }, { fetch: pbi.fetch, sleep: async () => undefined, now: () => NOW });
    const p = await src.listEntries({ cursor: encodePbiCursor('w', new Date('2026-10-25T00:00:00Z')), updatedSince: null, limit: 10, accountKeys: ['northwind energy'] });
    expect(pbi.calls.queries[0]).toContain('DATETIME(2026, 10, 11, 0, 0, 0)');
    expect(pbi.calls.queries[0]).toContain("'T'[Meeting Date] >= __since");
    const e = MarsEntry.parse(p.items[0]);
    expect(e.id).toMatch(/^mt-h[0-9a-f]{24}$/);
    expect(e.loggedBy.email).toBeNull();
    // Content hashed version, stable for the same content.
    const p2 = await src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: ['Northwind Energy'] });
    expect((p2.items[0] as { version: number }).version).toBe(e.version);
    // The watermark never moves back after a lookback read.
    expect(decodePbiCursor(p.nextCursor)!.at.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('keeps the page under the value cap for the mapped columns', async () => {
    const { pbi, src } = make(TABLE, { pageRows: 100_000 });
    await src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS });
    const n = Number(/TOPN\(\n\s+(\d+),/.exec(pbi.calls.queries[0]!)![1]);
    expect(n).toBe(Math.floor(Math.floor(PBI_MAX_VALUES / 10) / 2));
  });

  it('halves the page on a row cap result and retries the same window', async () => {
    const { pbi, src } = make(TABLE, { pageRows: 400 });
    pbi.steps.push({ capError: true });
    const p = await src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS });
    expect(p.items).toHaveLength(3);
    const sizes = pbi.calls.queries.map((q) => Number(/TOPN\(\n\s+(\d+),/.exec(q)![1]));
    expect(sizes).toEqual([400, 200]);
  });

  it('waits out a short 429, gives a long one back to the queue', async () => {
    const short = make();
    short.pbi.steps.push({ status: 429, retryAfter: '2' });
    const p = await short.src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS });
    expect(p.items).toHaveLength(3);
    expect(short.sleeps).toContain(2000);

    const long = make();
    long.pbi.steps.push({ status: 429, retryAfter: '120' });
    await expect(long.src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS })).rejects.toBeInstanceOf(MarsRateLimitedError);
  });

  it('retries 5xx with backoff, refreshes the token once on 401, caches it otherwise', async () => {
    const m = make();
    m.pbi.steps.push({ status: 503 }, { status: 401 });
    await m.src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS });
    expect(m.sleeps).toContain(1000);
    expect(m.pbi.calls.token).toBe(2);
    await m.src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS });
    expect(m.pbi.calls.token).toBe(2);

    const dead = make();
    dead.pbi.steps.push({ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    await expect(dead.src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS })).rejects.toBeInstanceOf(MarsHttpError);
  });

  it('reports DAX errors by code and never leaks the secret', async () => {
    const m = make();
    m.pbi.steps.push({ status: 400, body: { error: { code: 'DatasetExecuteQueriesError', message: "Column 'Acount' not found" } } });
    const err = await m.src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(PowerBiQueryError);
    expect(String((err as Error).message)).toContain("Column 'Acount' not found");
    expect(String((err as Error).message)).not.toContain(SECRET);
    expect(JSON.stringify(m.pbi.calls.bodies)).not.toContain(SECRET);
  });

  it('sends impersonatedUserName only when configured (RLS datasets)', async () => {
    const m = make(TABLE, { impersonatedUserName: 'mars-reader@contoso.example' });
    await m.src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: KEYS });
    expect(m.pbi.calls.bodies[0]).toMatchObject({ impersonatedUserName: 'mars-reader@contoso.example' });
  });
});

describe('marsSourceFromEnv', () => {
  const pbiEnv = { MARS_PBI_TENANT_ID: TENANT, MARS_PBI_CLIENT_ID: 'id', MARS_PBI_CLIENT_SECRET: SECRET, MARS_PBI_WORKSPACE_ID: WS, MARS_PBI_DATASET_ID: DS };
  it('prefers Power BI, falls back to the REST API, never throws on bad config', () => {
    expect(marsSourceFromEnv({}).configured).toBe(false);
    expect(marsSourceFromEnv(pbiEnv).kind).toBe('powerbi');
    expect(marsSourceFromEnv({ ...pbiEnv, MARS_SOURCE: 'api' }).configured).toBe(false);
    expect(marsSourceFromEnv({ MARS_BASE_URL: 'https://mars.example', MARS_API_KEY: 'k' }).kind).toBe('api');
    expect(marsSourceFromEnv({ ...pbiEnv, MARS_SOURCE: 'file_export' }).configured).toBe(false);
    expect(marsSourceFromEnv({ ...pbiEnv, MARS_PBI_COLUMNS: '{"table":"T"}' }).configured).toBe(false);
    expect(marsSourceFromEnv({ ...pbiEnv, MARS_PBI_COLUMNS: JSON.stringify(MAP) }).kind).toBe('powerbi');
  });
});
