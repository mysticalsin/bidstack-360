// The calls list opens at /calls (the command palette). That page is not the
// opportunities list (/opportunities) and it is not the deal board
// (/pipeline). The rail matched only the item href, so Pipeline stayed shut
// and Opportunities was not the current item. A remembered collapse made it
// worse: Accounts could stay open while Opportunities was not on the rail.
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

const CALLS = '/calls';

function renderSidebar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function opportunitiesLink() {
  return screen.getByRole('link', { name: 'Opportunities', exact: true });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('rail on the calls list', () => {
  it('marks Opportunities current and opens Pipeline', () => {
    renderSidebar(CALLS);

    expect(screen.getByRole('button', { name: 'Pipeline' }).getAttribute('aria-expanded')).toBe('true');
    const opportunities = opportunitiesLink();
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(opportunities.getAttribute('href')).toBe('/opportunities');
  });

  it('opens Pipeline when a previous visit left it shut and Accounts open', () => {
    useUiStore.setState({ collapsedSections: { pipeline: true, accounts: false } });

    renderSidebar(CALLS);

    expect(screen.getByRole('button', { name: 'Pipeline' }).getAttribute('aria-expanded')).toBe('true');
    expect(opportunitiesLink().getAttribute('aria-current')).toBe('page');
    expect(useUiStore.getState().collapsedSections.pipeline).toBe(false);
    expect(useUiStore.getState().collapsedSections.accounts).toBe(true);
  });

  it('marks Opportunities current in the collapsed-rail flyout', () => {
    useUiStore.setState({ sidebarCollapsed: true });

    renderSidebar(CALLS);

    const opportunities = opportunitiesLink();
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(opportunities.getAttribute('href')).toBe('/opportunities');
  });

  it('leaves Opportunities idle on the deal board', () => {
    useUiStore.setState({ collapsedSections: { pipeline: false } });

    renderSidebar('/pipeline');

    expect(screen.getByRole('button', { name: 'Pipeline' }).getAttribute('aria-expanded')).toBe('true');
    expect(opportunitiesLink().getAttribute('aria-current')).toBeNull();
  });

  it('still marks Opportunities current on its own door', () => {
    renderSidebar('/opportunities');

    const opportunities = opportunitiesLink();
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(opportunities.getAttribute('href')).toBe('/opportunities');
  });

  it('does not treat a deeper calls path as the list', () => {
    useUiStore.setState({ collapsedSections: { pipeline: false } });

    renderSidebar('/calls/extra');

    expect(opportunitiesLink().getAttribute('aria-current')).toBeNull();
  });

  it('does not treat an RFP response as the calls list', () => {
    useUiStore.setState({ collapsedSections: { pipeline: false } });

    renderSidebar('/rfp/sample-bid/pipeline');

    expect(opportunitiesLink().getAttribute('aria-current')).toBeNull();
  });
});
