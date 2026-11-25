import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  current: {
    isLoading: false,
    isError: false,
    data: undefined as
      | { authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access'; dataMode: 'demo' | 'real' }
      | undefined,
  },
}));

const session = vi.hoisted(() => ({
  current: {
    isSignedIn: true,
    fullName: 'Ada Admin' as string | null,
    firstName: 'Ada' as string | null,
    email: 'ada.admin@example.test' as string | null,
    role: 'admin' as string | null,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: session.current.isSignedIn, isLoaded: true }),
  useUser: () => ({
    user: session.current.isSignedIn
      ? {
          id: 'demo-user',
          fullName: session.current.fullName,
          firstName: session.current.firstName,
          primaryEmailAddress: session.current.email
            ? { emailAddress: session.current.email }
            : null,
        }
      : null,
  }),
  useRole: () => ({ role: session.current.role }),
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: () => identity.current,
}));

import { ProfileSection } from './ProfileSection';

function renderProfile() {
  render(<ProfileSection />);
}

describe('settings profile under demo data', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    identity.current = { isLoading: false, isError: false, data: undefined };
    session.current = {
      isSignedIn: true,
      fullName: 'Ada Admin',
      firstName: 'Ada',
      email: 'ada.admin@example.test',
      role: 'admin',
    };
  });

  it('does not call the public demo door a development stub', () => {
    // WHY: Settings, Profile is the card on Profile & Security. The public
    // demo answers authProvider demo. The card used to say Dev stub, so a
    // visitor reading synthetic records thought they were on a local stub.
    identity.current = {
      isLoading: false,
      isError: false,
      data: { authProvider: 'demo', dataMode: 'demo' },
    };

    renderProfile();

    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.queryByText(/Stub \(development\)/)).toBeNull();
    expect(screen.getByText('Public demo', { exact: true })).toBeTruthy();
    expect(screen.getByText('Public demo door. These records are synthetic.')).toBeTruthy();
  });

  it('does not relabel the public demo as Clerk when a publishable key is present', () => {
    // WHY: the profile used to treat any Clerk publishable key as production
    // Clerk, even when the server said the door was the public demo. A key in
    // the bundle is not the session. Demo data stays the public demo.
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_demo');
    identity.current = {
      isLoading: false,
      isError: false,
      data: { authProvider: 'demo', dataMode: 'demo' },
    };

    renderProfile();

    expect(screen.queryByText('Clerk', { exact: true })).toBeNull();
    expect(screen.queryByText('Clerk (production)')).toBeNull();
    expect(screen.getByText('Public demo', { exact: true })).toBeTruthy();
  });

  it('does not invent a dev stub while the identity is still loading', () => {
    // WHY: the identity request is what knows demo from stub. Until it
    // answers, the card must not fill the gap with Dev stub.
    identity.current = { isLoading: true, isError: false, data: undefined };

    renderProfile();

    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.queryByText(/Stub \(development\)/)).toBeNull();
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);
  });

  it('does not invent a dev stub when the identity fails to load', () => {
    // WHY: a failed identity request is not a development stub. The card says
    // it could not load.
    identity.current = { isLoading: false, isError: true, data: undefined };

    renderProfile();

    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.getAllByRole('status', { name: 'Could not load' }).length).toBeGreaterThan(0);
  });

  it('does not say a signed-in demo visitor with no email is signed out', () => {
    // WHY: the demo session can be signed in before an email is on the
    // client user. The header used to say Not signed in next to a Signed in
    // badge, and empty name, email, and role were em dashes. Empty stays
    // empty in words.
    identity.current = {
      isLoading: false,
      isError: false,
      data: { authProvider: 'demo', dataMode: 'demo' },
    };
    session.current = {
      isSignedIn: true,
      fullName: null,
      firstName: null,
      email: null,
      role: null,
    };

    renderProfile();

    expect(screen.queryByText('Not signed in')).toBeNull();
    expect(screen.queryByText('Guest')).toBeNull();
    expect(screen.queryByText('\u2014')).toBeNull();
    expect(screen.getByText('No email on file')).toBeTruthy();
    expect(screen.getAllByText('Not on file').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Signed in').length).toBeGreaterThan(0);
  });

  it('does not keep an admin badge on a signed-out demo profile', () => {
    // WHY: the demo auth provider reports role admin even after sign-out.
    // A signed-out profile was still wearing that badge, and empty detail
    // rows were em dashes. Signed out means no role on this card.
    identity.current = {
      isLoading: false,
      isError: false,
      data: { authProvider: 'demo', dataMode: 'demo' },
    };
    session.current = {
      isSignedIn: false,
      fullName: null,
      firstName: null,
      email: null,
      role: 'admin',
    };

    renderProfile();

    expect(screen.queryAllByText('admin')).toHaveLength(0);
    expect(screen.queryAllByText('Admin')).toHaveLength(0);
    expect(screen.queryByText('\u2014')).toBeNull();
    expect(screen.getByText('Guest')).toBeTruthy();
    expect(screen.getAllByText('Not signed in').length).toBeGreaterThan(0);
    expect(screen.getByText('Signed out')).toBeTruthy();
  });

  it('still names a development stub when that is the auth provider', () => {
    // WHY: the demo label is for the public demo door. A local stub session
    // still says Dev stub, so the two doors stay distinct.
    identity.current = {
      isLoading: false,
      isError: false,
      data: { authProvider: 'stub', dataMode: 'demo' },
    };

    renderProfile();

    expect(screen.getByText('Dev stub')).toBeTruthy();
    expect(screen.getByText(/Stub \(development\)/)).toBeTruthy();
    expect(screen.queryByText('Public demo', { exact: true })).toBeNull();
  });

  it('names Cloudflare Access and Clerk from the server provider', () => {
    // WHY: those doors were already labeled. The demo fix must not collapse
    // them into the public demo or the stub.
    identity.current = {
      isLoading: false,
      isError: false,
      data: { authProvider: 'cf-access', dataMode: 'real' },
    };
    renderProfile();
    expect(screen.getByText('Cloudflare Access')).toBeTruthy();
    expect(screen.getByText('Cloudflare Access (per-user email)')).toBeTruthy();
    cleanup();

    identity.current = {
      isLoading: false,
      isError: false,
      data: { authProvider: 'clerk', dataMode: 'real' },
    };
    renderProfile();
    expect(screen.getByText('Clerk')).toBeTruthy();
    expect(screen.getByText('Clerk (production)')).toBeTruthy();
    expect(screen.queryByText('Dev stub')).toBeNull();
  });
});
