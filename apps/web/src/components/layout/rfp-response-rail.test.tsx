// A seeded deal opens its response at /rfp/:id/pipeline (the opportunity
// "RFP Pipeline" control). That page is not the deal board (/pipeline) and
// it is not /proposals. The rail matched only the item href, so Bids stayed
// shut and Proposals was not the current item. A remembered collapse made
// it worse: Accounts could stay open while Proposals was not on the rail.
// The phone drawer for this path is a separate change. This file guards the
// expanded rail, the stale accordion, and the collapsed-rail flyout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { useUiStore } from '@/stores/ui';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunityCount: () => ({ data: undefined }) }));
vi.mock('@/hooks/useTasks', () => ({ useTaskSummary: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAppModules', () => ({ useAppModules: () => ({ data: {} }) }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

const RESPONSE = '/rfp/sample-bid/pipeline';

function renderSidebar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function proposalsLink() {
  return screen.getByRole('link', { name: 'Proposals', exact: true });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('rail on an RFP response', () => {
  it('marks Proposals current and opens Bids', () => {
    renderSidebar(RESPONSE);

    expect(screen.getByRole('button', { name: 'Bids & RFP' }).getAttribute('aria-expanded')).toBe('true');
    const proposals = proposalsLink();
    expect(proposals.getAttribute('aria-current')).toBe('page');
    expect(proposals.getAttribute('href')).toBe('/proposals');
    expect(
      screen.queryByRole('link', { name: 'Opportunities', exact: true })?.getAttribute('aria-current') ?? null,
    ).toBeNull();
  });

  it('opens Bids when a previous visit left it shut and Accounts open', () => {
    useUiStore.setState({ collapsedSections: { bids: true, accounts: false } });

    renderSidebar(RESPONSE);

    expect(screen.getByRole('button', { name: 'Bids & RFP' }).getAttribute('aria-expanded')).toBe('true');
    expect(proposalsLink().getAttribute('aria-current')).toBe('page');
    expect(useUiStore.getState().collapsedSections.bids).toBe(false);
    expect(useUiStore.getState().collapsedSections.accounts).toBe(true);
  });

  it('marks Proposals current in the collapsed-rail flyout', () => {
    useUiStore.setState({ sidebarCollapsed: true });

    renderSidebar(RESPONSE);

    const proposals = proposalsLink();
    expect(proposals.getAttribute('aria-current')).toBe('page');
    expect(proposals.getAttribute('href')).toBe('/proposals');
  });

  it('leaves Proposals idle on the deal board', () => {
    useUiStore.setState({ collapsedSections: { bids: false } });

    renderSidebar('/pipeline');

    expect(screen.getByRole('button', { name: 'Bids & RFP' }).getAttribute('aria-expanded')).toBe('true');
    expect(proposalsLink().getAttribute('aria-current')).toBeNull();
  });

  it('still marks Proposals current on its own door', () => {
    renderSidebar('/proposals');

    const proposals = proposalsLink();
    expect(proposals.getAttribute('aria-current')).toBe('page');
    expect(proposals.getAttribute('href')).toBe('/proposals');
  });

  it('does not treat a deeper rfp path as the response', () => {
    useUiStore.setState({ collapsedSections: { bids: false } });

    renderSidebar('/rfp/sample-bid/pipeline/extra');

    expect(proposalsLink().getAttribute('aria-current')).toBeNull();
  });
});
