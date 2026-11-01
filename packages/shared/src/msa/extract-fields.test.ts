import { describe, expect, it } from 'vitest';

import { contractMicros, extractMsaFields, intakeOmissionNotes, rateCardLineText, storableLiabilityCap, storableRateCard } from './extract-fields.js';
import { SYNTHETIC_NORTHWIND_MSA_TEXT } from './synthetic-msa.js';

describe('extractMsaFields', () => {
  it('fills cited fields from a synthetic HEMA MSA and leaves nothing invented', () => {
    const fields = extractMsaFields(SYNTHETIC_NORTHWIND_MSA_TEXT);

    expect(fields.clientParty.found).toBe(true);
    expect(String(fields.clientParty.value)).toMatch(/Northwind Pharma/i);
    expect(fields.clientParty.citation?.clause).toMatch(/Clause/i);
    expect(fields.clientParty.citation?.excerpt).toMatch(/Northwind|Client/i);

    expect(fields.ourParty.found).toBe(true);
    expect(String(fields.ourParty.value)).toMatch(/Amaris|HEMA/i);

    expect(fields.effectiveDate.found).toBe(true);
    expect(fields.expiryDate.found).toBe(true);
    expect(fields.termMonths.value).toBe(36);
    expect(fields.autoRenew.value).toBe(true);
    expect(fields.noticePeriodDays.value).toBe(90);

    expect(fields.governingLaw.found).toBe(true);
    expect(String(fields.governingLaw.value)).toMatch(/France/i);

    expect(fields.liabilityCap.found).toBe(true);
    const cap = fields.liabilityCap.value as { amountMicros: number; currency: string };
    expect(cap.amountMicros).toBe(250_000_000_000);
    expect(cap.currency).toBe('EUR');
    expect(fields.liabilityCap.citation?.excerpt).toMatch(/250/);

    expect(String(fields.paymentTerms.value)).toMatch(/net 60/i);
    expect(fields.scopeOfServices.found).toBe(true);
    expect(fields.affiliatesClause.found).toBe(true);
    expect(fields.ip.found).toBe(true);
    expect(fields.confidentiality.found).toBe(true);
    expect(fields.nonSolicit.found).toBe(true);
    expect(fields.exclusivity.found).toBe(true);
    expect(fields.insurance.found).toBe(true);
    expect(fields.indexation.found).toBe(true);
    expect(Array.isArray(fields.rateCard.value)).toBe(true);
  });

  it('keeps a cent in the cap and drops a figure that does not fit', () => {
    // WHY: Math.round(amount * 1e6) cannot hold a cap past the safe integer range.
    expect(contractMicros('250,000.50')).toBe(250_000_500_000);
    expect(contractMicros('250,000')).toBe(250_000_000_000);
    expect(contractMicros('1,234,567')).toBe(1_234_567_000_000);
    expect(contractMicros('1234,567')).toBe(1_234_567_000);
    expect(contractMicros('250,50')).toBe(250_500_000);
    expect(contractMicros('1.250,50')).toBe(1_250_500_000);
    expect(contractMicros('1.015')).toBe(1_015_000);
    expect(contractMicros('99999999999.99')).toBeNull();
    const fields = extractMsaFields(
      [
        "Supplier's aggregate liability under this Agreement is capped at 250,000.50 EUR.",
        'Specialist: 1.015 EUR per hour',
      ].join('\n'),
    );
    expect(fields.liabilityCap.value).toEqual({ amountMicros: 250_000_500_000, currency: 'EUR' });
    const rates = fields.rateCard.value as Array<{ role: string; rateMicros: number; unit: string }>;
    expect(rates.find((row) => row.role === 'Specialist')).toEqual({
      role: 'Specialist',
      rateMicros: 1_015_000,
      unit: 'hour',
    });
    const european = extractMsaFields(
      "Supplier's aggregate liability under this Agreement is capped at 250,50 EUR.",
    );
    expect(european.liabilityCap.value).toEqual({ amountMicros: 250_500_000, currency: 'EUR' });
    const huge = extractMsaFields(
      "Supplier's aggregate liability under this Agreement is capped at 99999999999.99 EUR.",
    );
    expect(huge.liabilityCap.found).toBe(true);
    expect(huge.liabilityCap.value).toBe('amount not readable');
    expect(huge.liabilityCap.citation?.excerpt).toMatch(/99999999999/);
    expect(storableLiabilityCap(huge.liabilityCap.value)).toBeNull();
    expect(storableLiabilityCap({ amountMicros: 250_000_500_000, currency: 'eur' })).toEqual({
      amountMicros: 250_000_500_000,
      currency: 'EUR',
    });
    const oversized = extractMsaFields(
      ['Partner: 9007199254.8 EUR per day', 'Specialist: 1.015 EUR per hour'].join('\n'),
    );
    const card = oversized.rateCard.value as Array<{ role: string; rateMicros: number | null; unit: string }>;
    expect(card.find((row) => row.role === 'Partner')).toEqual({
      role: 'Partner',
      rateMicros: null,
      unit: 'day',
    });
    expect(storableRateCard(card).map((row) => row.role)).toEqual(['Specialist']);
    const large = extractMsaFields('Director: 1000000.01 EUR per day');
    const largeCard = large.rateCard.value as Array<{ role: string; rateMicros: number | null; unit: string }>;
    const director = largeCard.find((row) => row.role === 'Director');
    expect(director?.rateMicros).toBe(1_000_000_010_000);
    expect(rateCardLineText('Director', director?.rateMicros ?? null, 'day')).toBe(
      'Director: 1,000,000.01 / day, too large to store',
    );
    expect(storableRateCard(largeCard)).toEqual([]);
    expect(rateCardLineText('Director', 1_000_000_000_000, 'day')).toBe('Director: 1,000,000 / day');
    expect(intakeOmissionNotes(large)).toBe('Director: 1,000,000.01 / day, too large to store');
    expect(intakeOmissionNotes(fields)).toBeNull();
    expect(intakeOmissionNotes(huge)).toBe('Liability cap: amount not readable');
  });

  it('returns blank not-found fields when the document has no commercial terms', () => {
    const fields = extractMsaFields('This is a cover letter. There is no agreement here.');
    expect(fields.governingLaw.found).toBe(false);
    expect(fields.governingLaw.value).toBeNull();
    expect(fields.liabilityCap.found).toBe(false);
    expect(fields.effectiveDate.found).toBe(false);
    expect(fields.clientParty.found).toBe(false);
  });
});
