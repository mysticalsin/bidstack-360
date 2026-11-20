import { beforeAll, describe, expect, it } from 'vitest';

import { PsSourceError } from '../errors.js';
import { InMemoryQuotaStore, createQuotaGuard } from '../quota.js';
import {
  FIXED_NOW,
  TEST_TAX_ID_HASHER,
  allRecords,
  cannedFetch,
  expectTraceable,
  fixtureText,
  forbidNetwork,
} from '../test-helpers.test-helpers.js';
import {
  MERCADOPUBLICO_TICKET_ENV,
  mercadoPublicoAdapter,
  parseMercadoPublicoBody,
  readTicketFromEnv,
} from './mercadopublico-api.js';

beforeAll(forbidNetwork);

const SECRET = 'SYNTHETIC-TICKET-0000';
const ctx = (fetch: ReturnType<typeof cannedFetch>) => ({
  fetch,
  secret: SECRET,
  now: () => FIXED_NOW,
  quota: createQuotaGuard({ store: new InMemoryQuotaStore(), credentialId: 'test', now: () => FIXED_NOW }),
});

describe('Mercado Publico API adapter: contract', () => {
  it('declares its credential by NAME only', () => {
    expect(MERCADOPUBLICO_TICKET_ENV).toBe('MERCADOPUBLICO_API_TICKET');
    expect(mercadoPublicoAdapter.credentialName).toBe('MERCADOPUBLICO_API_TICKET');
    expect(mercadoPublicoAdapter.sourceKey).toBe('cl.mp.api');
    expect(mercadoPublicoAdapter.country).toBe('CL');
    expect(mercadoPublicoAdapter.budget.perDay).toBe(8_000);
  });

  it('reads the ticket from the env by name and treats blank as missing', () => {
    expect(readTicketFromEnv({ MERCADOPUBLICO_API_TICKET: 'abc' })).toBe('abc');
    expect(readTicketFromEnv({ MERCADOPUBLICO_API_TICKET: '  ' })).toBeNull();
    expect(readTicketFromEnv({})).toBeNull();
  });

  it('plans one tender and one purchase-order unit per day, with no credential in the URL', () => {
    const units = mercadoPublicoAdapter.plan(
      { from: new Date('2025-07-03T12:00:00Z'), to: new Date('2025-07-04T12:00:00Z') },
      null,
    );
    expect(units.map((u) => u.url)).toEqual([
      'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?fecha=03072025',
      'https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json?fecha=03072025&estado=todos',
      'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?fecha=04072025',
      'https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json?fecha=04072025&estado=todos',
    ]);
    expect(mercadoPublicoAdapter.nextCursor).toBeTypeOf('function');
  });
});

