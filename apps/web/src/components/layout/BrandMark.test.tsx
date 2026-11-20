// Guards the rail and drawer brand mark against the old purple/magenta
// leftover: both must paint the full-color Polo compass pin (gradient fills,
// gold star) instead of a single-ink white silhouette.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MobileNav } from './MobileNav';
import { SHELL_WIDE_QUERY } from './shellBreakpoint';
import { Sidebar } from './Sidebar';
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

const OLD_BRAND = /#3f16e8|#7a1fd6|#e4069f/i;

function expectColoredMark(root: ParentNode): void {
  const mark = root.querySelector('.sb-mark svg');
  expect(mark).not.toBeNull();
  const fills = Array.from(mark!.querySelectorAll('path')).map((p) => p.getAttribute('fill') ?? '');
  expect(fills.length).toBeGreaterThanOrEqual(2);
  for (const fill of fills) {
    expect(fill).toMatch(/^url\(#polo-(pin|star)-/);
  }
  expect(mark!.querySelector('linearGradient stop[stop-color="#14B8D2"]')).not.toBeNull();
  expect(mark!.querySelector('linearGradient stop[stop-color="#E0A44A"]')).not.toBeNull();
  expect(mark!.getAttribute('class') ?? '').not.toContain('text-white');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('brand mark', () => {
  it('sidebar shows the full-color Polo mark, expanded and collapsed', () => {
    const expanded = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expectColoredMark(expanded.container);
    cleanup();

    useUiStore.setState({ sidebarCollapsed: true });
    const collapsed = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expectColoredMark(collapsed.container);
  });

  it('mobile drawer shows the full-color Polo mark', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    useUiStore.setState({ mobileNavOpen: true });
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>,
    );
    expectColoredMark(document.body);
  });

  it('rail badge, favicon and manifest carry no old purple/magenta brand colors', () => {
    const root = resolve(__dirname, '../../..');
    const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
    const badge = css.slice(css.indexOf('.sb-mark {'), css.indexOf('.sb-name {'));
    expect(badge).toContain('#071422');
    expect(badge).not.toMatch(OLD_BRAND);

    const icon = readFileSync(resolve(root, 'public/icon.svg'), 'utf8');
    expect(icon).not.toMatch(OLD_BRAND);
    expect(icon).toContain('#071422');
    expect(icon).toContain('#14B8D2');

    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8')) as { theme_color: string };
    expect(manifest.theme_color).not.toMatch(OLD_BRAND);
  });
});
