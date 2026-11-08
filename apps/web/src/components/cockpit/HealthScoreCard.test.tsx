import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import type { AccountCockpitMaybeScored, CrmCompany } from '@bidstack/shared';

import { HealthScoreCard } from './HealthScoreCard';
import { PageHead } from './PageHead';

function cockpit(health: AccountCockpitMaybeScored['health']): AccountCockpitMaybeScored {
  return {
    company: {
      id: 'other',
      source: 'external_crm',
      name: 'Other Co',
      domain: null,
      logo: null,
      sourceAttribution: [],
    } as unknown as CrmCompany,
    kpis: [],
    technicalStack: [],
    health,
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

describe('account health when the score is unknown', () => {
  afterEach(cleanup);

  it('HealthScoreCard says "Not scored yet" and draws no gauge or number', () => {
    const { container } = render(<HealthScoreCard cockpit={cockpit(null)} />);
    expect(screen.getByText('Not scored yet')).toBeDefined();
    expect(screen.getByTestId('health-not-scored').textContent).toContain('own contacts, deals and tasks');
    expect(container.querySelector('.health-gauge')).toBeNull();
    expect(container.textContent).not.toMatch(/\/100/);
  });

  it('HealthScoreCard still shows the score and band when it is known', () => {
    const { container } = render(
      <HealthScoreCard cockpit={cockpit({ score: 82, band: 'good', counts: { good: 3 } })} />,
    );
    expect(screen.getByRole('img', { name: /coverage 82 out of 100/i })).toBeDefined();
    expect(screen.getAllByText('Good').length).toBeGreaterThan(0);
    expect(container.querySelector('.health-gauge')).not.toBeNull();
    expect(screen.queryByText('Not scored yet')).toBeNull();
  });

  it('PageHead shows a "Not scored yet" pill instead of a band for an unscored account', () => {
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PageHead cockpit={cockpit(null)} accountView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const pill = container.querySelector('.acct-pill');
    expect(pill?.textContent).toBe('Not scored yet');
    expect(pill?.getAttribute('data-band')).toBe('unscored');
  });
});
