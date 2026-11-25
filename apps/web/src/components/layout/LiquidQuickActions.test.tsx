// The bottom discs are the create control on a phone: there is no N key in
// the thumb zone. A disc named New has to open that record's dialog.
// Landing on the list leaves the form closed, so the name is a lie. The
// company directory is a list, so that disc is named for the list.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { QuickAddMenu } from '@/components/quickadd/QuickAddMenu';
import { useQuickAddStore } from '@/stores/quickAdd';

import { LiquidQuickActions } from './LiquidQuickActions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

// The phone disc only has to choose the entity. QuickAddMenu is the one
// place those dialogs render, so the test mounts that owner and stubs the
// forms. A real form would call the API.
vi.mock('@/components/opportunity/CreateOpportunityDialog', () => ({
  CreateOpportunityDialog: ({ open }: { open?: boolean }) =>
    open ? <div role="dialog" aria-label="New opportunity" /> : null,
}));
vi.mock('@/components/task/CreateTaskDialog', () => ({
  CreateTaskDialog: ({ open }: { open?: boolean }) =>
    open ? <div role="dialog" aria-label="New task" /> : null,
}));
vi.mock('@/components/contact/ContactDialog', () => ({
  ContactDialog: () => null,
}));

function PathProbe() {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
}

function renderActions(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LiquidQuickActions />
      <QuickAddMenu />
      <PathProbe />
    </MemoryRouter>,
  );
}

function openDiscs() {
  fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }));
}

afterEach(() => {
  cleanup();
  useQuickAddStore.setState({ menuOpen: false, pick: null });
});

describe('bottom quick actions on a phone', () => {
  it('opens the opportunity dialog instead of the opportunities list', () => {
    renderActions();
    openDiscs();

    fireEvent.click(screen.getByRole('button', { name: 'New opportunity' }));

    // The list is where a closed form lives. The dialog is the one QuickAddMenu
    // renders for this pick, the same dialog the command palette opens.
    expect(screen.getByTestId('path').textContent).toBe('/dashboard');
    expect(screen.getByRole('dialog', { name: 'New opportunity' })).toBeTruthy();
    expect(useQuickAddStore.getState().pick).toBe('opportunity');
    expect(screen.getByRole('button', { name: 'Quick actions' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('opens the task dialog instead of the tasks list', () => {
    renderActions();
    openDiscs();

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));

    expect(screen.getByTestId('path').textContent).toBe('/dashboard');
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(useQuickAddStore.getState().pick).toBe('task');
  });

  it('names the company directory and opens that list', () => {
    renderActions();
    openDiscs();

    // "New account" is not this directory, and it does not open a form.
    expect(screen.queryByRole('button', { name: 'New account' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));

    expect(screen.getByTestId('path').textContent).toBe('/companies');
    expect(useQuickAddStore.getState().pick).toBeNull();
  });
});
