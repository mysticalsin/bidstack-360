// Unit tests for the deterministic duplicate-clustering contract.
//
// These encode the merge-safety rules: matching is exact-after-normalization
// (never fuzzy), blanks never key rows together, and overlapping match paths
// collapse into ONE review set so a record can never be merged twice.

import { describe, expect, it } from 'vitest';

import {
  clusterCompanies,
  clusterContacts,
  normalizeDomain,
} from './duplicates.helpers.js';

describe('normalizeDomain', () => {
  it('reduces URLs and bare domains to the same comparable host', () => {
    // WHY: importers fill `domain` with "acme.com" and `website` with a full
    // URL — if these keyed differently, the most common duplicate shape
    // (CSV import next to a manually-created account) would never be caught.
    expect(normalizeDomain('https://www.Acme.com/contact?x=1')).toBe('acme.com');
    expect(normalizeDomain('acme.com')).toBe('acme.com');
    expect(normalizeDomain('WWW.ACME.COM')).toBe('acme.com');
  });

  it('returns null for blank-ish input so empties can never match each other', () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain('https://')).toBeNull();
  });
});

describe('clusterCompanies', () => {
  it('clusters punctuation/case variants of one account name', () => {
    // WHY: "Acme Consulting" hand-entered next to "ACME consulting!" from a
    // CSV import is the bread-and-butter duplicate. Normalized-name equality
    // must catch it without any fuzzy matching.
    const clusters = clusterCompanies([
      { id: 'a', name: 'Acme Consulting', domain: null, website: null },
      { id: 'b', name: 'ACME consulting!', domain: null, website: null },
      { id: 'c', name: 'Globex Industrial', domain: null, website: null },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.ids).toEqual(['a', 'b']);
    expect(clusters[0]!.reasons).toEqual(['name']);
  });

  it('clusters differently-named companies sharing a domain (domain vs website)', () => {
    const clusters = clusterCompanies([
      { id: 'a', name: 'Acme', domain: 'acme.com', website: null },
      { id: 'b', name: 'Acme France SARL', domain: null, website: 'https://www.acme.com' },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.ids).toEqual(['a', 'b']);
    expect(clusters[0]!.reasons).toEqual(['domain']);
  });

  it('merges overlapping name and domain matches into ONE transitive cluster', () => {
    // WHY: if A~B (name) and B~C (domain) surfaced as two separate pairs, a
    // user could merge B into A, then merge the already-gone B into C — one
    // review set per connected component prevents double-merging.
    const clusters = clusterCompanies([
      { id: 'a', name: 'Acme Consulting', domain: null, website: null },
      { id: 'b', name: 'ACME Consulting', domain: 'acme.com', website: null },
      { id: 'c', name: 'Acme Group Holdings', domain: 'acme.com', website: null },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.ids).toEqual(['a', 'b', 'c']);
    expect(clusters[0]!.reasons).toEqual(['domain', 'name']);
  });

  it('never clusters rows on missing domains', () => {
    // WHY: two companies that both lack a domain share "nothing", not
    // "the same nothing" — an empty-key match would flag half the org.
    const clusters = clusterCompanies([
      { id: 'a', name: 'Acme', domain: null, website: '' },
      { id: 'b', name: 'Globex', domain: null, website: null },
    ]);
    expect(clusters).toHaveLength(0);
  });
});

describe('clusterContacts', () => {
  it('clusters contacts sharing an email, case-insensitively', () => {
    const clusters = clusterContacts([
      { id: 'a', name: 'Jean Dupont', email: 'J.Dupont@edf.fr ', customer: 'EDF' },
      { id: 'b', name: 'J. Dupont', email: 'j.dupont@edf.fr', customer: 'EDF Group' },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.ids).toEqual(['a', 'b']);
    expect(clusters[0]!.reasons).toEqual(['email']);
  });

  it('never clusters two contacts that both lack an email', () => {
    const clusters = clusterContacts([
      { id: 'a', name: 'Ana Ruiz', email: null, customer: 'Iberdrola' },
      { id: 'b', name: 'Marc Petit', email: '', customer: 'TotalEnergies' },
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('clusters same normalized name ONLY at the same account', () => {
    // WHY: bid decision units routinely contain namesakes across clients —
    // "Jean Dupont" at EDF and "Jean Dupont" at Orange are two people. The
    // name key must be scoped by the normalized account tag.
    const clusters = clusterContacts([
      { id: 'a', name: 'Jean Dupont', email: null, customer: 'EDF' },
      { id: 'b', name: 'jean DUPONT!', email: null, customer: 'edf' },
      { id: 'c', name: 'Jean Dupont', email: null, customer: 'Orange' },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.ids).toEqual(['a', 'b']);
    expect(clusters[0]!.reasons).toEqual(['name-account']);
  });
});
