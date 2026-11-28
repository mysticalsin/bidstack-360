/**
 * Sample headquarters for demo accounts whose fixture firmographics have no
 * offices. A stored location wins. A live or mixed provenance stays empty.
 */
import { z } from 'zod';

import { EnrichmentLocation, FieldProvenance } from '../schemas/account-enrichment.js';

type Location = z.infer<typeof EnrichmentLocation>;
type Provenance = z.infer<typeof FieldProvenance>;

export interface HostedLocationInput {
  companyName: string;
  locations: unknown;
  provenance: unknown;
  fetchedAt: string;
}

export interface HostedLocationResult {
  locations: Location[];
  provenancePatch: { locations: Provenance } | null;
}

const HQ: Record<string, { city: string; country: string }> = {
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

function sampleHeadquarters(name: string): Location | null {
  const row = HQ[name];
  if (!row) return null;
  return { city: row.city, state: null, country: row.country, kind: 'hq' };
}

function storedLocations(value: unknown): Location[] {
  const parsed = z.array(EnrichmentLocation).safeParse(value);
  if (!parsed.success) return [];
  const usable = parsed.data.some(
    (loc) => (loc.city ?? '').trim() !== '' || (loc.country ?? '').trim() !== '',
  );
  return usable ? parsed.data : [];
}

/** True when every recorded source is the fixture seed. An empty or mixed row is not. */
function fixtureOnly(provenance: unknown): boolean {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return false;
  const sources: string[] = [];
  for (const value of Object.values(provenance)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const source = (value as { source?: unknown }).source;
    if (typeof source !== 'string') continue;
    sources.push(source);
  }
  return sources.length > 0 && sources.every((source) => source === 'fixture');
}

/**
 * Headquarters for one firmographics row.
 * A stored office is kept. Otherwise a fixture-only row for a known demo
 * account gets one sample HQ, labelled fixture. Live and unknown rows stay empty.
 */
export function hostedFirmographicLocations(input: HostedLocationInput): HostedLocationResult {
  const stored = storedLocations(input.locations);
  if (stored.length > 0 || !fixtureOnly(input.provenance)) {
    return { locations: stored, provenancePatch: null };
  }
  const hq = sampleHeadquarters(input.companyName);
  if (!hq) return { locations: [], provenancePatch: null };
  const patch = FieldProvenance.parse({ source: 'fixture', fetchedAt: input.fetchedAt });
  return { locations: [hq], provenancePatch: { locations: patch } };
}
