import { describe, expect, it } from 'vitest';

import type { IntelClient } from '../http.js';
import { gleifSearchUrl, leiNameMatches, matchLei, type LeiRecord } from './gleif.js';

const rec = (lei: string, legalName: string, country: string, status = 'ACTIVE') => ({
  type: 'lei-records',
  id: lei,
  attributes: { lei, entity: { legalName: { name: legalName }, legalAddress: { country }, status, registeredAs: null } },
});

function client(pages: Record<string, unknown[]>): IntelClient {
  return {
    get: async (url: string) => JSON.stringify({ data: pages[url] ?? [] }),
  } as unknown as IntelClient;
}

describe('GLEIF matching', () => {
  it('reads a wide page so the parent entity is not buried by subsidiaries', () => {
    expect(gleifSearchUrl('DNB Bank', null)).toContain('page%5Bsize%5D=50');
  });

  it('matches across legal forms and skips inactive or duplicate records', () => {
    const records: LeiRecord[] = [
      { lei: 'A', legalName: 'ARITZIA INC.', country: 'CA', registeredAs: null, registeredAt: null, status: 'ACTIVE' },
      { lei: 'A', legalName: 'ARITZIA INC.', country: 'CA', registeredAs: null, registeredAt: null, status: 'ACTIVE' },
      { lei: 'B', legalName: 'ARITZIA LP', country: 'CA', registeredAs: null, registeredAt: null, status: 'ACTIVE' },
      { lei: 'C', legalName: 'Aritzia Ltd', country: 'CA', registeredAs: null, registeredAt: null, status: 'INACTIVE' },
    ];
    expect(leiNameMatches(records, 'Aritzia', null).map((r) => r.lei)).toEqual(['A']);
  });

  it('falls back to the legal-name filter when full text finds nothing', async () => {
    const c = client({
      [gleifSearchUrl('Logistec Corporation', null)]: [rec('X', 'Logistec Marine', 'CA')],
      [gleifSearchUrl('Logistec Corporation', null, 'entity.legalName')]: [rec('L', 'LOGISTEC CORPORATION', 'CA')],
    });
    const found = await matchLei(c, 'Logistec Corporation', null);
    expect(found.record?.lei).toBe('L');
  });

  it('returns every candidate instead of guessing when several entities share the name', async () => {
    const c = client({
      [gleifSearchUrl('MAHLE', null)]: [],
      [gleifSearchUrl('MAHLE', null, 'entity.legalName')]: [rec('G', 'MAHLE GmbH', 'DE'), rec('S', 'MAHLE SA', 'FR')],
    });
    const found = await matchLei(c, 'MAHLE', null);
    expect(found.record).toBeNull();
    expect(found.matches.map((m) => m.lei)).toEqual(['G', 'S']);
  });

  it('finds a parent listed under its registered name variants (MAPFRE S.A.)', async () => {
    const c = client({
      [gleifSearchUrl('MAPFRE', null, 'entity.names')]: [rec('M', 'MAPFRE S.A.', 'ES'), rec('C', 'CLUB MAPFRE S.A.', 'ES')],
    });
    expect((await matchLei(c, 'MAPFRE', null)).record?.lei).toBe('M');
  });

  it('lets the account country settle an ambiguous name', async () => {
    const c = client({
      [gleifSearchUrl('MAHLE', 'DE')]: [],
      [gleifSearchUrl('MAHLE', 'DE', 'entity.legalName')]: [rec('G', 'MAHLE GmbH', 'DE'), rec('S', 'MAHLE SA', 'FR')],
    });
    expect((await matchLei(c, 'MAHLE', 'DE')).record?.lei).toBe('G');
  });
});
