import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GovernanceLogCard } from './GovernanceLogCard';
import type { GovernanceMeeting } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  meetings: [] as GovernanceMeeting[],
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

vi.mock('@/hooks/useGovernance', () => ({
  useGovernanceMeetings: () => ({
    data: { items: hookMocks.meetings },
    isLoading: false,
    isError: false,
    error: null,
  }),
  usePatchGovernanceAction: () => ({
    mutate: hookMocks.patchMutate,
    isPending: false,
  }),
  useCreateGovernanceMeeting: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

const meeting: GovernanceMeeting = {
  id: '22222222-2222-4222-8222-222222222222',
  accountKey: 'mantu',
  meetingType: 'quarterly_c_level',
  date: '2026-06-15T00:00:00.000Z',
  participants: ['CIO', 'Country lead'],
  outcomes: 'Executive steering agreed to accelerate workspace rollout.',
  actions: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      meetingId: '22222222-2222-4222-8222-222222222222',
      description: 'Prepare rollout decision pack',
      ownerId: null,
      ownerName: 'Ada Manager',
      dueDate: '2026-07-05T00:00:00.000Z',
      status: 'in_progress',
      createdAt: '2026-06-16T09:30:00.000Z',
    },
  ],
  createdAt: '2026-06-15T09:00:00.000Z',
  updatedAt: '2026-06-16T09:30:00.000Z',
};

describe('GovernanceLogCard trust cues', () => {
  it('shows meeting and action audit cues with a 44px status target', () => {
    hookMocks.meetings = [meeting];

    render(<GovernanceLogCard accountKey="mantu" />);

    expect(screen.getByText('Executive steering agreed to accelerate workspace rollout.')).toBeTruthy();
    expect(screen.getByTestId(`governance-meeting-${meeting.id}-manual-source`).textContent).toBe(
      'Manual meeting',
    );
    expect(
      screen.getByTestId(`governance-meeting-${meeting.id}-manual-source`).getAttribute('aria-label'),
    ).toBe('Manually logged governance meeting created 2026-06-15.');
    expect(screen.getByTestId(`governance-meeting-${meeting.id}-audit-source`).textContent).toBe(
      'Audit logged',
    );

    const action = meeting.actions[0]!;
    expect(screen.getByTestId(`governance-action-${action.id}-manual-source`).textContent).toBe(
      'Manual action',
    );
    expect(
      screen.getByTestId(`governance-action-${action.id}-audit-source`).getAttribute('aria-label'),
    ).toBe('Server mutation audit covers action status and ownership updates.');
    expect(screen.getByTestId(`governance-action-${action.id}-status`).className).toContain('min-h-11');
    expect(screen.getByTestId(`governance-action-${action.id}-status`).className).toContain('min-w-11');
  });
});
