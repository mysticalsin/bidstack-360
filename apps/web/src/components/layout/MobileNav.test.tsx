// Console-shell drawer: below 56rem the primary nav opens as an in-place
// drawer (rendered inside the app shell, not portalled to <body>). Guards the
// keyboard contract: focus moves in on open, Tab is trapped, Escape and link
// clicks close it, and focus returns to the hamburger.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MobileNav } from './MobileNav';
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

const REDUCE = '(prefers-reduced-motion: reduce)';

function Harness() {
  const toggle = useUiStore((s) => s.toggleMobileNav);
  return (
    <div className="app-shell" data-testid="shell">
      <button type="button" aria-controls="mobile-nav-drawer" onClick={toggle}>
        Open navigation
      </button>
      <MobileNav />
    </div>
  );
}

function renderShell(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  );
}

function openDrawer() {
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Primary navigation' }) };
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.style.overflow = '';
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('MobileNav drawer (below 56rem)', () => {
  it('renders inside the app shell as a dialog named Primary navigation, not in a body portal', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    renderShell();
    const { dialog } = openDrawer();

    expect(screen.getByTestId('shell').contains(dialog)).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('moves focus into the drawer on open', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    renderShell();
    const { dialog } = openDrawer();

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Tab and Shift+Tab inside the drawer', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    renderShell();
    const { dialog } = openDrawer();
    const items = focusables(dialog);
    const first = items[0]!;
    const last = items[items.length - 1]!;

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and returns focus to the hamburger', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    renderShell();
    const { trigger, dialog } = openDrawer();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(useUiStore.getState().mobileNavOpen).toBe(false);
    expect(dialog.getAttribute('data-state')).toBe('closed');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes from the backdrop button', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    renderShell();
    openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));

    expect(useUiStore.getState().mobileNavOpen).toBe(false);
  });

  it('closes when a link is followed', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    renderShell();
    const { trigger, dialog } = openDrawer();

    fireEvent.click(within(dialog).getByRole('link', { name: 'Settings' }));

    expect(useUiStore.getState().mobileNavOpen).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('locks body scroll while open and releases it on close', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
    renderShell();
    openDrawer();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => useUiStore.getState().setMobileNavOpen(false));
    expect(document.body.style.overflow).toBe('');
  });

  it('slides with motion by default and is instant under reduced motion', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: false, [REDUCE]: false });
    const { unmount } = renderShell();
    expect(document.querySelector('.mobile-nav-root')?.getAttribute('data-motion')).toBe('animate');
    unmount();

    mockMatchMedia({ [SHELL_WIDE_QUERY]: false, [REDUCE]: true });
    renderShell();
    expect(document.querySelector('.mobile-nav-root')?.getAttribute('data-motion')).toBe('instant');
  });
});

describe('MobileNav 56rem breakpoint', () => {
  it('renders no drawer from 56rem up, where the sidebar is shown', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: true });
    renderShell();

    expect(document.querySelector('.mobile-nav-root')).toBeNull();
  });

  it('closes a drawer left open when the viewport reaches 56rem', () => {
    mockMatchMedia({ [SHELL_WIDE_QUERY]: true });
    useUiStore.setState({ mobileNavOpen: true });
    renderShell();

    expect(useUiStore.getState().mobileNavOpen).toBe(false);
  });
});
