import { describe, expect, it } from 'vitest';

import { storedProbabilityLabel } from './stored-probability';

describe('storedProbabilityLabel', () => {
  it('treats a stored zero as unrecorded and keeps a real value', () => {
    // WHY: a blank probability is stored as 0. Showing 0% reads as a measured chance.
    expect(storedProbabilityLabel(0)).toBe('Not recorded');
    expect(storedProbabilityLabel(0, 'Non enregistrée')).toBe('Non enregistrée');
    expect(storedProbabilityLabel(35)).toBe('35%');
    expect(storedProbabilityLabel(62)).toBe('62%');
  });
});
