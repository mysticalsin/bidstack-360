import { beforeEach, describe, expect, it } from 'vitest';

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
});
