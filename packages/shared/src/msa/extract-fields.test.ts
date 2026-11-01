import { describe, expect, it } from 'vitest';

import { extractMsaFields } from './extract-fields.js';
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

  it('returns blank not-found fields when the document has no commercial terms', () => {
    const fields = extractMsaFields('This is a cover letter. There is no agreement here.');
    expect(fields.governingLaw.found).toBe(false);
    expect(fields.governingLaw.value).toBeNull();
    expect(fields.liabilityCap.found).toBe(false);
    expect(fields.effectiveDate.found).toBe(false);
    expect(fields.clientParty.found).toBe(false);
  });
});
