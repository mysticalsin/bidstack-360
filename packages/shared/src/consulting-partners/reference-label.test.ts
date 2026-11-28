import { describe, expect, it } from 'vitest';

import { PARTNER_SOURCE_LABEL } from './types.js';

// Fixture evidence is still source "fixture" and sample true. The words a seller
// reads must not call that row a sample or a demo.
const DEMO_COPY = /sample|demo|sandbox|illustrative|not live/i;

describe('consulting partner reference labels', () => {
  it('names fixture evidence as a reference record', () => {
    expect(PARTNER_SOURCE_LABEL.fixture).toBe('Reference record');
    expect(PARTNER_SOURCE_LABEL.fixture).not.toMatch(DEMO_COPY);
  });
});
