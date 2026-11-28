import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EnrichmentLocation } from '../schemas/account-enrichment.js';
import { hostedFirmographicLocations } from './hosted-location.js';

const FETCHED = '2026-11-26T12:00:00.000Z';

const FIXTURE_PROVENANCE = {
  annualRevenueUsd: { source: 'fixture', fetchedAt: FETCHED },
  employeeCount: { source: 'fixture', fetchedAt: FETCHED },
  industry: { source: 'fixture', fetchedAt: FETCHED },
};

function namesIn(file: string, start: string, end: string): string[] {
  const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
  const block = source.slice(source.indexOf(start), source.indexOf(end));
  return [...block.matchAll(/name: '([^']+)'/g)].map((match) => match[1]!);
}

describe('hosted company headquarters', () => {
  it('gives every demo account one sample headquarters when the fixture row has none', () => {
    // WHY: seed company intel writes revenue, headcount and industry, and leaves
    // locations as []. The account strip then says the headquarters is not known,
    // including for accounts whose city is already on the business snapshot.
    const fixture = namesIn(
      '../../../db/src/seed-data.ts',
      'export const fixtureCompanies',
      'export interface FixtureContact',
    );
    const visitor = namesIn('../../../db/src/seed-org-data.ts', 'const COMPANIES', 'type OppStage');
    expect(fixture).toEqual([
      'CI Financial',
      'Logistec Corporation',
      'Rush University System for Health',
      'MAPFRE',
      'MAHLE',
      'Aritzia',
      'NOS',
      'DNB Bank',
      'Mantu',
      'Northwind Pharma',
    ]);
    expect(visitor).toEqual(['Siemens', 'IKEA', 'Sanofi', 'HSBC', 'Stellantis', 'Spotify', 'Northwind Pharma']);

    const expected: Record<string, { city: string; country: string }> = {
      'CI Financial': { city: 'Toronto', country: 'Canada' },
      'Logistec Corporation': { city: 'Montreal', country: 'Canada' },
      'Rush University System for Health': { city: 'Chicago', country: 'United States' },
      MAPFRE: { city: 'Madrid', country: 'Spain' },
      MAHLE: { city: 'Stuttgart', country: 'Germany' },
      Aritzia: { city: 'Vancouver', country: 'Canada' },
      NOS: { city: 'Lisbon', country: 'Portugal' },
      'DNB Bank': { city: 'Oslo', country: 'Norway' },
      Mantu: { city: 'Paris', country: 'France' },
      'Northwind Pharma': { city: 'Lyon', country: 'France' },
      Siemens: { city: 'Munich', country: 'Germany' },
      IKEA: { city: 'Älmhult', country: 'Sweden' },
      Sanofi: { city: 'Paris', country: 'France' },
      HSBC: { city: 'London', country: 'United Kingdom' },
      Stellantis: { city: 'Hoofddorp', country: 'Netherlands' },
      Spotify: { city: 'Stockholm', country: 'Sweden' },
    };

    for (const name of [...fixture, ...visitor]) {
      const hosted = hostedFirmographicLocations({
        companyName: name,
        locations: [],
        provenance: FIXTURE_PROVENANCE,
        fetchedAt: FETCHED,
      });
      expect(hosted.locations, name).toEqual([
        { city: expected[name]!.city, state: null, country: expected[name]!.country, kind: 'hq' },
      ]);
      expect(EnrichmentLocation.safeParse(hosted.locations[0]).success, name).toBe(true);
      expect(hosted.provenancePatch, name).toEqual({
        locations: { source: 'fixture', fetchedAt: FETCHED },
      });
    }
  });

  it('keeps a stored location, and does not invent one for a live or unknown row', () => {
    // WHY: a real enrichment that found no offices must stay empty. A city already
    // stored, including one a person corrected, must not be replaced by the sample.
    const stored = [{ city: 'Bergen', state: null, country: 'Norway', kind: 'subsidiary' as const }];
    expect(
      hostedFirmographicLocations({
        companyName: 'DNB Bank',
        locations: stored,
        provenance: FIXTURE_PROVENANCE,
        fetchedAt: FETCHED,
      }).locations,
    ).toEqual(stored);
    expect(
      hostedFirmographicLocations({
        companyName: 'DNB Bank',
        locations: stored,
        provenance: FIXTURE_PROVENANCE,
        fetchedAt: FETCHED,
      }).provenancePatch,
    ).toBeNull();

    const apollo = { employeeCount: { source: 'apollo', fetchedAt: FETCHED } };
    const mixed = {
      employeeCount: { source: 'fixture', fetchedAt: FETCHED },
      industry: { source: 'apollo', fetchedAt: FETCHED },
    };
    for (const provenance of [{}, apollo, mixed]) {
      const hosted = hostedFirmographicLocations({
        companyName: 'Siemens',
        locations: [],
        provenance,
        fetchedAt: FETCHED,
      });
      expect(hosted.locations).toEqual([]);
      expect(hosted.provenancePatch).toBeNull();
    }

    const unknown = hostedFirmographicLocations({
      companyName: 'Acme North',
      locations: [],
      provenance: FIXTURE_PROVENANCE,
      fetchedAt: FETCHED,
    });
    expect(unknown.locations).toEqual([]);
    expect(unknown.provenancePatch).toBeNull();
  });

  it('is applied on the enrichment read and written by the fixture seed after intel', () => {
    // WHY: the strip reads the enrichment payload. A headquarters written only
    // in a later seed, or after the summary rebuild, never reaches that payload.
    // The seed runs after company intel so the firmographics row already exists.
    const route = readFileSync(
      path.resolve(import.meta.dirname, '../../../../apps/api/src/routes/account-enrichment.ts'),
      'utf8',
    );
    const read = route.indexOf('hostedFirmographicLocations(');
    const returned = route.indexOf('return {', read);
    expect(read).toBeGreaterThan(0);
    expect(route.slice(read, returned)).toContain('companyName');

    const seed = readFileSync(path.resolve(import.meta.dirname, '../../../db/src/seed.ts'), 'utf8');
    const intel = seed.indexOf('await seedCompanyIntel(');
    const locations = seed.indexOf('await seedCompanyLocations(');
    expect(intel).toBeGreaterThan(0);
    expect(locations).toBeGreaterThan(intel);
  });
});
