import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CrossSellCard } from './CrossSellCard';
import type { CrossSellAction } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  actions: [] as CrossSellAction[],
  patchMutate: vi.fn(),
  patchIsPending: false,
  patchVariables: undefined as { id: string } | undefined,
  canWrite: false,
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

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({ data: [] }),
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
    isPending: hookMocks.patchIsPending,
    variables: hookMocks.patchVariables,
  }),
  useCreateCrossSellAction: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

const action: CrossSellAction = {
  id: '11111111-1111-4111-8111-111111111111',
  accountKey: 'mantu',
  description: 'Coordinate SAP expansion with Germany delivery team',
  requestingUnit: 'France',
  assignedUnit: 'Germany',
  assigneeId: null,
  assigneeName: 'Ada Manager',
  dueDate: '2026-07-01T00:00:00.000Z',
  status: 'open',
  notes: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-03T12:00:00.000Z',
};

const secondAction: CrossSellAction = {
  ...action,
  id: '22222222-2222-4222-8222-222222222222',
  description: 'Introduce cybersecurity offer to UK account team',
  requestingUnit: 'Germany',
  assignedUnit: 'UK',
};

beforeEach(() => {
  cleanup();
  hookMocks.actions = [];
  hookMocks.patchIsPending = false;
  hookMocks.patchVariables = undefined;
  hookMocks.canWrite = false;
});

describe('CrossSellCard trust cues', () => {
  it('shows manual and audit provenance cues with a 44px status target', () => {
    hookMocks.actions = [action];

    render(<CrossSellCard accountKey="mantu" />);

    expect(screen.getByText(action.description)).toBeTruthy();
    expect(screen.getByTestId(`cross-sell-${action.id}-manual-source`).textContent).toBe(
      'Manual action',
    );
    expect(
      screen.getByTestId(`cross-sell-${action.id}-manual-source`).getAttribute('aria-label'),
    ).toBe('Manually logged cross-sell action created 2026-06-01.');
    expect(screen.getByTestId(`cross-sell-${action.id}-audit-source`).textContent).toBe(
      'Audit logged',
    );
    expect(
      screen.getByTestId(`cross-sell-${action.id}-audit-source`).getAttribute('aria-label'),
    ).toBe('Server mutation audit covers create/update/delete events. Last updated 2026-06-03.');
    expect(screen.getByTestId(`cross-sell-${action.id}-status-badge`).textContent).toBe('Open');
    expect(screen.getByTestId(`cross-sell-${action.id}-status`).textContent).toContain('Start');
    expect(screen.getByTestId(`cross-sell-${action.id}-status`).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByTestId(`cross-sell-${action.id}-status`).className).toContain('min-h-11');
    expect(screen.getByTestId(`cross-sell-${action.id}-status`).className).toContain('min-w-11');
  });

  it('scopes the busy state to the row being patched so other rows stay actionable', () => {
    // WHY: the card shares one mutation object across every row. If its
    // pending flag is passed unscoped, patching action A disables and
    // relabels B's button "updating..." — misrepresenting per-action state
    // in a governance feature whose whole point is who-owns-what accuracy.
    hookMocks.actions = [action, secondAction];
    hookMocks.canWrite = true;
    hookMocks.patchIsPending = true;
    hookMocks.patchVariables = { id: action.id };

    render(<CrossSellCard accountKey="mantu" />);

    const busyButton = screen.getByTestId(`cross-sell-${action.id}-status`);
    expect(busyButton.hasAttribute('disabled')).toBe(true);
    expect(busyButton.textContent).toContain('updating...');

    const idleButton = screen.getByTestId(`cross-sell-${secondAction.id}-status`);
    expect(idleButton.hasAttribute('disabled')).toBe(false);
    expect(idleButton.textContent).toContain('Start');
  });
});
