import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CrossSellCard } from './CrossSellCard';
import type { CrossSellAction } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  actions: [] as CrossSellAction[],
  patchMutate: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => false,
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
    isPending: false,
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
    expect(screen.getByTestId(`cross-sell-${action.id}-status`).className).toContain('min-h-11');
    expect(screen.getByTestId(`cross-sell-${action.id}-status`).className).toContain('min-w-11');
  });
});
