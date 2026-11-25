// The floating "+" is on every page and names three creates. Each one used to
// land on a list (opportunities, companies, tasks), so the promised record
// still needed a second click. Opportunity and task already have global
// dialogs; a new account is the companies create form. These tests fail if
// a label goes back to opening the bare list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '@/i18n';

import { useQuickAddStore } from '@/stores/quickAdd';

import { LiquidQuickActions } from './LiquidQuickActions';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{`${location.pathname}${location.search}`}</div>;
}

function renderFab() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LiquidQuickActions />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function openActions() {
  fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }));
}

describe('LiquidQuickActions — create, not a second click on a list', () => {
  beforeEach(() => {
    useQuickAddStore.setState({ menuOpen: false, pick: null });
  });

  afterEach(() => {
    cleanup();
    useQuickAddStore.setState({ menuOpen: false, pick: null });
  });

  it('opens the opportunity dialog instead of the opportunities list', () => {
    renderFab();
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'New opportunity' }));

    expect(useQuickAddStore.getState().pick).toBe('opportunity');
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('opens the task dialog instead of the tasks list', () => {
    renderFab();
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));

    expect(useQuickAddStore.getState().pick).toBe('task');
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('opens the company create form instead of the bare companies list', () => {
    renderFab();
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'New account' }));

    expect(useQuickAddStore.getState().pick).toBeNull();
    expect(screen.getByTestId('loc').textContent).toBe('/companies?new=1');
  });
});
