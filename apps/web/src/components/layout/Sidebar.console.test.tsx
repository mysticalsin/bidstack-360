// Console-shell sidebar: collapsible 64px / 232px rail. Guards the keyboard
// contract (native toggle button, Tab order, accessible names and tooltips in
// compact mode) and the motion contract (width eases on pointer toggles, is
// instant for keyboard toggles and under prefers-reduced-motion).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { useAccountHistory } from '@/stores/accountHistory';
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

const REDUCE = '(prefers-reduced-motion: reduce)';

function renderSidebar(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function nav() {
  return screen.getByRole('navigation', { name: 'Primary navigation' });
}

function tabOrder(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  useAccountHistory.setState({ recents: [], favorites: [] });
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('Sidebar toggle (keyboard)', () => {
  it('is a native button, so Enter and Space activate it', () => {
    mockMatchMedia({});
    renderSidebar();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('a keyboard activation (click with detail 0) collapses instantly and flips aria-expanded', () => {
    mockMatchMedia({});
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }), { detail: 0 });

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(nav().getAttribute('data-motion')).toBe('instant');
  });

  it('a pointer click animates the width', () => {
    mockMatchMedia({});
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }), { detail: 1 });

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(nav().getAttribute('data-motion')).toBe('animate');
  });

  it('Tab order starts at the toggle, then Dashboard, with no positive tabindex', () => {
    mockMatchMedia({});
    renderSidebar();
    const order = tabOrder(nav());

    expect(order[0]?.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(order[1]?.getAttribute('aria-label')).toBe('Dashboard');
    expect(nav().querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveLength(0);
  });
});

describe('Sidebar compact mode (64px rail)', () => {
  it('keeps an accessible name on every focusable item', () => {
    mockMatchMedia({});
    useAccountHistory.setState({
      favorites: [{ slug: 'acme', name: 'Acme Corp', visitedAt: '2026-11-01T00:00:00.000Z' }],
    });
    useUiStore.setState({ sidebarCollapsed: true });
    renderSidebar();

    const order = tabOrder(nav());
    expect(order[0]?.getAttribute('aria-label')).toBe('Expand sidebar');
    // Rail items hide their text label with CSS (visibility: hidden), which
    // also drops it from the accessible name, so each needs an aria-label.
    for (const el of nav().querySelectorAll<HTMLElement>('.sb-item')) {
      const name = el.getAttribute('aria-label') ?? '';
      expect(name.trim().length, el.outerHTML.slice(0, 80)).toBeGreaterThan(0);
    }
    expect(within(nav()).getByRole('link', { name: 'Acme Corp' }).getAttribute('aria-label')).toBe(
      'Acme Corp',
    );
    expect(within(nav()).getByRole('button', { name: 'Sales' })).toBeTruthy();
  });

  it('shows the label as a tooltip when an icon item takes keyboard focus', async () => {
    mockMatchMedia({});
    useUiStore.setState({ sidebarCollapsed: true });
    renderSidebar();

    fireEvent.focus(within(nav()).getByRole('link', { name: 'Dashboard' }));

    expect((await screen.findByRole('tooltip')).textContent).toContain('Dashboard');
  });

  it('section flyouts still list their links', () => {
    mockMatchMedia({});
    useUiStore.setState({ sidebarCollapsed: true });
    renderSidebar();

    const sales = within(nav()).getByRole('button', { name: 'Sales' });
    const flyout = sales.parentElement?.querySelector('.sb-flyout') as HTMLElement;
    expect(within(flyout).getByRole('link', { name: 'Forecasts' })).toBeTruthy();
  });
});

describe('Sidebar reduced motion', () => {
  it('width change is instant under prefers-reduced-motion, even for pointer toggles', () => {
    mockMatchMedia({ [REDUCE]: true });
    renderSidebar();
    expect(nav().getAttribute('data-motion')).toBe('instant');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }), { detail: 1 });
    expect(nav().getAttribute('data-motion')).toBe('instant');
  });
});
