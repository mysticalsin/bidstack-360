// The company record and the account cockpit are two routes for one id.
// A raw id must not be able to leave /accounts/:id (a slash would), and the
// loaded record must use this path rather than a name search.
import { describe, expect, it } from 'vitest';

import { companyCockpitHref } from './company-cockpit-href';

describe('companyCockpitHref', () => {
  it('opens the account cockpit for the company id', () => {
    expect(companyCockpitHref('00000000-0000-4000-8000-0000000000c1')).toBe(
      '/accounts/00000000-0000-4000-8000-0000000000c1',
    );
  });

  it('encodes an id so a slash cannot become a different route', () => {
    expect(companyCockpitHref('a/b c')).toBe('/accounts/a%2Fb%20c');
  });
});
