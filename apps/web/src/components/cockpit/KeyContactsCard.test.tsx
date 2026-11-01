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
  it('says the list is linked people ordered by recorded influence', () => {
    // Why: "key" used to mean the first five names. The caption has to say
    // the list is the company link, capped, and ordered by influence.
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
      screen.getByText('Up to 5 people linked to this account, highest recorded influence first.')
        .textContent,
    ).toContain('linked to this account');
  });
});
