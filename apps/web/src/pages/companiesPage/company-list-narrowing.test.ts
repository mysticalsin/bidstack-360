import { describe, expect, it } from 'vitest';

import { companyListFilterLabel } from './company-list-narrowing';

describe('companyListFilterLabel', () => {
  it('is absent when the list is not narrowed by an intel view or direction', () => {
    // Search is not this label. An empty search result already has its own
    // sentence. This helper only names the saved view and the direction.
    expect(companyListFilterLabel(null, null)).toBeNull();
  });

  it('names the saved view the toolbar button shows', () => {
    expect(companyListFilterLabel('revenue_over_1b', null)).toBe('Revenue over 1B');
    expect(companyListFilterLabel('hiring_fast', null)).toBe('Hiring fast');
    expect(companyListFilterLabel('contracting', null)).toBe('Contracting');
  });

  it('names the direction the toolbar select shows', () => {
    expect(companyListFilterLabel(null, 'contracting')).toBe('Contracting');
    expect(companyListFilterLabel(null, 'growing')).toBe('Growing');
    expect(companyListFilterLabel(null, 'steady')).toBe('Steady');
  });

  it('keeps the view and the direction when both are set', () => {
    expect(companyListFilterLabel('hiring_fast', 'growing')).toBe('Hiring fast, Growing');
  });
});
