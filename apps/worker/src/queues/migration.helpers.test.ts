// Unit tests for the migration import worker's pure transforms.
// These encode WHY the import is correct (money stays in micros, source-CRM
// stage labels collapse to canonical stages, blank cells never overwrite) —
// the DB-touching writers are covered by the API undo integration test.

import { describe, expect, it } from 'vitest';

import { applyMappings, asInt, asMicros, mapStage, normalizeEntity } from './migration.js';

describe('migration value coercion', () => {
  it('parses currency units into micros (money is stored ×1e6)', () => {
    // €1,200,000.50 must become 1_200_000_500_000 micros, not 1_200_000.5.
    expect(asMicros('1,200,000.50')).toBe(1_200_000_500_000n);
    expect(asMicros('€2 500')).toBe(2_500_000_000n);
    expect(asMicros('0')).toBe(0n);
  });

  it('returns null for blank/garbage money so writers can skip the field', () => {
    expect(asMicros('')).toBeNull();
    expect(asMicros('   ')).toBeNull();
    expect(asMicros(null)).toBeNull();
    expect(asMicros('n/a')).toBeNull();
  });

  it('strips separators from integers', () => {
    expect(asInt('1,234')).toBe(1234);
    expect(asInt('42')).toBe(42);
    expect(asInt('')).toBeNull();
  });
});

describe('mapStage', () => {
  it('passes canonical stages through unchanged', () => {
    expect(mapStage('closed_won')).toBe('closed_won');
    expect(mapStage('s4_negotiation')).toBe('s4_negotiation');
  });

  it('collapses loose source-CRM labels to canonical stages', () => {
    expect(mapStage('Closed Won')).toBe('closed_won');
    expect(mapStage('Negotiation/Review')).toBe('s4_negotiation');
    expect(mapStage('Proposal Sent')).toBe('s2_sent');
    expect(mapStage('Technical Evaluation')).toBe('s3_technical_iteration');
  });

  it('defaults unknown/blank stages to s1_lead (never crashes the import)', () => {
    expect(mapStage('Whatever')).toBe('s1_lead');
    expect(mapStage('')).toBe('s1_lead');
    expect(mapStage(null)).toBe('s1_lead');
  });
});

describe('normalizeEntity', () => {
  it('aliases provider plurals and synonyms to internal entity types', () => {
    expect(normalizeEntity('Accounts')).toBe('company');
    expect(normalizeEntity('deals')).toBe('opportunity');
    expect(normalizeEntity('CONTACTS')).toBe('contact');
  });

  it('returns null for unsupported entities so the job fails loudly', () => {
    expect(normalizeEntity('tasks')).toBeNull();
    expect(normalizeEntity('')).toBeNull();
  });
});

describe('applyMappings', () => {
  it('maps source columns to target fields and drops unmapped/blank cells', () => {
    const row = { 'Account Name': 'Acme', Website: 'acme.com', Ignore: 'x', Blank: '  ' };
    const mappings = {
      'Account Name': 'company.name',
      Website: 'company.website',
      Ignore: null, // explicitly skipped
      Blank: 'company.domain',
    };
    expect(applyMappings(row, mappings)).toEqual({
      'company.name': 'Acme',
      'company.website': 'acme.com',
      // Blank cell never lands a key — so it can't overwrite existing data on update.
    });
  });
});
