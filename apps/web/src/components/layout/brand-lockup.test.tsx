// WHY: the rail and the drawer print a tagline under Polo PreSales. On a
// 1280px laptop the rail is 232px and that second line is ellipsized beside
// the collapse control. The lockup is the product name. Daily destinations,
// the collapse control, and the Dust status stay.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MobileNav } from './MobileNav';
import { SHELL_WIDE_QUERY } from './shellBreakpoint';
import { Sidebar } from './Sidebar';
import { useUiStore } from '@/stores/ui';
import { mockMatchMedia } from '@/test/matchMedia';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunityCount: () => ({ data: undefined }) }));
vi.mock('@/hooks/useTasks', () => ({ useTaskSummary: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAppModules', () => ({ useAppModules: () => ({ data: {} }) }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

const PRODUCT = 'Polo PreSales';
const LOCALES = ['en', 'fr', 'es', 'it', 'pt', 'zh'] as const;

/** Taglines still shipped in the locale files, including the long Italian line. */
const TAGLINES = LOCALES.map((locale) => {
  const file = resolve(__dirname, `../../../public/locales/${locale}/common.json`);
  const json = JSON.parse(readFileSync(file, 'utf8')) as { app: { tagline: string } };
  return json.app.tagline;
});

const LONG_TAGLINE = TAGLINES.reduce((longest, line) => (line.length > longest.length ? line : longest));

function renderRail(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function wordmark(container: HTMLElement): HTMLElement {
  const column = container.querySelector('.sb-brand > div:not(.sb-mark)');
  expect(column, 'brand column').not.toBeNull();
  return column as HTMLElement;
}

function expectNameOnly(root: HTMLElement): void {
  expect(root.querySelector('.sb-tag')).toBeNull();
  expect(wordmark(root).childElementCount).toBe(1);
  expect(wordmark(root).textContent).toBe(PRODUCT);
  for (const line of TAGLINES) expect(root.textContent ?? '').not.toContain(line);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('shell brand lockup', () => {
  it('shows only the product name when there is no starred account and no recent account', () => {
    // Empty shortcut lists must not be replaced by a tagline under the name.
    const { container } = renderRail('/dashboard');

    expect(container.textContent ?? '').not.toContain('Starred');
    expect(container.textContent ?? '').not.toContain('Recent');
    expectNameOnly(container);
    expect(container.textContent ?? '').toContain('Dust not connected');
  });

  it('keeps a single product name on the lockup', () => {
    const { container } = renderRail('/dashboard');
    const column = wordmark(container);

    expect(column.querySelectorAll('.sb-name')).toHaveLength(1);
    expect(column.querySelector('.sb-name')?.textContent).toBe(PRODUCT);
    expect(column.textContent).toBe(PRODUCT);
    expect(container.querySelector('.sb-toggle')).not.toBeNull();
    expect(container.querySelector('a.sb-item[href="/dashboard"]')).not.toBeNull();
  });

  it('keeps every workspace destination when that section is open, with no second brand line', () => {
    // Many links (the open Workspace section) must not bring the tagline back.
    const { container } = renderRail('/tasks');
    const workspace = container.querySelector('#sb-section-workspace');
    expect(workspace).not.toBeNull();

    const labels = within(workspace as HTMLElement)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toEqual([
      'Tasks',
      'Team Workload',
      'Calendar',
      'Workflows',
      'Custom Objects',
      'Document Intake',
      'Analytics & Reports',
      'CRM Insights',
    ]);
    expectNameOnly(container);
    expect(container.querySelector('a.sb-item[href="/settings"]')).not.toBeNull();
  });

  it('does not render a long translated tagline on the rail or in the drawer', () => {
    // The longest shipped tagline is longer than the product name. None of
    // them, including that long line, belong in the lockup.
    expect(LONG_TAGLINE.length, LONG_TAGLINE).toBeGreaterThan(PRODUCT.length);

    const rail = renderRail('/dashboard');
    expect(rail.container.textContent ?? '', LONG_TAGLINE).not.toContain(LONG_TAGLINE);
    for (const line of TAGLINES) expect(rail.container.textContent ?? '').not.toContain(line);
    expect(wordmark(rail.container).textContent).toBe(PRODUCT);
    cleanup();

    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    useUiStore.setState({ mobileNavOpen: true });
    const drawer = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <MobileNav />
      </MemoryRouter>,
    );
    const dialog = drawer.getByRole('dialog', { name: 'Primary navigation' });
    expect(within(dialog).getByText(PRODUCT)).toBeTruthy();
    for (const line of TAGLINES) expect(dialog.textContent ?? '').not.toContain(line);
    expect(within(dialog).getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('at 1280px the expanded rail is the product name beside the collapse control', () => {
    // 1280 is above 56rem (896px), so the sidebar is the 232px rail. The
    // tagline is the line that gets ellipsized under the collapse control.
    expect(1280).toBeGreaterThanOrEqual(56 * 16);
    mockMatchMedia({ [SHELL_WIDE_QUERY]: true });
    expect(window.matchMedia(SHELL_WIDE_QUERY).matches).toBe(true);

    const { container } = render(
      <div style={{ width: 1280 }}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar />
        </MemoryRouter>
      </div>,
    );

    expect(container.querySelector('.sidebar.is-collapsed')).toBeNull();
    expect(container.querySelector('.sb-toggle')).not.toBeNull();
    expect(container.querySelector('.sb-mark')).not.toBeNull();
    expectNameOnly(container);
  });
});
