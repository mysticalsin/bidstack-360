import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContactsPanel } from './ContactsPanel';

const hookMocks = vi.hoisted(() => ({
  contacts: {
    isLoading: false,
    isError: false,
    data: undefined as { items: Array<{ id: string; contactId: string; role: string; isPrimary: boolean; contact: { name: string; email: string | null } }>; contactsContinue?: boolean } | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useOpportunityContacts', () => ({
  useOpportunityContacts: () => hookMocks.contacts,
  useLinkContact: () => ({ mutateAsync: vi.fn(), mutate: vi.fn() }),
  useUnlinkContact: () => ({ mutate: vi.fn() }),
  useUpdateContactRole: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [] } }),
}));

describe('deal contacts wait for the read', () => {
  afterEach(() => {
    cleanup();
    hookMocks.contacts = { isLoading: false, isError: false, data: undefined };
  });

  it('does not call an unread deal an empty buying group', () => {
    hookMocks.contacts = { isLoading: false, isError: false, data: undefined };
    render(<ContactsPanel oppId="opp-1" />);
    expect(screen.getByText('Checking the buying group.')).toBeTruthy();
    expect(screen.queryByText('No linked contacts')).toBeNull();
    expect(screen.queryByText('0 contacts')).toBeNull();
  });

  it('says the read failed instead of showing an empty buying group', () => {
    hookMocks.contacts = { isLoading: false, isError: true, data: undefined };
    render(<ContactsPanel oppId="opp-1" />);
    expect(screen.getByRole('alert').textContent).toBe('Could not load the buying group.');
    expect(screen.queryByText('No linked contacts')).toBeNull();
  });

  it('keeps a settled empty list empty', () => {
    hookMocks.contacts = { isLoading: false, isError: false, data: { items: [], contactsContinue: false } };
    render(<ContactsPanel oppId="opp-1" />);
    expect(screen.getByText('No linked contacts')).toBeTruthy();
  });

  it('shows a loaded person', () => {
    hookMocks.contacts = {
      isLoading: false,
      isError: false,
      data: {
        items: [
          {
            id: 'link-1',
            contactId: 'c-1',
            role: 'decision_maker',
            isPrimary: true,
            contact: { name: 'Michael Johnson', email: 'mjohnson@ci.com' },
          },
        ],
        contactsContinue: false,
      },
    };
    render(<ContactsPanel oppId="opp-1" />);
    expect(screen.getByText('Michael Johnson')).toBeTruthy();
    expect(screen.getByText('1 contact')).toBeTruthy();
  });
});