describe('Mercado Publico API adapter: auth errors', () => {
  const unit = mercadoPublicoAdapter.plan(
    { from: new Date('2025-07-03T12:00:00Z'), to: new Date('2025-07-03T12:00:00Z') },
    null,
  )[0]!;

  it('treats the real HTTP 203 "Codigo 203" reply as an auth error, never retried', async () => {
    const fetch = cannedFetch(fixtureText('mp-api-ticket-invalid.json'), 203);
    const err = await mercadoPublicoAdapter.fetch(unit, ctx(fetch)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PsSourceError);
    expect(err).toMatchObject({ kind: 'auth', doNotRetry: true });
    expect(JSON.stringify(err)).not.toContain(SECRET);
    expect((err as Error).message).not.toContain(SECRET);
  });

  it('also catches Codigo 203 when it arrives with HTTP 200', async () => {
    const fetch = cannedFetch('{"Codigo":203,"Mensaje":"Ticket no v\u00e1lido."}', 200);
    await expect(mercadoPublicoAdapter.fetch(unit, ctx(fetch))).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('the body parser rejects {"Codigo":203} as an invalid ticket', () => {
    expect(() => parseMercadoPublicoBody({ Codigo: 203, Mensaje: 'Ticket no v\u00e1lido.' })).toThrow(
      PsSourceError,
    );
  });

  it('refuses to call out without a ticket', async () => {
    const fetch = cannedFetch('{}');
    await expect(
      mercadoPublicoAdapter.fetch(unit, { fetch, now: () => FIXED_NOW }),
    ).rejects.toMatchObject({ kind: 'auth', doNotRetry: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the quota before every call and stops at the ceiling', async () => {
    const quota = createQuotaGuard({
      store: new InMemoryQuotaStore(),
      credentialId: 'cfg-1',
      dailyLimit: 10,
      safetyMargin: 0.2,
      now: () => FIXED_NOW,
    });
    const fetch = cannedFetch(fixtureText('mp-api-licitaciones-dia.synthetic.json'));
    for (let i = 0; i < 8; i += 1) await mercadoPublicoAdapter.fetch(unit, { ...ctx(fetch), quota });
    await expect(
      mercadoPublicoAdapter.fetch(unit, { ...ctx(fetch), quota }),
    ).rejects.toMatchObject({ kind: 'quota_exhausted' });
    expect(fetch).toHaveBeenCalledTimes(8);
  });
});

describe('Mercado Publico API adapter: fetch and normalize (synthetic fixtures)', () => {
  it('sends the ticket but stores only the redacted request URL', async () => {
    const fetch = cannedFetch(fixtureText('mp-api-licitaciones-dia.synthetic.json'));
    const unit = mercadoPublicoAdapter.plan(
      { from: new Date('2025-07-03T12:00:00Z'), to: new Date('2025-07-03T12:00:00Z') },
      null,
    )[0]!;
    const raw = await mercadoPublicoAdapter.fetch(unit, ctx(fetch));
    expect(String(fetch.mock.calls[0]![0])).toContain(`ticket=${SECRET}`);
    expect(raw.requestUrlRedacted).not.toContain(SECRET);
    expect(raw.requestUrlRedacted).toContain('ticket=REDACTED');
    expect(raw.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(raw)).not.toContain(SECRET);
  });

  it('maps tenders to opportunities with stages and keeps buyer officials out', async () => {
    const fetch = cannedFetch(fixtureText('mp-api-licitaciones-dia.synthetic.json'));
    const [unit] = mercadoPublicoAdapter.plan(
      { from: new Date('2025-07-03T12:00:00Z'), to: new Date('2025-07-03T12:00:00Z') },
      null,
    );
    const raw = await mercadoPublicoAdapter.fetch(unit!, ctx(fetch));
    const n = mercadoPublicoAdapter.normalize(raw, { hashTaxId: TEST_TAX_ID_HASHER });

    const byCode = new Map(n.opportunities.map((o) => [o.externalId, o]));
    expect(byCode.get('9001-11-LE25')).toMatchObject({ stage: 'active', statusCode: 5 });
    expect(byCode.get('9001-12-LP25')).toMatchObject({ stage: 'awarded', statusCode: 8 });
    expect(byCode.get('9001-13-LE25')).toMatchObject({ stage: 'cancelled', statusCode: 18 });
    expect(byCode.get('9001-12-LP25')?.estimatedValueMicros).toBe(150_000_000_000_000n);
    expect(byCode.get('9001-12-LP25')?.sourceUrl).toBe(
      'https://www.mercadopublico.cl/fichaLicitacion.html?idLicitacion=9001-12-LP25',
    );

    expect(n.entities).toHaveLength(1);
    expect(n.entities[0]).toMatchObject({
      externalId: '9001',
      organismCode: '900',
      taxId: '61.000.001-0',
    });
    const awarded = n.offers.filter((o) => o.selected);
    expect(awarded).toHaveLength(1);
    expect(awarded[0]).toMatchObject({ supplierExternalId: 'rut:76.000.002-7' });

    // Raw keeps the full payload (restricted store); structured fields never
    // carry the names of public officials (spec 6.3).
    const structured = JSON.stringify(n, (k, v: unknown) =>
      k === 'raw' ? undefined : typeof v === 'bigint' ? v.toString() : v,
    );
    expect(structured).not.toContain('FUNCIONARIA SINTETICA');
    for (const rec of allRecords(n)) expectTraceable(rec);
    for (const rec of allRecords(n)) expect(rec.licence).toBe('ChileCompra-API-terms');
  });

  it('maps purchase orders to the ordered stage and flags direct awards neutrally', async () => {
    const fetch = cannedFetch(fixtureText('mp-api-ordenesdecompra-dia.synthetic.json'));
    const units = mercadoPublicoAdapter.plan(
      { from: new Date('2025-07-03T12:00:00Z'), to: new Date('2025-07-03T12:00:00Z') },
      null,
    );
    const raw = await mercadoPublicoAdapter.fetch(units[1]!, ctx(fetch));
    const n = mercadoPublicoAdapter.normalize(raw, { hashTaxId: TEST_TAX_ID_HASHER });
    const byCode = new Map(n.purchaseOrders.map((p) => [p.externalId, p]));
    expect(byCode.get('9001-501-SE25')).toMatchObject({ stage: 'ordered', statusCode: 6 });
    expect(byCode.get('9001-502-TD25')).toMatchObject({ isDirectAward: true, stage: 'ordered' });
    expect(byCode.get('9001-503-SE25')).toMatchObject({ stage: 'cancelled', statusCode: 9 });
    expect(n.reviewFlags).toEqual([
      expect.objectContaining({
        kind: 'direct_award',
        targetKind: 'purchase_order',
        targetExternalId: '9001-502-TD25',
        label: 'Needs review: direct award',
      }),
    ]);
    for (const rec of allRecords(n)) expectTraceable(rec);
  });
});
