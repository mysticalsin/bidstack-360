import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { httpMarsClient, type FetchLike } from './client.js';
import { powerBiMarsSource, type PbiFetch } from './powerbi.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const json = (name: string) => JSON.parse(readFileSync(join(FIX, name), 'utf8')) as unknown;

describe('MARS REST HTTP contract (recorded fixtures, no network)', () => {
  it('exchanges a client-credentials token and maps meeting-entries', async () => {
    const calls: string[] = [];
    const impl: FetchLike = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes('/token')) {
        expect(init.headers['content-type']).toContain('application/x-www-form-urlencoded');
        expect(init.body).toContain('grant_type=client_credentials');
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => json('mars-token.json') };
      }
      if (url.includes('/v1/meeting-entries')) {
        expect(init.headers.authorization).toBe('Bearer mars-fixture-token');
        expect(init.headers.accept).toBe('application/json');
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => json('mars-meeting-entries.json') };
      }
      throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    };
    const client = httpMarsClient(
      {
        baseUrl: 'https://mars.example',
        auth: { kind: 'oauth', tokenUrl: 'https://auth.mars.example/token', clientId: 'cid', clientSecret: 'test-secret' },
      },
      impl,
    );
    const page = await client.listEntries({ cursor: null, updatedSince: new Date('2026-10-01T00:00:00Z'), limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'mt-E1' });
    expect(page.nextCursor).toBe('c1');
    expect(page.hasMore).toBe(false);
    expect(calls).toEqual([
      'POST https://auth.mars.example/token',
      'GET https://mars.example/v1/meeting-entries?limit=50&updatedSince=2026-10-01T00%3A00%3A00.000Z',
    ]);
  });
});

describe('MARS Power BI HTTP contract (recorded fixtures, no network)', () => {
  it('authenticates at Entra and maps executeQueries rows to meeting entries', async () => {
    const calls: string[] = [];
    const fetchImpl: PbiFetch = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes('/oauth2/v2.0/token')) {
        expect(init.body).toContain('grant_type=client_credentials');
        expect(init.body).toContain('scope=https%3A%2F%2Fanalysis.windows.net%2Fpowerbi%2Fapi%2F.default');
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify(json('powerbi-token.json')),
        };
      }
      if (url.includes('/executeQueries')) {
        expect(init.headers.authorization).toBe('Bearer pbi-fixture-token');
        const body = JSON.parse(init.body ?? '{}') as { queries: Array<{ query: string }> };
        expect(body.queries[0]!.query).toContain('IN { "Northwind Energy" }');
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify(json('powerbi-execute-queries.json')),
        };
      }
      throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    };
    const src = powerBiMarsSource(
      {
        tenantId: '11111111-2222-3333-4444-555555555555',
        clientId: 'client-id',
        clientSecret: 'pbi-test-secret-value-do-not-log',
        workspaceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        datasetId: 'ffffffff-0000-1111-2222-333333333333',
        columns: {
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
        },
        minIntervalMs: 0,
      },
      { fetch: fetchImpl, sleep: async () => undefined, now: () => new Date('2026-10-31T15:00:00Z') },
    );
    const page = await src.listEntries({
      cursor: null,
      updatedSince: null,
      limit: 50,
      accountKeys: ['Northwind Energy'],
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'mt-mt-E1',
      client: { marsAccountId: 'Northwind Energy', name: 'Northwind Energy plc' },
    });
    expect(calls[0]).toMatch(/login\.microsoftonline\.com\/11111111-2222-3333-4444-555555555555\/oauth2\/v2\.0\/token/);
    expect(calls[1]).toMatch(/api\.powerbi\.com\/v1\.0\/myorg\/groups\/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\/datasets\/ffffffff-0000-1111-2222-333333333333\/executeQueries/);
  });
});
