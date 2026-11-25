import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  current: {
    isLoading: false,
    isError: false,
    data: undefined as
      | { authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access' }
      | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: true, isLoaded: true }),
  useUser: () => ({
    user: {
      fullName: 'Ada Visitor',
      firstName: 'Ada',
      primaryEmailAddress: { emailAddress: 'ada.visitor@example.test' },
    },
  }),
  useRole: () => ({ role: 'admin' }),
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: () => identity.current,
}));

import { profileAuthLabel } from './profile-auth-provider';
import { ProfileSection } from './ProfileSection';

function settled(
  authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access',
): void {
  identity.current = { isLoading: false, isError: false, data: { authProvider } };
}

describe('settings profile auth provider', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    identity.current = { isLoading: false, isError: false, data: undefined };
  });

  it('does not call a demo session a dev stub', () => {
    // WHY: Profile sits on Profile & Security. The identity answer already
    // names the passwordless demo door. The card ignored that and said Dev
    // stub over synthetic records.
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    settled('demo');

    render(<ProfileSection />);

    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.queryByText(/Stub \(development\)/)).toBeNull();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('Demo session')).toBeTruthy();
  });

  it('does not call a demo session Clerk when a publishable key is also set', () => {
    // WHY: a demo bundle can still carry a Clerk publishable key. The card
    // treated any key as Clerk (production). Auth for that bundle is the
    // demo door, and the identity answer says demo.
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_present');
    settled('demo');

    render(<ProfileSection />);

    expect(screen.queryByText('Clerk')).toBeNull();
    expect(screen.queryByText('Clerk (production)')).toBeNull();
    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('Demo session')).toBeTruthy();
  });

  it('does not invent a dev stub while the identity answer is still loading', () => {
    // WHY: until /api/identity answers, the card filled the gap with the
    // build key. A demo with no key flashed Dev stub. The row waits.
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    identity.current = { isLoading: true, isError: false, data: undefined };

    render(<ProfileSection />);

    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.queryByText('Clerk (production)')).toBeNull();
    expect(screen.getAllByRole('status', { name: 'Loading' })).toHaveLength(2);
  });

  it('does not invent Clerk when the identity answer fails', () => {
    // WHY: a failed identity request is not evidence of a production Clerk
    // session. A publishable key must not fill that gap.
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_present');
    identity.current = { isLoading: false, isError: true, data: undefined };

    render(<ProfileSection />);

    expect(screen.queryByText('Clerk')).toBeNull();
    expect(screen.queryByText('Clerk (production)')).toBeNull();
    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.getAllByRole('status', { name: 'Could not load' })).toHaveLength(2);
  });

  it('keeps Clerk when the identity answer is clerk', () => {
    // WHY: the demo label is only for the demo door. A Clerk session still
    // shows Clerk and Clerk (production).
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_present');
    settled('clerk');

    render(<ProfileSection />);

    expect(screen.getByText('Clerk')).toBeTruthy();
    expect(screen.getByText('Clerk (production)')).toBeTruthy();
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryByText('Demo session')).toBeNull();
  });

  it('keeps the local stub labeled as the dev stub', () => {
    // WHY: a stub identity is the local door. It still says Dev stub, and it
    // does not say Demo.
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    settled('stub');

    render(<ProfileSection />);

    expect(screen.getByText('Dev stub')).toBeTruthy();
    expect(screen.getByText(/Stub \(development\)/)).toBeTruthy();
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryByText('Demo session')).toBeNull();
  });

  it('keeps Cloudflare Access when that is the identity answer', () => {
    // WHY: Cloudflare Access is a real per-user door. Naming the demo must
    // not relabel it.
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    settled('cf-access');

    render(<ProfileSection />);

    expect(screen.getByText('Cloudflare Access')).toBeTruthy();
    expect(screen.getByText('Cloudflare Access (per-user email)')).toBeTruthy();
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryByText('Dev stub')).toBeNull();
  });
});

describe('profileAuthLabel', () => {
  it('names the reported door and leaves a missing answer unlabeled', () => {
    // WHY: the profile card exists so a visitor can see which door they
    // used. Demo stays demo. Clerk, Cloudflare Access, and the local stub
    // stay themselves. A load, a failure, or a ready payload with no
    // provider is not a door.
    expect(profileAuthLabel({ status: 'ready', authProvider: 'demo' })).toEqual({
      state: 'ready',
      kind: 'demo',
    });
    expect(profileAuthLabel({ status: 'ready', authProvider: 'clerk' })).toEqual({
      state: 'ready',
      kind: 'clerk',
    });
    expect(profileAuthLabel({ status: 'ready', authProvider: 'cf-access' })).toEqual({
      state: 'ready',
      kind: 'cf-access',
    });
    expect(profileAuthLabel({ status: 'ready', authProvider: 'stub' })).toEqual({
      state: 'ready',
      kind: 'stub',
    });
    expect(profileAuthLabel({ status: 'loading', authProvider: 'demo' })).toEqual({
      state: 'loading',
    });
    expect(profileAuthLabel({ status: 'error', authProvider: 'clerk' })).toEqual({
      state: 'error',
    });
    expect(profileAuthLabel({ status: 'ready', authProvider: null })).toEqual({
      state: 'error',
    });
    expect(profileAuthLabel({ status: 'ready' })).toEqual({ state: 'error' });
  });
});
