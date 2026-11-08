import { describe, expect, it } from 'vitest';

import { FieldProvenance } from './account-enrichment.js';

describe('FieldProvenance', () => {
  it('accepts provider ids and the demo fixture marker', () => {
    for (const source of ['apollo', 'seamless', 'fixture']) {
      expect(
        FieldProvenance.safeParse({ source, fetchedAt: '2026-11-01T00:00:00.000Z' }).success,
      ).toBe(true);
    }
  });

  it('rejects unknown sources', () => {
    expect(
      FieldProvenance.safeParse({ source: 'linkedin', fetchedAt: '2026-11-01T00:00:00.000Z' })
        .success,
    ).toBe(false);
  });
});
