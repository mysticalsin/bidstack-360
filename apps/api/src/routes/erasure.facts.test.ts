import { describe, expect, it } from 'vitest';

import { contactFactNeedsScrub } from './contact-fact-erasure.js';

describe('contact fact erasure', () => {
  it('scrubs a live fact that still states who the person is', () => {
    expect(
      contactFactNeedsScrub({
        claim: 'Jane Buyer reports to the CIO',
        evidenceDetail: 'jane.buyer@acme.example',
        deletedAt: null,
      }),
    ).toBe(true);
  });

  it('leaves an already tombstoned fact alone on a second erasure', () => {
    expect(
      contactFactNeedsScrub({
        claim: '[erased]',
        evidenceDetail: null,
        deletedAt: new Date('2026-11-08T00:00:00.000Z'),
      }),
    ).toBe(false);
  });
});
