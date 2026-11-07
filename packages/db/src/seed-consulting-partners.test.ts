import { describe, expect, it } from 'vitest';

import { DEFAULT_CONSULTING_FIRMS, readInternalRecord } from '@bidstack/shared';

import { PARTNER_FIXTURES, partnerFixtureDrafts } from './seed-consulting-partners.js';

const NOW = new Date('2026-11-06T12:00:00Z');
const byAccount = (name: string) => PARTNER_FIXTURES.find((f) => f.account === name)!;

describe('consulting partner demo fixtures', () => {
  it('give each demo account its partners, marked as fixtures', () => {
    const rel = (name: string) => partnerFixtureDrafts(byAccount(name), NOW).map((d) => [d.firmKey, d.relationship]);
    expect(rel('MAPFRE')).toEqual(expect.arrayContaining([['kpmg', 'advisory'], ['accenture', 'managed_services']]));
    expect(rel('DNB Bank')).toEqual(expect.arrayContaining([['ey', 'audit'], ['sopra-steria', 'implementation']]));
    expect(rel('MAHLE')).toEqual([['akkodis', 'engineering']]);
    for (const f of PARTNER_FIXTURES) {
      for (const d of partnerFixtureDrafts(f, NOW)) expect(d).toMatchObject({ source: 'fixture', method: 'fixture', sample: true, origin: 'public' });
    }
  });

  it('ship notes whose remarks the keyword reader scores against the partner', () => {
    const remarks = (name: string, firm: string) =>
      byAccount(name).notes.flatMap((n) => readInternalRecord({ source: 'note', recordType: 'note', recordId: 'n', title: n.title, text: n.body, occurredAt: NOW }, DEFAULT_CONSULTING_FIRMS))
        .filter((d) => d.firmKey === firm)
        .flatMap((d) => d.remarks.map((r) => `${r.dimension}:${r.favours}`));
    expect(remarks('MAPFRE', 'accenture')).toEqual(expect.arrayContaining(['quality:us', 'speed:us']));
    expect(remarks('DNB Bank', 'sopra-steria')).toEqual(expect.arrayContaining(['price:partner', 'quality:us']));
    expect(remarks('MAHLE', 'akkodis')).toEqual(expect.arrayContaining(['speed:us']));
  });
});
