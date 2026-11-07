import { beforeAll, describe, expect, it } from 'vitest';

import { fetchBulkUnit, loadLicitacionesCsv, parseErroneousPoList, planBulkMonth } from './cl/bulk.js';
import { amountMicros, chileDate, redactPersonalRaw } from './cl/common.js';
import { mercadoPublicoAdapter } from './cl/mercadopublico-api.js';
import { OCDS_AWARD_SOURCE_KEY, ocdsAdapter } from './cl/ocds-api.js';
import { iterateCsvRecords, parseCsvText } from './csv.js';
import { PsSourceError } from './errors.js';
import { CHILE_TIME_ZONE, InMemoryQuotaStore, createQuotaGuard } from './quota.js';
import { findPersonalData } from './scrub.js';
import {
  FIXED_NOW,
  TEST_TAX_ID_HASHER,
  allRecords,
  cannedFetch,
  fixtureBytes,
  fixtureText,
  forbidNetwork,
} from './test-helpers.test-helpers.js';
import { zonedDateKey, zonedTimeToUtc } from './time.js';
import type { PsFetchUnit, PsNormalized } from './types.js';

beforeAll(forbidNetwork);

const NORM = { hashTaxId: TEST_TAX_ID_HASHER };
const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const SYNTHETIC_PERSON_RUT = '12.345.678-5';
const SYNTHETIC_PERSON_NAME = 'JUANA PRUEBA SINTETICA';

