import { describe, expect, it } from 'vitest';

import { visibleNavSections } from './navConfig';

describe('visibleNavSections', () => {
  it('hides Quick Start until the person turns it on', () => {
    // Why: Quick Start is an onboarding aid, not a permanent nav item.
    const hidden = visibleNavSections(false).flatMap((section) => section.items.map((item) => item.to));
    const shown = visibleNavSections(true).flatMap((section) => section.items.map((item) => item.to));
    expect(hidden).not.toContain('/quick-start');
    expect(shown).toContain('/quick-start');
    expect(hidden).toContain('/dashboard');
  });
});
