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

  it('names fixture notes as reference records and keeps those rows sample', () => {
    // A seller reading the note title must not be told the workspace is a demo.
    // The evidence flag stays sample so the row is never treated as live.
    const DEMO_COPY = /sample|demo|sandbox|illustrative|not live/i;
    const titles = PARTNER_FIXTURES.flatMap((f) => f.notes.map((n) => n.title));
    expect(titles).toEqual([
      'Reference: MAPFRE IT steering debrief',
      'Reference: DNB procurement feedback',
      'Reference: MAHLE test bench review',
    ]);
    for (const f of PARTNER_FIXTURES) {
      for (const n of f.notes) {
        const drafts = readInternalRecord(
          { source: 'note', recordType: 'note', recordId: 'n', title: n.title, text: n.body, occurredAt: NOW, sample: true },
          DEFAULT_CONSULTING_FIRMS,
        );
        expect(drafts.length).toBeGreaterThan(0);
        for (const d of drafts) {
          expect(d.sample).toBe(true);
          expect(d.title).toBe(n.title);
          expect(`${d.title ?? ''} ${d.excerpt}`).not.toMatch(DEMO_COPY);
        }
      }
      for (const d of partnerFixtureDrafts(f, NOW)) expect(d.sample).toBe(true);
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
