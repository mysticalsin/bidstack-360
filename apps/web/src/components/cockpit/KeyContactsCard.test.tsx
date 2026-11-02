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
    expect(screen.queryByText(/not every contact/i)).toBeNull();
  });

  it('does not describe five names as every contact when another person exists', () => {
    // WHY: the card used to caption the loaded five as the people on the
    // account. A sixth name, or keyContactsTruncated from contactCount, means
    // that page is not every linked contact.
    const person = (id: string) =>
      ({
        id,
        source: 'external_crm',
        companyId: 'co-1',
        name: id,
        title: null,
        email: null,
        phone: null,
        influence: 1,
        roleInDecision: null,
        updatedAt: '2026-06-01T00:00:00.000Z',
      }) as const;

    const { unmount } = render(
      <KeyContactsCard
        cockpit={
          {
            keyContacts: ['Ada', 'Bea', 'Cara', 'Dia', 'Eve', 'Fay'].map(person),
          } as AccountCockpitSnapshot
        }
      />,
    );
    expect(screen.getByText('5 in the latest 5, not every contact').textContent).toBe(
      '5 in the latest 5, not every contact',
    );
    expect(screen.queryByText('Fay')).toBeNull();
    expect(
      screen.queryByText(
        'Up to 5 people linked to this account, highest recorded influence first.',
      ),
    ).toBeNull();
    unmount();

    render(
      <KeyContactsCard
        cockpit={
          {
            keyContacts: ['Ada', 'Bea', 'Cara', 'Dia', 'Eve'].map(person),
            keyContactsTruncated: true,
          } as AccountCockpitSnapshot
        }
      />,
    );
    expect(screen.getByText('5 in the latest 5, not every contact')).toBeTruthy();
    expect(screen.getByText('Eve')).toBeTruthy();
  });
});
