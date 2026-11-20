import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pullEdgar, pullEsef, type FinFetch } from './sources.js';
import { buildPeriods } from './xbrl.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const json = (name: string) => JSON.parse(readFileSync(join(FIX, name), 'utf8')) as unknown;

describe('financial statement HTTP contract (recorded fixtures, no network)', () => {
  it('pulls EDGAR companyfacts with the SEC User-Agent and maps FY revenue', async () => {
    const calls: string[] = [];
    const fetchImpl: FinFetch = async (url, init) => {
      calls.push(url);
      expect(init?.headers?.['User-Agent']).toMatch(/@/);
      if (url === 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001829948.json') {
        return { ok: true, status: 200, json: async () => json('edgar-companyfacts.json') };
      }
      throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    };
    const entity = await pullEdgar('1829948', {
      fetchImpl,
      userAgent: 'PoloFinancials/1.0 (finance@polo.example)',
      pace: async () => undefined,
    });
    expect(entity).toMatchObject({ source: 'sec_edgar', entityId: '0001829948', entityName: 'CI Financial Corp.' });
    const fy = buildPeriods(entity.facts, { quarters: true });
    expect(fy[0]).toMatchObject({ periodEnd: '2021-12-31', currency: 'CAD' });
    expect(fy[0]!.metrics.revenue?.value).toBe(2600);
    expect(calls).toEqual(['https://data.sec.gov/api/xbrl/companyfacts/CIK0001829948.json']);
  });

  it('pulls ESEF entity, filings list and report JSON from recorded fixtures', async () => {
    const calls: string[] = [];
    const fetchImpl: FinFetch = async (url) => {
      calls.push(url);
      if (url === 'https://filings.xbrl.org/api/entities/5493004DM8FGIY6QKF37') {
        return { ok: true, status: 200, json: async () => json('esef-entity.json') };
      }
      if (url.startsWith('https://filings.xbrl.org/api/entities/5493004DM8FGIY6QKF37/filings')) {
        return { ok: true, status: 200, json: async () => json('esef-filings.json') };
      }
      if (url === 'https://filings.xbrl.org/api/filings/report-2025.json') {
        return { ok: true, status: 200, json: async () => json('esef-report.json') };
      }
      throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    };
    const entity = await pullEsef('5493004DM8FGIY6QKF37', {
      fetchImpl,
      userAgent: 'PoloFinancials/1.0 (finance@polo.example)',
      pace: async () => undefined,
    });
    expect(entity).toMatchObject({ source: 'esef', entityName: 'NOS, SGPS, S.A.' });
    const fy = buildPeriods(entity.facts, { quarters: false });
    expect(fy[0]!.metrics.revenue?.value).toBe(1_823_000_000);
    expect(calls).toEqual([
      'https://filings.xbrl.org/api/entities/5493004DM8FGIY6QKF37',
      'https://filings.xbrl.org/api/entities/5493004DM8FGIY6QKF37/filings?sort=-period_end&page%5Bsize%5D=12',
      'https://filings.xbrl.org/api/filings/report-2025.json',
    ]);
  });
});
