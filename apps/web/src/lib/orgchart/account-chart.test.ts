import { describe, expect, it } from 'vitest';

import { accountOrgChart } from './account-chart';

describe('account org chart', () => {
  it('real mode does not render the labelled sample org chart', () => {
    const chart = accountOrgChart({ dataMode: 'real', saved: null, companyId: 'co', people: [] });
    expect(chart).toBeNull();
  });

  it('demo mode renders the labelled sample org chart', () => {
    const chart = accountOrgChart({ dataMode: 'demo', saved: null, companyId: 'co', people: [] });
    expect(chart?.sample).toBe(true);
    expect(chart?.nodes.some((node) => node.name === 'Alex Morgan')).toBe(true);
  });
});
