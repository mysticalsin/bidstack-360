import { describe, expect, it } from 'vitest';

import { extractContractFields } from './contract-extract-fields.js';

const SAMPLE_MSA = `
MASTER SERVICES AGREEMENT
Reference: MSA-2026-001
Countries: FR, DE, ES
Currency: EUR
This agreement grants a global rebate of 7.5% on all services.
Effective date: 2026-01-01
Expiry date: 2028-12-31
Rate review: annual

Rate card
Senior Consultant     800 / day
Solution Architect:   €1,100 per day
Project Manager       95 /hour
`;

describe('extractContractFields', () => {
  it('detects the kind, reference, countries, currency, rebate and dates', () => {
    const d = extractContractFields(SAMPLE_MSA);
    expect(d.kind).toBe('msa');
    expect(d.reference).toBe('MSA-2026-001');
    expect(d.countries).toEqual(expect.arrayContaining(['FR', 'DE', 'ES']));
    expect(d.currency).toBe('EUR');
    expect(d.globalRebateBps).toBe(750); // 7.5% -> 750 bps
    expect(d.rateReviewSchedule).toBe('annual');
    expect(d.effectiveDate).toContain('2026-01-01');
    expect(d.expiryDate).toContain('2028-12-31');
  });

  it('parses rate-card lines into role + micros + unit', () => {
    const d = extractContractFields(SAMPLE_MSA);
    const senior = d.rateCard.find((l) => l.role.startsWith('Senior'));
    expect(senior).toEqual({ role: 'Senior Consultant', rateMicros: 800_000_000, unit: 'day' });
    const arch = d.rateCard.find((l) => l.role.startsWith('Solution'));
    expect(arch?.rateMicros).toBe(1_100_000_000);
    expect(arch?.unit).toBe('day');
    const pm = d.rateCard.find((l) => l.role.startsWith('Project'));
    expect(pm?.unit).toBe('hour');
  });

  it('flags low-confidence + warns when nothing is detected', () => {
    const d = extractContractFields('Some unrelated text with no contract data.');
    expect(d.confidenceBps).toBeLessThan(7000); // deterministic baseline
    expect(d.reference).toBeNull();
    expect(d.rateCard).toHaveLength(0);
    expect(d.warnings.length).toBeGreaterThan(0);
    // The review reminder is always present so the draft is never auto-trusted.
    expect(d.warnings.some((w) => /review/i.test(w))).toBe(true);
  });

  it('detects framework agreements and country names', () => {
    const d = extractContractFields('This Framework Agreement covers France and Germany.');
    expect(d.kind).toBe('framework');
    expect(d.countries).toEqual(expect.arrayContaining(['FR', 'DE']));
  });
});