/** Spec 6.3: a natural-person supplier keeps only its display name; the RUT is hashed. Nothing else may carry either. */
function expectNoPersonalData(n: PsNormalized): void {
  const records = allRecords(n).map((r) =>
    r.kind === 'supplier' && (r as { isNaturalPerson?: boolean }).isNaturalPerson
      ? { ...r, name: null, normalizedName: null }
      : r,
  );
  const text = JSON.stringify(records, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  expect(text).not.toContain(SYNTHETIC_PERSON_RUT);
  expect(text).not.toContain('12345678-5');
  expect(text).not.toContain(SYNTHETIC_PERSON_NAME);
  expect(findPersonalData(text).filter((f) => f.kind === 'rut')).toEqual([]);
}

describe('Santiago time across DST changes', () => {
  it('a date on the spring-forward day stays on that day', () => {
    for (const day of ['2025-09-07', '2026-09-06']) {
      const d = chileDate(day)!;
      expect(zonedDateKey(d, CHILE_TIME_ZONE)).toBe(day);
      expect(d.getTime()).toBeGreaterThan(chileDate(`${day.slice(0, 8)}${String(Number(day.slice(8)) - 1).padStart(2, '0')} 23:59`)!.getTime());
    }
  });

  it('a wall time on the fall-back day picks the first of the two instants', () => {
    const d = zonedTimeToUtc({ year: 2026, month: 4, day: 4, hour: 23, minute: 30 }, CHILE_TIME_ZONE);
    expect(d.toISOString()).toBe('2026-04-05T02:30:00.000Z');
    expect(zonedDateKey(chileDate('2026-04-05')!, CHILE_TIME_ZONE)).toBe('2026-04-05');
  });

  it('keeps seconds', () => {
    expect(chileDate('2025-07-28T15:00:42')!.toISOString()).toBe('2025-07-28T19:00:42.000Z');
  });
});

describe('amountMicros never throws and never goes through floating point', () => {
  it.each([
    ['007', 7_000_000n],
    ['00', 0n],
    ['0', 0n],
    ['24247,26', 24_247_260_000n],
    ['9,3e+07', 93_000_000_000_000n],
    ['1,5e+22', 15_000_000_000_000_000_000_000_000_000n],
    ['1.234.567', 1_234_567_000_000n],
    ['-12,5', -12_500_000n],
    ['0,1234567', 123_457n],
    [1e21, 1_000_000_000_000_000_000_000_000_000n],
  ] as const)('%s', (input, micros) => {
    expect(amountMicros(input)).toBe(micros);
  });

  it.each(['abc', '1,2,3', '1.2,3', 'e5', '', 'NA'])('returns null for %j', (input) => {
    expect(amountMicros(input)).toBeNull();
  });
});

describe('CSV robustness', () => {
  it('throws on an unterminated quote at end of input', () => {
    expect(() => parseCsvText('a;b\n1;"never closed')).toThrow(PsSourceError);
  });

  it('strips a BOM, trims header names and keeps duplicate columns apart', async () => {
    const rows: Record<string, string>[] = [];
    for await (const r of iterateCsvRecords([enc('\u00EF\u00BB\u00BF A ;B;B\r\n1;2;3\r\n')])) rows.push(r);
    expect(rows).toEqual([{ A: '1', B: '2', 'B#2': '3' }]);
  });

  it('fails with a schema error when a required bulk column is missing', async () => {
    const ctx = { ...NORM, retrievedAt: FIXED_NOW, apiUrl: 'https://transparenciachc.blob.core.windows.net/lic-da/2025-7.zip' };
    await expect(loadLicitacionesCsv([enc('Codigo;Nombre\n1;x\n')], ctx)).rejects.toMatchObject({ kind: 'schema' });
    expect(() => parseErroneousPoList(enc('idoc;otra\n1;2\n'))).toThrow(PsSourceError);
  });
});

describe('natural-person data never leaves a normalizer in clear', () => {
  it('redacts the RUT and the names next to it, and sweeps the same name elsewhere', () => {
    const out = redactPersonalRaw(
      {
        parties: [{ id: 'CL-MP-1', name: SYNTHETIC_PERSON_NAME, identifier: { scheme: 'CL-RUT', id: SYNTHETIC_PERSON_RUT } }],
        awards: [{ suppliers: [{ id: 'CL-MP-1', name: SYNTHETIC_PERSON_NAME }] }],
        buyer: { name: 'MUNICIPALIDAD SINTETICA', identifier: { id: '61.000.001-0' } },
      },
      TEST_TAX_ID_HASHER,
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain(SYNTHETIC_PERSON_RUT);
    expect(text).not.toContain(SYNTHETIC_PERSON_NAME);
    expect(text).toContain('rut-hash:');
    expect(text).toContain('MUNICIPALIDAD SINTETICA');
    expect(text).toContain('61.000.001-0');
  });

  it('API tender awarded to a natural person: no RUT or name in any record', async () => {
    const body = fixtureText('mp-api-licitaciones-dia.synthetic.json')
      .replace('76.000.002-7', SYNTHETIC_PERSON_RUT)
      .replace('PROVEEDORA SINTETICA SPA', SYNTHETIC_PERSON_NAME);
    const unit = mercadoPublicoAdapter.plan({ from: FIXED_NOW, to: FIXED_NOW }, null)[0]!;
    const quota = createQuotaGuard({ store: new InMemoryQuotaStore(), credentialId: 't', now: () => FIXED_NOW });
    const raw = await mercadoPublicoAdapter.fetch(unit, { fetch: cannedFetch(body), secret: 'SYNTHETIC', quota, now: () => FIXED_NOW });
    const n = mercadoPublicoAdapter.normalize(raw, NORM);
    expect(n.offers.length).toBeGreaterThan(0);
    expectNoPersonalData(n);
  });

  it('bulk tender rows from a natural person: no RUT or name in any record', async () => {
    const text = new TextDecoder('latin1').decode(fixtureBytes('lic-da-2025-7.head.csv'));
    const lines = text.split('\r\n');
    const header = parseCsvText(lines[0]!)[0]!;
    const row = new Array<string>(header.length).fill('');
    const set = (k: string, v: string) => {
      row[header.indexOf(k)] = v;
    };
    set('CodigoExterno', '9001-99-LE25');
    set('Nombre', 'Servicio sintetico');
    set('CodigoEstado', '5');
    set('Estado', 'Publicada');
    set('CodigoUnidad', '9001');
    set('Codigoitem', '1');
    set('RutProveedor', SYNTHETIC_PERSON_RUT);
    set('NombreProveedor', SYNTHETIC_PERSON_NAME);
    set('RazonSocialProveedor', SYNTHETIC_PERSON_NAME);
    set('Valor Total Ofertado', '1000');
    const csv = `${lines[0]}\r\n${row.map((v) => `"${v}"`).join(';')}\r\n`;
    const n = await loadLicitacionesCsv([enc(csv)], {
      ...NORM,
      retrievedAt: FIXED_NOW,
      apiUrl: 'https://transparenciachc.blob.core.windows.net/lic-da/2025-7.zip',
    });
    expect(n.offers).toHaveLength(1);
    expect(n.opportunities[0]!.title).toBe('Servicio sintetico');
    expectNoPersonalData(n);
  });
});

describe('OCDS: one idempotency key, one projection', () => {
  const unit = (kind: 'tender' | 'award'): PsFetchUnit => ({
    sourceKey: 'cl.mp.ocds',
    kind: `ocds.${kind}`,
    url: `https://api.mercadopublico.cl/APISOCDS/OCDS/${kind}/3951-19-LE25`,
  });
  const normalize = async (kind: 'tender' | 'award', file: string) =>
    ocdsAdapter.normalize(
      await ocdsAdapter.fetch(unit(kind), { fetch: cannedFetch(fixtureText(file)), now: () => FIXED_NOW }),
      NORM,
    );

  it('tender and award releases of one process never share a key', async () => {
    const t = await normalize('tender', 'ocds-tender-3951-19-LE25.json');
    const a = await normalize('award', 'ocds-award-3951-19-LE25.json');
    expect(a.opportunities[0]!.sourceKey).toBe(OCDS_AWARD_SOURCE_KEY);
    const tenderKeys = new Set(allRecords(t).map((r) => r.idempotencyKey));
    for (const r of allRecords(a)) expect(tenderKeys.has(r.idempotencyKey)).toBe(false);
  });

  it('an award shared by several suppliers does not repeat the full amount per supplier', async () => {
    const pkg = JSON.parse(fixtureText('ocds-award-2741-120-TD25.json')) as {
      releases: { parties: { id: string; roles: string[]; identifier?: { scheme: string; id: string } }[]; awards: { suppliers: { id: string; name: string }[] }[] }[];
    };
    const rel = pkg.releases[0]!;
    rel.parties.push({ id: 'CL-MP-SECOND', roles: ['supplier'], identifier: { scheme: 'CL-RUT', id: '76.000.002-7' } });
    rel.awards[0]!.suppliers.push({ id: 'CL-MP-SECOND', name: 'PROVEEDORA SINTETICA SPA' });
    const u: PsFetchUnit = { ...unit('award'), url: 'https://api.mercadopublico.cl/APISOCDS/OCDS/award/2741-120-TD25' };
    const n = ocdsAdapter.normalize(
      await ocdsAdapter.fetch(u, { fetch: cannedFetch(JSON.stringify(pkg)), now: () => FIXED_NOW }),
      NORM,
    );
    expect(n.offers).toHaveLength(2);
    for (const o of n.offers) expect(o.awardedAmountMicros).toBeNull();
  });
});

describe('OCDS paging and planning', () => {
  const listUnit: PsFetchUnit = {
    sourceKey: 'cl.mp.ocds',
    kind: 'ocds.list',
    url: 'https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/2025/07/0/5',
  };
  const page = (offset: number, rows: number) =>
    JSON.stringify({
      pagination: { total: 100, offset, limit: 5 },
      data: Array.from({ length: rows }, (_, i) => ({ ocid: `ocds-70d2nz-${i}` })),
    });
  const raw = async (body: string, url = listUnit.url) =>
    ocdsAdapter.fetch({ ...listUnit, url }, { fetch: cannedFetch(body), now: () => FIXED_NOW });

  it('advances from its own cursor even if the server echoes offset 0', async () => {
    const r = await raw(page(0, 5), 'https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/2025/07/10/5');
    expect(ocdsAdapter.nextCursor(r, null)).toMatchObject({ offset: 15, limit: 5 });
  });

  it('stops on an empty or short page', async () => {
    expect(ocdsAdapter.nextCursor(await raw(page(0, 0)), null)).toBeNull();
    expect(ocdsAdapter.nextCursor(await raw(page(0, 3)), null)).toBeNull();
  });

  it('plans months in Santiago time, not UTC', () => {
    const units = ocdsAdapter.plan(
      { from: new Date('2025-07-01T02:00:00Z'), to: new Date('2025-07-01T02:00:00Z') },
      null,
    );
    expect(units.map((u) => u.url)).toEqual([
      'https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/2025/06/0/100',
    ]);
  });
});

describe('fail-closed guards', () => {
  const apiUnit = mercadoPublicoAdapter.plan({ from: FIXED_NOW, to: FIXED_NOW }, null)[0]!;

  it('the ticketed API refuses to fetch without a quota guard', async () => {
    const fetch = cannedFetch('{}');
    await expect(
      mercadoPublicoAdapter.fetch(apiUnit, { fetch, secret: 'SYNTHETIC', now: () => FIXED_NOW }),
    ).rejects.toMatchObject({ kind: 'quota_exhausted', doNotRetry: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('HTTP 203 is an auth error whatever the body says', async () => {
    const quota = createQuotaGuard({ store: new InMemoryQuotaStore(), credentialId: 't', now: () => FIXED_NOW });
    await expect(
      mercadoPublicoAdapter.fetch(apiUnit, {
        fetch: cannedFetch('{"Mensaje":"otro"}', 203),
        secret: 'SYNTHETIC',
        quota,
        now: () => FIXED_NOW,
      }),
    ).rejects.toMatchObject({ kind: 'auth', doNotRetry: true });
  });

  it('bulk downloads refuse outside the quiet window', async () => {
    const quiet = new Date('2026-11-07T03:00:00Z');
    const [unit] = planBulkMonth({ year: 2025, month: 7, now: quiet });
    const fetch = cannedFetch('x');
    await expect(fetchBulkUnit(unit!, { fetch, now: () => FIXED_NOW })).rejects.toMatchObject({
      kind: 'outside_quiet_hours',
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(fetchBulkUnit(unit!, { fetch, now: () => quiet })).resolves.toMatchObject({ httpStatus: 200 });
  });
});
