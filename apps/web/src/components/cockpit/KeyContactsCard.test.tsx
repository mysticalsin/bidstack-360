import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeyContactsCard } from './KeyContactsCard';
import type { AccountCockpitSnapshot } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    motion: {
      li: ({ children, ...props }: { children?: React.ReactNode }) =>
        React.createElement('li', props, children),
    },
    useReducedMotion: () => true,
  };
});

afterEach(() => {
  cleanup();
});

describe('KeyContactsCard', () => {
  it('says buying-role holders lead the five seats', () => {
    // WHY: the list puts an accepted buying role ahead of a louder name.
    // "Highest influence first" described the old order.
    render(
      <KeyContactsCard
        cockpit={
          {
            keyContacts: [
              {
                id: 'ada',
                source: 'external_crm',
                companyId: 'co-1',
                name: 'Ada',
                title: 'CIO',
                email: null,
                phone: null,
                influence: 5,
                roleInDecision: null,
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          } as AccountCockpitSnapshot
        }
      />,
    );

    expect(screen.getByText('Ada').textContent).toBe('Ada');
    expect(
      screen.getByText(
        'Up to 5 linked people. Buying-role holders come first, then highest recorded influence.',
      ),
    ).toBeTruthy();
  });

  it('says some buying-role holders are outside the page', () => {
    // WHY: the role-holder probe stops at 1,000. The five seats are not every holder.
    render(
      <KeyContactsCard
        cockpit={
          {
            contactsCapped: true,
            keyContacts: [
              {
                id: 'ada',
                source: 'external_crm',
                companyId: 'co-1',
                name: 'Ada',
                title: 'CIO',
                email: null,
                phone: null,
                influence: 1,
                roleInDecision: 'champion',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          } as AccountCockpitSnapshot
        }
      />,
    );
    expect(screen.getByText(/Some buying-role holders are outside this page/)).toBeTruthy();
  });
});
