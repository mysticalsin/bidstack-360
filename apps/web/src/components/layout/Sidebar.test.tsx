// Sidebar accordion + route sync — guards the regression where one accordion
// click left every OTHER section with a persisted explicit collapsed=true
// override, and a later navigation into one of those sections (deep link,
// search result, back button) no longer auto-expanded it: the active nav
// item stayed invisible until the user manually reopened the group.
//
// Data hooks (react-query, auth, app-modules) are mocked so this stays a
// pure routing/state test — no network, no QueryClientProvider needed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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

function renderSidebar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('Sidebar route sync', () => {
  it('reveals the section owning the active route on mount, even if it carries a stale explicit collapse', () => {
    // 'pipeline' explicitly collapsed — exactly what setSectionCollapsed
    // leaves behind on every section other than the one most recently opened.
    useUiStore.setState({ collapsedSections: { pipeline: true, accounts: false } });

    const { container } = renderSidebar('/opportunities');

    expect(container.querySelector('#sb-section-pipeline')).not.toBeNull();
    // The accordion invariant still holds: revealing pipeline collapsed accounts.
    expect(useUiStore.getState().collapsedSections.accounts).toBe(true);
  });

  it('does not touch collapsedSections when the active section is already expanded', () => {
    useUiStore.setState({ collapsedSections: { pipeline: false } });

    renderSidebar('/opportunities');

    // No expandSectionForRoute write should have happened — the effect must
    // check the current override before writing, or it would collapse every
    // other section (accounts, sales, bids, workspace) on every render.
    expect(useUiStore.getState().collapsedSections).toEqual({ pipeline: false });
  });
});
