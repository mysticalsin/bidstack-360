import { describe, expect, it } from 'vitest';

import { extractMsaFields } from './extract-fields.js';
import { rankAccountMatches } from './match-account.js';
import { SYNTHETIC_NORTHWIND_MSA_TEXT } from './synthetic-msa.js';

describe('rankAccountMatches', () => {
  it('scores the client legal name and email domain above an unrelated account', () => {
    const fields = extractMsaFields(SYNTHETIC_NORTHWIND_MSA_TEXT);
    const matches = rankAccountMatches(
      [
        {
          companyId: '11111111-1111-4111-8111-111111111111',
          name: 'Northwind Pharma',
          legalName: 'Northwind Pharma SAS',
          domain: 'northwind-pharma.example',
          address: '14 Avenue des Sciences, Lyon',
          emails: ['contracts@northwind-pharma.example'],
        },
        {
          companyId: '22222222-2222-4222-8222-222222222222',
          name: 'Acme Logistics',
          legalName: null,
          domain: 'acme.example',
          address: null,
          emails: [],
        },
      ],
      fields,
    );
    expect(matches[0]?.name).toBe('Northwind Pharma');
    expect(matches[0]?.scoreBps).toBeGreaterThanOrEqual(7800);
    expect(matches.some((m) => m.name === 'Acme Logistics')).toBe(false);
  });
});
