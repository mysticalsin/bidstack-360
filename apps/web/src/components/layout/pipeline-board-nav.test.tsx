// The List / Board switch, quick start, and "g p" all open the board at
// /pipeline. The rail has one Opportunities door for that workspace, so the
// board has to keep that door current and the Pipeline section open.
// A bid's own response pipeline (/rfp/:id/pipeline) is a different page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { SHELL_WIDE_QUERY } from './shellBreakpoint';
import { useUiStore } from '@/stores/ui';
import { mockMatchMedia } from '@/test/matchMedia';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunityCount: () => ({ data: undefined }) }));
vi.mock('@/hooks/useTasks', () => ({ useTaskSummary: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAppModules', () => ({ useAppModules: () => ({ data: {} }) }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

const BOARD = '/pipeline';
const FILTERED_BOARD = '/pipeline?pipelineStageId=11111111-1111-4111-8111-111111111111';
const RFP_PIPELINE = '/rfp/sample-bid/pipeline';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function renderDrawer(path: string) {
  mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
  render(
    <MemoryRouter initialEntries={[path]}>
      <div className="app-shell">
        <button
          type="button"
          aria-controls="mobile-nav-drawer"
          onClick={() => useUiStore.getState().toggleMobileNav()}
        >
          Open navigation
        </button>
        <MobileNav />
      </div>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  return screen.getByRole('dialog', { name: 'Primary navigation' });
}

function railNav() {
  return screen.getByRole('navigation', { name: 'Primary navigation' });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.style.overflow = '';
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('pipeline board stays on the Opportunities door', () => {
  it('keeps Opportunities current and the Pipeline section open on the board', () => {
    const { container } = renderSidebar(BOARD);
    const nav = railNav();

    // A shut section hides the door, so the board looks like it has no place in the rail.
    expect(container.querySelector('#sb-section-pipeline')).not.toBeNull();
    const opportunities = within(nav).getByRole('link', { name: 'Opportunities' });
    expect(opportunities.getAttribute('href')).toBe('/opportunities');
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Leads' }).getAttribute('aria-current')).not.toBe('page');
  });

  it('opens a Pipeline section that was left collapsed when the board is showing', () => {
    useUiStore.setState({ collapsedSections: { pipeline: true, accounts: false } });

    const { container } = renderSidebar(BOARD);

    expect(container.querySelector('#sb-section-pipeline')).not.toBeNull();
    expect(useUiStore.getState().collapsedSections.accounts).toBe(true);
  });

  it('keeps Opportunities current when the board is filtered to one stage', () => {
    const { container } = renderSidebar(FILTERED_BOARD);

    expect(container.querySelector('#sb-section-pipeline')).not.toBeNull();
    expect(within(railNav()).getByRole('link', { name: 'Opportunities' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('marks Opportunities current in the collapsed-rail flyout on the board', () => {
    useUiStore.setState({ sidebarCollapsed: true });
    renderSidebar(BOARD);

    const pipeline = within(railNav()).getByRole('button', { name: 'Pipeline' });
    const flyout = pipeline.parentElement?.querySelector('.sb-flyout');
    expect(flyout).toBeInstanceOf(HTMLElement);
    const menu = flyout as HTMLElement;
    const opportunities = within(menu).getByRole('link', { name: 'Opportunities' });

    expect(opportunities.getAttribute('href')).toBe('/opportunities');
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(within(menu).getByRole('link', { name: 'Leads' }).getAttribute('aria-current')).not.toBe('page');
  });

  it('tints Opportunities in the drawer on the board, and not Leads', () => {
    const drawer = renderDrawer(BOARD);
    const opportunities = within(drawer).getByRole('link', { name: 'Opportunities' });
    const leads = within(drawer).getByRole('link', { name: 'Leads' });

    expect(opportunities.getAttribute('href')).toBe('/opportunities');
    expect(opportunities.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(leads.className).not.toContain('bg-[var(--brand-primary-tint)]');
    expect(leads.getAttribute('aria-current')).not.toBe('page');
  });

  it('does not treat a bid response pipeline as the opportunities board', () => {
    renderSidebar(RFP_PIPELINE);

    expect(screen.queryByRole('link', { name: 'Opportunities' })).toBeNull();
  });
});
