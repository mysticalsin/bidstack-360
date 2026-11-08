import { describe, expect, it } from 'vitest';

import { normalizeErpPartner } from './erp.partners.service';

describe('normalizeErpPartner', () => {
  it('does not turn an ERP row into a 90% match', () => {
    const suggestion = normalizeErpPartner(
      { id: 12, name: 'Northwind', website: 'https://northwind.example' },
      { q: 'north', limit: 8 },
    );
    expect(suggestion?.name).toBe('Northwind');
    expect(suggestion?.confidence).toBeNull();
    expect(suggestion?.source).toBe('external_erp');
  });
});
