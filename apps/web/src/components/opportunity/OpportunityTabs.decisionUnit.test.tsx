// The decision unit is the default deal tab. A CRM person on it is a contact
// record. The name has to open that record. A Dust-only name, or an id that
// is not a contact id, has no page and stays text.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

vi.mock('@/components/signatures/SendForSignatureModal', () => ({
  SendForSignatureModal: () => null,
}));

import { OpportunityTabs } from './OpportunityTabs';

const ADA = '11111111-1111-4111-8111-111111111111';

function renderDecisionUnit(
  items: Array<Record<string, unknown>>,
  intel: Array<{
    contactId: string;
    name: string;
    role: string;
    influence: number;
    sentiment: 'hot' | 'warm' | 'neutral' | 'cold';
    power: 'decision' | 'champion' | 'influencer' | 'gatekeeper' | 'approver';
  }> = [],
) {
  apiMock.mockResolvedValue({ items });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <OpportunityTabs oppId="opp-1" customer="Northwind Pharma" intelDecisionUnit={intel} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('decision unit contact names', () => {
  it('opens the contact record from a CRM stakeholder name', async () => {
    // WHY: this tab is the buying committee. The name is the only way onto
    // the person. Leaving it as text forces a search that can match someone else.
    renderDecisionUnit([
      {
        id: ADA,
        name: 'Ada North',
        role: 'Head of Procurement',
        email: 'ada.north@northwind-pharma.example',
        phone: null,
        sentiment: 'warm',
        influence: 5,
      },
    ]);

    const link = await screen.findByRole('link', { name: /Ada North/ });
    expect(link.getAttribute('href')).toBe(`/contacts/${ADA}`);
    expect(link.textContent).toContain('open contact');
    expect(link.className).toContain('min-h-11');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  });

  it('does not turn a Dust-only name into a contact link', async () => {
    // WHY: Dust members are not CRM contacts yet. A uuid-shaped id here would
    // open a missing record, or the wrong one.
    renderDecisionUnit([], [
      {
        contactId: ADA,
        name: 'Dust Only',
        role: 'Champion',
        influence: 0.8,
        sentiment: 'hot',
        power: 'champion',
      },
    ]);

    expect(await screen.findByText('Dust Only')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Dust Only/ })).toBeNull();
  });

  it('keeps a CRM row as text when the id is not a contact id', async () => {
    // WHY: the address is the id, never the name. A script, a path, or a
    // person's name must not become the href.
    renderDecisionUnit([
      {
        id: 'javascript:alert(1)',
        name: 'Ada North',
        role: 'Head of Procurement',
        email: null,
        phone: null,
        sentiment: 'neutral',
        influence: 1,
      },
    ]);

    expect(await screen.findByText('Ada North')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
