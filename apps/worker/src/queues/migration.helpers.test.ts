// Unit tests for the migration import worker's pure transforms.
// These encode WHY the import is correct (money stays in micros, source-CRM
// stage labels collapse to canonical stages, blank cells never overwrite) —
// the DB-touching writers are covered by the API undo integration test.

import { describe, expect, it } from 'vitest';

import {
  applyMappings,
  asDate,
  asInt,
  asMicros,
  asTrimmed,
  mapStage,
  normalizeEntity,
  readOpportunityValue,
  formatNextOpportunityCode,
  splitLeadName,
} from './migration.js';

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

  it('keeps European decimals, accounting losses, and cents past the float boundary', () => {
    // WHY: stripping every comma turns "1.234,56" into 1.23456 and "(1,234.50)"
    // into a profit. Number()*1e6 also rounds a trillion-and-a-cent. The
    // stored micros have to be the amount the cell wrote.
    expect(asMicros('1.234,56')).toBe(1_234_560_000n);
    expect(asMicros('1,50')).toBe(1_500_000n);
    expect(asMicros('(1,234.50)')).toBe(-1_234_500_000n);
    expect(asMicros('1000000000000.01')).toBe(1_000_000_000_000_010_000n);
    expect(asMicros("'-1.50")).toBe(-1_500_000n);
  });

  it('rejects a deal amount the create route would refuse, and leaves a blank cell unset', () => {
    // WHY: "n/a" used to become €0, which looks like a real zero-value deal.
    // A credit and a figure past the write cap are row errors, not stored amounts.
    expect(readOpportunityValue('')).toBeUndefined();
    expect(readOpportunityValue('1.234,56')).toBe(1_234_560_000n);
    expect(() => readOpportunityValue('n/a')).toThrow('opportunity value is not a number');
    expect(() => readOpportunityValue('-1.50')).toThrow('opportunity value cannot be negative');
    expect(() => readOpportunityValue('1000000000000.01')).toThrow('opportunity value exceeds 1e12');
  });

  it('strips separators from integers', () => {
    expect(asInt('1,234')).toBe(1234);
    expect(asInt('42')).toBe(42);
    expect(asInt('')).toBeNull();
  });

  it('reads the probability the opportunity export writes, and drops a spreadsheet apostrophe', () => {
    // WHY: the export cell is "50%". Number("50%") is NaN, so a re-import
    // stored probability 0. A phone exported as '+33…' must come back as +33.
    expect(asInt('50%')).toBe(50);
    expect(asTrimmed("'+33 1 23 45 67 89")).toBe('+33 1 23 45 67 89');
    expect(asTrimmed("'=Acme")).toBe('=Acme');
    expect(asTrimmed("O'Brien")).toBe("O'Brien");
  });

  it('splits the single Name column the leads export writes', () => {
    expect(splitLeadName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(splitLeadName('Ada').lastName).toBe('');
  });
});

describe('asDate', () => {
  it('keeps the calendar day written in the cell, including an offset that crosses UTC midnight', () => {
    // WHY: new Date('2026-03-15T00:00:00+05:00') is 14 March in UTC, and a
    // @db.Date column then stores the 14th. Close dates and period ends are
    // the day in the file.
    expect(asDate('2026-03-15')?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(asDate('2026-03-15T00:00:00+05:00')?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(asDate('03/15/2026')?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(asDate('2026-02-31')).toBeNull();
    expect(asDate('')).toBeNull();
  });
});

describe('formatNextOpportunityCode', () => {
  it('ignores a non-numeric OP- code such as OP-H10', () => {
    // WHY: lexicographic DESC ranks OP-H10 above OP-2048. Number("H10") is
    // NaN, and the importer stored OP-0NaN, then failed every later row on
    // the unique (org, code) key. The error file hid the Prisma text.
    expect(formatNextOpportunityCode(2048)).toBe('OP-2049');
    expect(formatNextOpportunityCode(10000)).toBe('OP-10001');
    expect(formatNextOpportunityCode(null)).toBe('OP-2001');
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
    expect(normalizeEntity('financials')).toBe('financial');
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
