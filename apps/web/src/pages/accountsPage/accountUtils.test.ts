import { describe, expect, it } from 'vitest';

import { healthLabel } from './accountUtils';

describe('healthLabel', () => {
  it('keeps the pipeline band from reading as a measured health score', () => {
    // Why: the list only has weighted pipeline size. Calling that Strong
    // without a proxy mark is the misleading health the safety gate forbids.
    expect(healthLabel('strong')).toContain('proxy');
    expect(healthLabel('critical')).toContain('proxy');
  });
});
