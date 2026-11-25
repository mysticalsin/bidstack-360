// The domain sits next to the health pill on every account. Demo companies
// already store a public site (CI Financial is ci.com → https://www.ci.com/).
// That word has to open the site. A script URL or a different host must stay
// text, because the visible word is the domain.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import type { AccountCockpitMaybeScored, CrmCompany } from '@bidstack/shared';

import { PageHead } from './PageHead';

function cockpit(domain: string, website: string | null): AccountCockpitMaybeScored {
  return {
    company: {
      id: '11111111-1111-4111-8111-111111111111',
      source: 'external_crm',
      name: 'CI Financial',
      domain,
      website,
      logo: null,
      sourceAttribution: [],
      confidence: 0.8,
    } as unknown as CrmCompany,
    kpis: [],
    technicalStack: [],
    health: { score: 82, band: 'good', counts: { good: 3 } },
    keyContacts: [],
    recentActivity: [],
    risks: [],
    compliance: [],
    roadmap: [],
  };
}

function renderHead(domain: string, website: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PageHead cockpit={cockpit(domain, website)} accountView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('account domain opens the company site', () => {
  afterEach(cleanup);

  it('links ci.com to the https site the account already stores', () => {
    // WHY: the domain is the first identity on the cockpit. Leaving it as
    // text sends a salesperson hunting for the site in a logo hover.
    renderHead('ci.com', 'https://www.ci.com/');

    const link = screen.getByRole('link', { name: /ci\.com/ });
    expect(link.getAttribute('href')).toBe('https://www.ci.com/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(link.textContent).toMatch(/opens in a new tab/);
  });

  it('keeps the domain as text when the stored site is not that host', () => {
    // WHY: the word on screen is ci.com. A script URL or another host must
    // not become the address of that word.
    renderHead('ci.com', 'javascript:alert(1)');
    expect(screen.queryByRole('link', { name: /ci\.com/ })).toBeNull();
    expect(screen.getByText('ci.com')).toBeTruthy();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();

    cleanup();
    renderHead('ci.com', 'https://evil.example/phish');
    expect(screen.queryByRole('link', { name: /ci\.com/ })).toBeNull();
    expect(screen.getByText('ci.com')).toBeTruthy();
    expect(document.querySelector('a[href="https://evil.example/phish"]')).toBeNull();
  });
});
