import { describe, expect, it } from 'vitest';

import { storedLegalName } from './enrichment.service.js';

describe('storedLegalName', () => {
  it('does not turn a missing profile or a search label into a legal name', () => {
    expect(storedLegalName(null)).toBeNull();
    expect(storedLegalName({ legalName: null })).toBeNull();
    expect(storedLegalName({ legalName: '   ' })).toBeNull();
  });

  it('keeps a legal name the profile already recorded', () => {
    expect(storedLegalName({ legalName: ' Microsoft Corporation ' })).toBe('Microsoft Corporation');
  });
});
