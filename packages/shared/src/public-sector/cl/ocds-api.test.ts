import { beforeAll, describe, expect, it } from 'vitest';

import {
  FIXED_NOW,
  TEST_TAX_ID_HASHER,
  allRecords,
  cannedFetch,
  expectTraceable,
  fixtureText,
  forbidNetwork,
} from '../test-helpers.test-helpers.js';
import type { PsFetchUnit, PsRawPage } from '../types.js';
import { ocdsAdapter, ocdsListUrl, ocdsRecordUnits } from './ocds-api.js';

beforeAll(forbidNetwork);

const NORM = { hashTaxId: TEST_TAX_ID_HASHER };

async function rawFrom(body: string, unit: PsFetchUnit, now = FIXED_NOW): Promise<PsRawPage> {
  return ocdsAdapter.fetch(unit, { fetch: cannedFetch(body), now: () => now });
}

const recordUnit = (kind: 'tender' | 'award', code: string): PsFetchUnit => ({
  sourceKey: 'cl.mp.ocds',
  kind: `ocds.${kind}`,
  url: `https://api.mercadopublico.cl/APISOCDS/OCDS/${kind}/${code}`,
});

const julyUnit = () =>
  ocdsAdapter.plan(
    { from: new Date('2025-07-01T00:00:00Z'), to: new Date('2025-07-01T00:00:00Z') },
    null,
  )[0]!;

describe('OCDS API adapter: contract and paging', () => {
  it('needs no ticket and carries the CC0 licence', () => {
    expect(ocdsAdapter.sourceKey).toBe('cl.mp.ocds');
    expect(ocdsAdapter.credentialName).toBeNull();
    expect(ocdsAdapter.licence).toBe('CC0-1.0');
  });

  it('builds offset and limit list URLs per month', () => {
    expect(ocdsListUrl({ year: 2025, month: 7, offset: 0, limit: 100 })).toBe(
      'https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/2025/07/0/100',
    );
    expect(
      ocdsListUrl({ year: 2025, month: 7, offset: 200, limit: 100, variant: 'TratoDirecto' }),
    ).toBe('https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMesTratoDirecto/2025/07/200/100');
  });

  it('plans one list unit per month in the window', () => {
    const units = ocdsAdapter.plan(
      { from: new Date('2025-06-15T00:00:00Z'), to: new Date('2025-07-02T00:00:00Z') },
      null,
    );
    expect(units.map((u) => u.url)).toEqual([
      'https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/2025/06/0/100',
      'https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/2025/07/0/100',
    ]);
  });

  it('pages with offset until pagination.total is reached (real list response)', async () => {
    // The recorded page was requested with limit 5 against a total of 10,328.
    const first = { ...julyUnit(), url: ocdsListUrl({ year: 2025, month: 7, offset: 0, limit: 5 }) };
    const raw = await rawFrom(fixtureText('ocds-list-2025-07.json'), first);
    expect(ocdsAdapter.nextCursor(raw, null)).toEqual({ year: 2025, month: 7, offset: 5, limit: 5 });
    const lastUnit = { ...first, url: ocdsListUrl({ year: 2025, month: 7, offset: 10325, limit: 5 }) };
    expect(ocdsAdapter.nextCursor(await rawFrom(fixtureText('ocds-list-2025-07.json'), lastUnit), null)).toBeNull();
  });

  it('expands a list page into tender and award record units over https', async () => {
    const units = ocdsRecordUnits(await rawFrom(fixtureText('ocds-list-2025-07.json'), julyUnit()));
    expect(units).toHaveLength(10);
    expect(units[0]).toMatchObject({
      kind: 'ocds.tender',
      url: 'https://api.mercadopublico.cl/APISOCDS/OCDS/tender/692240-2-CO25',
    });
    for (const u of units) expect(u.url.startsWith('https://api.mercadopublico.cl/')).toBe(true);
  });
});

