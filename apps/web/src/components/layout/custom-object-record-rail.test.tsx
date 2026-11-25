// Custom object records live at /o/:objectKey and /o/:objectKey/:recordId.
// The rail door is Custom Objects, whose href is /settings/custom-objects.
// Opening "View records" from that door left Workspace shut, so the record
// had no current item. A remembered collapse left Sales open and Workspace
// shut. The phone drawer is a separate change. This file guards the expanded
// rail, the stale accordion, and the collapsed-rail flyout.
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

const LIST = '/o/sample-object';
const RECORD = '/o/sample-object/sample-record';

function renderSidebar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function objectsLink() {
  return screen.getByRole('link', { name: 'Custom Objects', exact: true });
}

function workspaceExpanded(): string | null {
  return screen.getByRole('button', { name: 'Workspace' }).getAttribute('aria-expanded');
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('rail on a custom object record', () => {
  it('marks Custom Objects current and opens Workspace', () => {
    renderSidebar(LIST);

    expect(workspaceExpanded()).toBe('true');
    const objects = objectsLink();
    expect(objects.getAttribute('aria-current')).toBe('page');
    // The door still opens the object admin. The record list is where you
    // are, not a new href.
    expect(objects.getAttribute('href')).toBe('/settings/custom-objects');
    expect(screen.getByRole('link', { name: 'Settings', exact: true }).getAttribute('aria-current')).toBeNull();
  });

  it('opens Workspace when a previous visit left it shut and Sales open', () => {
    useUiStore.setState({ collapsedSections: { workspace: true, sales: false } });

    renderSidebar(LIST);

    expect(workspaceExpanded()).toBe('true');
    expect(objectsLink().getAttribute('aria-current')).toBe('page');
    expect(useUiStore.getState().collapsedSections.workspace).toBe(false);
    expect(useUiStore.getState().collapsedSections.sales).toBe(true);
  });

  it('marks Custom Objects current in the collapsed-rail flyout', () => {
    useUiStore.setState({ sidebarCollapsed: true });

    renderSidebar(LIST);

    const objects = objectsLink();
    expect(objects.getAttribute('aria-current')).toBe('page');
    expect(objects.getAttribute('href')).toBe('/settings/custom-objects');
  });

  it('marks Custom Objects current on a record', () => {
    renderSidebar(RECORD);

    const objects = objectsLink();
    expect(objects.getAttribute('aria-current')).toBe('page');
    expect(objects.getAttribute('href')).toBe('/settings/custom-objects');
    expect(workspaceExpanded()).toBe('true');
  });

  it('still marks Custom Objects current on its own door', () => {
    renderSidebar('/settings/custom-objects');

    const objects = objectsLink();
    expect(objects.getAttribute('aria-current')).toBe('page');
    expect(objects.getAttribute('href')).toBe('/settings/custom-objects');
    expect(workspaceExpanded()).toBe('true');
  });

  it('does not treat a deeper object path as this door', () => {
    useUiStore.setState({ collapsedSections: { workspace: false } });

    renderSidebar('/o/sample-object/sample-record/extra');

    expect(objectsLink().getAttribute('aria-current')).toBeNull();
  });

  it('does not treat the deal board as a custom object record', () => {
    useUiStore.setState({ collapsedSections: { workspace: true, pipeline: false } });

    renderSidebar('/pipeline');

    expect(workspaceExpanded()).toBe('false');
    expect(useUiStore.getState().collapsedSections.workspace).toBe(true);
  });
});
