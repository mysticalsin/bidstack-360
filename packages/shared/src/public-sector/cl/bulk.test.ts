import { beforeAll, describe, expect, it } from 'vitest';

import { PsSourceError } from '../errors.js';
import {
  FIXED_NOW,
  TEST_TAX_ID_HASHER,
  allRecords,
  expectTraceable,
  fixtureBytes,
  forbidNetwork,
} from '../test-helpers.test-helpers.js';
import {
  bulkFileUrl,
  loadLicitacionesCsv,
  loadOrdenesCompraCsv,
  parseErroneousPoList,
  planBulkMonth,
  sumPurchaseOrderAmounts,
} from './bulk.js';

beforeAll(forbidNetwork);

const CTX = {
  hashTaxId: TEST_TAX_ID_HASHER,
  retrievedAt: FIXED_NOW,
  apiUrl: 'https://transparenciachc.blob.core.windows.net/lic-da/2025-7.zip',
};

/** Feed the fixture in small chunks, like a streamed 287 MB file. */
function* chunked(bytes: Uint8Array, size = 4096): Generator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

describe('bulk file plan', () => {
  it('builds the official container URLs', () => {
    expect(bulkFileUrl('lic', 2025, 7)).toBe(
      'https://transparenciachc.blob.core.windows.net/lic-da/2025-7.zip',
    );
    expect(bulkFileUrl('oc', 2025, 12)).toBe(
      'https://transparenciachc.blob.core.windows.net/oc-da/2025-12.zip',
    );
    expect(bulkFileUrl('erroneous-po')).toBe(
      'https://transparenciachc.blob.core.windows.net/oc-da/hist_OC_erroneas.csv',
    );
  });

  it('only plans bulk work inside the Chile quiet window', () => {
    expect(() => planBulkMonth({ year: 2025, month: 7, now: new Date('2026-11-06T19:00:00Z') })).toThrow(
      PsSourceError,
    );
    const units = planBulkMonth({ year: 2025, month: 7, now: new Date('2026-11-07T02:00:00Z') });
    expect(units.map((u) => u.kind)).toEqual(['bulk.lic', 'bulk.oc', 'bulk.erroneous-po']);
  });
});

describe('tender bulk file with offers received (real lic-da 2025-7 head)', () => {
  it('decodes Latin-1 and maps codes to stages', async () => {
    const n = await loadLicitacionesCsv(chunked(fixtureBytes('lic-da-2025-7.head.csv')), CTX);
    const opp = n.opportunities.find((o) => o.externalId === '5184-102-LP24');
    expect(opp?.title).toBe('EXÁMENES OFTALMOLÓGICOS PACIENTES GES');
    expect(opp).toMatchObject({ stage: 'cancelled', statusCode: 7 });
    const stages = new Map(n.opportunities.map((o) => [o.statusCode, o.stage]));
    expect(stages.get(8)).toBe('awarded');
    expect(stages.get(15)).toBe('cancelled');
  });

  it('keeps one offer per row, selected flags included', async () => {
    const n = await loadLicitacionesCsv(chunked(fixtureBytes('lic-da-2025-7.head.csv')), CTX);
    expect(n.offers).toHaveLength(200);
    expect(n.offers.filter((o) => o.selected)).toHaveLength(25);
    const keys = new Set(n.offers.map((o) => o.idempotencyKey));
    expect(keys.size).toBe(200);
  });

  it('hashes natural-person tax ids and never stores them in clear', async () => {
    const n = await loadLicitacionesCsv(chunked(fixtureBytes('lic-da-2025-7.head.csv')), CTX);
    const people = n.suppliers.filter((s) => s.isNaturalPerson);
    expect(people.length).toBeGreaterThan(0);
    for (const p of people) {
      expect(p.taxId).toBeNull();
      expect(p.taxIdHash).toMatch(/^[a-f0-9]{64}$/);
      expect(p.externalId).toBe(`rut-hash:${p.taxIdHash}`);
    }
  });

  it('flags single-bidder tenders with neutral copy', async () => {
    const n = await loadLicitacionesCsv(chunked(fixtureBytes('lic-da-2025-7.head.csv')), CTX);
    const single = n.reviewFlags.filter((f) => f.kind === 'single_bidder');
    expect(single.length).toBeGreaterThan(0);
    expect(single[0]!.label).toBe('Single bidder');
    for (const rec of allRecords(n)) expectTraceable(rec);
  });
});

describe('purchase orders and the erroneous list (real oc-da 2025-7 head)', () => {
  const erroneous = () =>
    parseErroneousPoList(fixtureBytes('hist_OC_erroneas.head.csv'));

  it('parses the erroneous PO list', () => {
    const list = erroneous();
    expect(list.get('3630-198-TD25')).toBeDefined();
    expect(list.get('2039378')).toBeUndefined();
  });

  it('keeps erroneous POs, flagged, and excludes them from official totals only', async () => {
    const n = await loadOrdenesCompraCsv(chunked(fixtureBytes('oc-da-2025-7.head.csv')), {
      ...CTX,
      erroneous: erroneous(),
    });
    const flagged = n.purchaseOrders.filter((p) => p.excludedFromOfficial);
    expect(flagged.map((p) => p.externalId).sort()).toEqual([
      '2177-68-SE25',
      '3630-198-TD25',
      '3833-520-SE25',
      '4707-257-SE25',
    ]);
    for (const p of flagged) expect(p.exclusionReason).toBe('listed_in_hist_OC_erroneas');

    const raw = sumPurchaseOrderAmounts(n.purchaseOrders, 'raw');
    const official = sumPurchaseOrderAmounts(n.purchaseOrders, 'official');
    const flaggedClp = flagged
      .filter((p) => p.currencyCode === 'CLP')
      .reduce((acc, p) => acc + (p.amountMicros ?? 0n), 0n);
    expect(raw.get('CLP')! - official.get('CLP')!).toBe(flaggedClp);
    for (const rec of allRecords(n)) expectTraceable(rec);
  });

  it('groups line items into one PO and flags Trato Directo for review', async () => {
    const n = await loadOrdenesCompraCsv(chunked(fixtureBytes('oc-da-2025-7.head.csv')), {
      ...CTX,
      erroneous: erroneous(),
    });
    const ids = n.purchaseOrders.map((p) => p.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    const direct = n.purchaseOrders.filter((p) => p.isDirectAward);
    expect(direct.length).toBeGreaterThan(0);
    const flags = n.reviewFlags.filter((f) => f.kind === 'direct_award');
    expect(flags.map((f) => f.targetExternalId).sort()).toEqual(direct.map((p) => p.externalId).sort());
    expect(n.purchaseOrders.every((p) => p.stage !== 'paid')).toBe(true);
  });

  it('takes the supplier RUT from RutSucursal, the only supplier RUT column in oc-da', async () => {
    const n = await loadOrdenesCompraCsv(chunked(fixtureBytes('oc-da-2025-7.head.csv')), {
      ...CTX,
      erroneous: erroneous(),
    });
    expect(n.suppliers.length).toBeGreaterThan(0);
    const companies = n.suppliers.filter((s) => !s.isNaturalPerson);
    expect(companies.length).toBeGreaterThan(0);
    for (const s of companies) expect(s.externalId).toBe(`rut:${s.taxId}`);
    expect(companies.map((s) => s.taxId)).toContain('85.825.700-K');
  });
});
