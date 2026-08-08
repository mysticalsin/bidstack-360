import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from './ui';

describe('useUiStore sidebar shell state', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.sidebarCollapsed;
    useUiStore.setState({
      sidebarCollapsed: false,
      collapsedSections: {},
      mobileNavOpen: false,
    });
  });

  it('updates the document sidebar flag immediately so the grid can resize without re-rendering the page', () => {
    useUiStore.getState().setSidebarCollapsed(true);

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(document.documentElement.dataset.sidebarCollapsed).toBe('true');

    useUiStore.getState().setSidebarCollapsed(false);

    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    expect(document.documentElement.dataset.sidebarCollapsed).toBeUndefined();
  });

  it('keeps section disclosure updates scoped to the sidebar state', () => {
    useUiStore.getState().toggleSection('sales');

    expect(useUiStore.getState().collapsedSections.sales).toBe(true);
    expect(document.documentElement.dataset.sidebarCollapsed).toBeUndefined();
  });

  it('closes every other section when one is expanded, so the rail never needs a scrollbar', () => {
    useUiStore.getState().setSectionCollapsed('accounts', false);
    expect(useUiStore.getState().collapsedSections.accounts).toBe(false);

    useUiStore.getState().setSectionCollapsed('pipeline', false);

    const sections = useUiStore.getState().collapsedSections;
    expect(sections.pipeline).toBe(false);
    expect(sections.accounts).toBe(true);
  });

  it('migrates pre-accordion state where multiple sections were left expanded', async () => {
    // Two sections stuck expanded, as real localStorage looked before the
    // accordion was enforced (every independent toggle persisted forever).
    localStorage.setItem(
      'bidstack-ui.v1',
      JSON.stringify({
        sidebarCollapsed: false,
        collapsedSections: { sales: false, accounts: false, pipeline: true },
      }),
    );

    // The migration runs at module load time, so force a fresh import to
    // observe it — the module already imported above ran its migration
    // against whatever localStorage held before this test.
    vi.resetModules();
    const fresh = await import('./ui');

    // No route context exists at load time to pick a "correct" survivor, so
    // the migration drops all overrides and lets each component fall back to
    // its own active-route default instead of shipping two sections open.
    expect(fresh.useUiStore.getState().collapsedSections).toEqual({});
  });
});
