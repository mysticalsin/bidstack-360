import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrossSellAction } from '@bidstack/shared';

import CrossSellPage from './CrossSellPage';

const hookMocks = vi.hoisted(() => ({
  actions: [] as CrossSellAction[],
  patchMutate: vi.fn(),
  canWrite: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => hookMocks.canWrite,
}));

vi.mock('@/hooks/useCrossSell', () => ({
  useCrossSellActions: () => ({
    data: { items: hookMocks.actions },
    isLoading: false,
    isError: false,
    error: null,
  }),
  usePatchCrossSellAction: () => ({
    mutate: hookMocks.patchMutate,
    isPending: false,
    variables: undefined,
  }),
}));

function action(overrides: Partial<CrossSellAction>): CrossSellAction {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    accountKey: 'siemens',
    description: 'Coordinate SAP expansion with Germany delivery team',
    requestingUnit: 'France',
    assignedUnit: 'Germany',
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
    status: 'open',
    notes: null,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-03T12:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CrossSellPage />
    </MemoryRouter>,
  );
}

describe('CrossSellPage', () => {
  beforeEach(() => {
    hookMocks.actions = [];
    hookMocks.patchMutate.mockReset();
    hookMocks.canWrite = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('summarizes active, overdue, unassigned, and next-due actions', () => {
    hookMocks.actions = [
      action({
        id: '11111111-1111-4111-8111-111111111111',
        dueDate: '2020-01-01T00:00:00.000Z',
        status: 'open',
      }),
      action({
        id: '22222222-2222-4222-8222-222222222222',
        accountKey: 'hsbc',
        assigneeId: '33333333-3333-4333-8333-333333333333',
        assigneeName: 'Ari Owner',
        dueDate: '2099-01-01T00:00:00.000Z',
        status: 'in_progress',
      }),
      action({
        id: '44444444-4444-4444-8444-444444444444',
        accountKey: 'sanofi',
        dueDate: '2020-01-02T00:00:00.000Z',
        status: 'done',
      }),
    ];

    renderPage();

    expect(screen.getByTestId('cross-sell-active-count').textContent).toBe('2');
    expect(screen.getByTestId('cross-sell-overdue-count').textContent).toBe('1');
    expect(screen.getByTestId('cross-sell-unassigned-count').textContent).toBe('1');
    expect(screen.getByTestId('cross-sell-next-due').textContent).toBe('2020-01-01');
    expect(screen.getByText('Needs owner')).toBeTruthy();
    expect(screen.getByText('Ready to start')).toBeTruthy();
    expect(screen.getByText('In motion')).toBeTruthy();
    expect(screen.getByText('Overdue 2020-01-01')).toBeTruthy();
    expect(screen.getByText('Ari Owner')).toBeTruthy();
  });

  it('uses explicit commands to start, complete, and reopen actions', () => {
    hookMocks.actions = [
      action({ id: '11111111-1111-4111-8111-111111111111', status: 'open' }),
      action({ id: '22222222-2222-4222-8222-222222222222', status: 'in_progress' }),
      action({ id: '44444444-4444-4444-8444-444444444444', status: 'done' }),
    ];

    renderPage();

    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByText('Mark done')).toBeTruthy();
    expect(screen.getByText('Reopen')).toBeTruthy();

    fireEvent.click(screen.getByTestId('cross-sell-11111111-1111-4111-8111-111111111111-status'));
    fireEvent.click(screen.getByTestId('cross-sell-22222222-2222-4222-8222-222222222222-status'));
    fireEvent.click(screen.getByTestId('cross-sell-44444444-4444-4444-8444-444444444444-status'));

    expect(hookMocks.patchMutate).toHaveBeenCalledWith(
      { id: '11111111-1111-4111-8111-111111111111', body: { status: 'in_progress' } },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    );
    expect(hookMocks.patchMutate).toHaveBeenCalledWith(
      { id: '22222222-2222-4222-8222-222222222222', body: { status: 'done' } },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    );
    expect(hookMocks.patchMutate).toHaveBeenCalledWith(
      { id: '44444444-4444-4444-8444-444444444444', body: { status: 'open' } },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    );
  });
});
