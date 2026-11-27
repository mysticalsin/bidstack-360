import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const session = vi.hoisted(() => ({
  signedIn: true,
  fullName: null as string | null,
  email: null as string | null,
  role: 'admin' as string | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: session.signedIn, isLoaded: true }),
  useUser: () => ({
    user: session.signedIn
      ? {
          id: 'demo-user',
          fullName: session.fullName,
          firstName: null,
          primaryEmailAddress: session.email ? { emailAddress: session.email } : null,
        }
      : null,
  }),
  useRole: () => ({ role: session.role }),
  useSignOut: () => ({ signOut: vi.fn() }),
}));

vi.mock('./topbar/TopbarSearch', () => ({ SearchBar: () => null }));
vi.mock('./topbar/TopbarNotifications', () => ({ NotificationsBell: () => null }));
vi.mock('./CurrencySelector', () => ({ CurrencySelector: () => null }));
vi.mock('./OrgCurrencySync', () => ({ OrgCurrencySync: () => null }));

import { Topbar } from './Topbar';

function renderBar() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Topbar />
    </MemoryRouter>,
  );
}

describe('topbar session banner', () => {
  afterEach(() => {
    cleanup();
    session.signedIn = true;
    session.fullName = null;
    session.email = null;
    session.role = 'admin';
  });

  it('does not read an empty demo session as signed out', () => {
    // WHY: the bar is the session banner on every signed-in page. A demo
    // token with no email used to print Not signed in under a made-up name.
    renderBar();

    const who = document.querySelector('.who');
    expect(who?.textContent).toContain('Signed in');
    expect(who?.textContent).toContain('No email on file');
    expect(who?.textContent).toContain('admin');
    expect(who?.textContent).not.toContain('Not signed in');
    expect(who?.textContent).not.toContain('Guest');
    expect(who?.textContent).not.toContain('Demo User');
  });

  it('does not keep an admin chip on an empty sign-out', () => {
    // WHY: demo auth used to report role admin after sign-out. If this bar
    // is still on screen for that render, the chip has to be gone.
    session.signedIn = false;
    session.role = 'admin';

    renderBar();

    const who = document.querySelector('.who');
    expect(who?.textContent).toContain('Guest');
    expect(who?.textContent).toContain('Not signed in');
    expect(who?.textContent).not.toContain('admin');
  });
});