describe('OCDS API adapter: normalize (real recorded records)', () => {
  it('maps a published tender to an active opportunity with traceability', async () => {
    const unit = recordUnit('tender', '3951-19-LE25');
    const n = ocdsAdapter.normalize(await rawFrom(fixtureText('ocds-tender-3951-19-LE25.json'), unit), NORM);
    expect(n.opportunities).toHaveLength(1);
    const opp = n.opportunities[0]!;
    expect(opp).toMatchObject({
      externalId: '3951-19-LE25',
      ocid: 'ocds-70d2nz-3951-19-LE25',
      stage: 'active',
      buyerExternalId: '4871',
      currencyCode: 'CLP',
      unspscCodes: ['80111701'],
      isDirectAward: false,
      sourceUrl: 'https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=3951-19-LE25',
      licence: 'CC0-1.0',
    });
    expect(opp.estimatedValueMicros).toBe(22_622_500_000_000n);
    expect(opp.closesAt?.toISOString()).toBe('2025-07-28T15:00:00.000Z');
    expect(n.entities[0]).toMatchObject({ externalId: '4871', taxId: '61.974.700-3' });
    for (const rec of allRecords(n)) expectTraceable(rec);
  });

  it('maps a revoked award release to the cancelled stage', async () => {
    const unit = recordUnit('award', '3951-19-LE25');
    const n = ocdsAdapter.normalize(await rawFrom(fixtureText('ocds-award-3951-19-LE25.json'), unit), NORM);
    expect(n.opportunities[0]).toMatchObject({ externalId: '3951-19-LE25', stage: 'cancelled' });
    expect(n.offers).toEqual([]);
  });

  it('flags a direct award for review with neutral copy (real Trato Directo record)', async () => {
    const unit = recordUnit('award', '2741-120-TD25');
    const n = ocdsAdapter.normalize(await rawFrom(fixtureText('ocds-award-2741-120-TD25.json'), unit), NORM);
    expect(n.opportunities[0]).toMatchObject({
      isDirectAward: true,
      stage: 'awarded',
      procurementMethod: 'direct',
    });
    expect(n.suppliers[0]).toMatchObject({
      externalId: 'rut:87.606.700-5',
      taxId: '87.606.700-5',
      isNaturalPerson: false,
    });
    expect(n.offers[0]).toMatchObject({
      selected: true,
      opportunityExternalId: '2741-120-TD25',
      supplierExternalId: 'rut:87.606.700-5',
    });
    expect(n.offers[0]!.awardedAmountMicros).toBe(1_953_545_000_000n);
    expect(n.reviewFlags).toEqual([
      expect.objectContaining({
        kind: 'direct_award',
        targetKind: 'opportunity',
        targetExternalId: '2741-120-TD25',
        label: 'Needs review: direct award',
      }),
    ]);
    for (const rec of allRecords(n)) expectTraceable(rec);
  });
});

describe('OCDS API adapter: idempotency (spec 3.4, 8b.2)', () => {
  const unit = recordUnit('tender', '3951-19-LE25');
  const body = fixtureText('ocds-tender-3951-19-LE25.json');

  it('replaying identical bytes keeps payload and record hashes', async () => {
    const a = await rawFrom(body, unit);
    const b = await rawFrom(body, unit, new Date('2026-11-07T08:00:00Z'));
    expect(b.rawPayloadHash).toBe(a.rawPayloadHash);
    const na = ocdsAdapter.normalize(a, NORM);
    const nb = ocdsAdapter.normalize(b, NORM);
    expect(nb.opportunities[0]!.idempotencyKey).toBe(na.opportunities[0]!.idempotencyKey);
    expect(nb.opportunities[0]!.recordHash).toBe(na.opportunities[0]!.recordHash);
  });

  it('a changed amount changes that record hash only', async () => {
    const a = ocdsAdapter.normalize(await rawFrom(body, unit), NORM);
    const changedRaw = await rawFrom(body.replaceAll('"amount": 22622500,', '"amount": 22622501,'), unit);
    const c = ocdsAdapter.normalize(changedRaw, NORM);
    expect(c.opportunities[0]!.idempotencyKey).toBe(a.opportunities[0]!.idempotencyKey);
    expect(c.opportunities[0]!.recordHash).not.toBe(a.opportunities[0]!.recordHash);
    expect(c.entities[0]!.recordHash).toBe(a.entities[0]!.recordHash);
  });

  it('reordered JSON keys or envelope-only changes keep record hashes', async () => {
    const a = await rawFrom(body, unit);
    const pkg = JSON.parse(body) as Record<string, unknown>;
    const reordered = JSON.stringify(
      { ...Object.fromEntries(Object.entries(pkg).reverse()), publishedDate: '2030-01-01T00:00:00Z' },
      null,
      1,
    );
    const b = await rawFrom(reordered, unit);
    expect(b.rawPayloadHash).not.toBe(a.rawPayloadHash);
    const na = ocdsAdapter.normalize(a, NORM);
    const nb = ocdsAdapter.normalize(b, NORM);
    for (const kind of ['opportunities', 'entities'] as const) {
      expect(nb[kind].map((r) => r.recordHash)).toEqual(na[kind].map((r) => r.recordHash));
    }
  });
});
