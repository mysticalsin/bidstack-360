import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isSignedIn: true,
  isAdmin: true,
}));

const identityMocks = vi.hoisted(() => ({
  publicRefetch: vi.fn(),
  meRefetch: vi.fn(),
  usePoloPublicIdentity: vi.fn(),
  usePoloMe: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: authMocks.isSignedIn }),
  useIsAdmin: () => authMocks.isAdmin,
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: identityMocks.usePoloPublicIdentity,
  usePoloMe: identityMocks.usePoloMe,
}));

vi.mock('./TeamSection', () => ({
  TeamSection: () => <div>Team section</div>,
}));

import { IdentitySection } from './IdentitySection';

const EMPTY_ALLOWLIST = /No allowlist configured/;

function publicIdentity(overrides: Record<string, unknown> = {}) {
  return {
    data: { dataMode: 'demo', authProvider: 'stub', demoBanner: true, cfAccessEnabled: false },
    isLoading: false,
    isError: false,
    refetch: identityMocks.publicRefetch,
    ...overrides,
  };
}

function meIdentity(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: identityMocks.meRefetch,
    ...overrides,
  };
}

function renderIdentity() {
  identityMocks.usePoloPublicIdentity.mockReturnValue(publicIdentity());
  identityMocks.usePoloMe.mockReturnValue(meIdentity());
  return render(<IdentitySection />);
}

describe('IdentitySection read honesty', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    authMocks.isSignedIn = true;
    authMocks.isAdmin = true;
  });

  it('does not call an allowlist that has not arrived an empty admission list', () => {
    // WHY: the card renders beside the loading skeleton. A missing /api/me
    // payload is not proof that POLO_ALLOWED_USERS is unset.
    identityMocks.usePoloPublicIdentity.mockReturnValue(publicIdentity());
    identityMocks.usePoloMe.mockReturnValue(meIdentity({ isLoading: true }));

    render(<IdentitySection />);

    expect(screen.getByText('Checking the allowlist. It has not arrived.')).toBeTruthy();
    expect(screen.queryByText(EMPTY_ALLOWLIST)).toBeNull();
  });

  it('does not call a failed allowlist read an empty admission list', () => {
    // WHY: a failed /api/me must not send an admin to edit POLO_ALLOWED_USERS
    // as if the workspace had no admission list.
    identityMocks.usePoloPublicIdentity.mockReturnValue(publicIdentity());
    identityMocks.usePoloMe.mockReturnValue(meIdentity({ isError: true }));

    render(<IdentitySection />);

    expect(screen.getByText('Could not load the allowlist.')).toBeTruthy();
    expect(screen.getByText('The allowlist has not arrived.')).toBeTruthy();
    expect(screen.queryByText(EMPTY_ALLOWLIST)).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
    expect(screen.getByText('Demo')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(identityMocks.meRefetch).toHaveBeenCalledTimes(1);
  });

  it('does not tell a signed-out admin that the allowlist is empty', () => {
    // WHY: the me query is not sent until someone is signed in. That absence
    // is not a settled empty allowlist.
    authMocks.isSignedIn = false;
    renderIdentity();

    expect(screen.getByText('Sign in to read the allowlist. It has not arrived.')).toBeTruthy();
    expect(screen.queryByText(EMPTY_ALLOWLIST)).toBeNull();
  });

  it('still says the allowlist is empty after a settled read with no rows', () => {
    identityMocks.usePoloPublicIdentity.mockReturnValue(publicIdentity());
    identityMocks.usePoloMe.mockReturnValue(
      meIdentity({
        data: {
          id: 'user-1',
          email: 'ada@example.com',
          name: 'Ada Example',
          role: 'admin',
          roles: ['admin'],
          dataMode: 'demo',
          authProvider: 'stub',
          allowlist: [],
        },
      }),
    );

    render(<IdentitySection />);

    expect(screen.getByText(EMPTY_ALLOWLIST)).toBeTruthy();
    expect(screen.getByText('Ada Example')).toBeTruthy();
    expect(screen.queryByText('Checking the allowlist. It has not arrived.')).toBeNull();
  });

  it('shows an allowlisted person once the read arrives', () => {
    identityMocks.usePoloPublicIdentity.mockReturnValue(
      publicIdentity({
        data: { dataMode: 'real', authProvider: 'cf-access', demoBanner: false, cfAccessEnabled: true },
      }),
    );
    identityMocks.usePoloMe.mockReturnValue(
      meIdentity({
        data: {
          id: 'user-1',
          email: 'ada@example.com',
          name: 'Ada Example',
          role: 'admin',
          roles: ['admin'],
          dataMode: 'real',
          authProvider: 'cf-access',
          allowlist: [{ email: 'ada@example.com', role: 'admin' }],
        },
      }),
    );

    render(<IdentitySection />);

    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('Real')).toBeTruthy();
    expect(screen.queryByText(EMPTY_ALLOWLIST)).toBeNull();
    expect(screen.queryByText('Demo')).toBeNull();
  });

  it('does not call a missing provider the Jane Smith dev stub', () => {
    // WHY: the stub label is a settled dev provider. A failed identity read
    // has not chosen a provider, and it must not invent that stub.
    identityMocks.usePoloPublicIdentity.mockReturnValue(
      publicIdentity({ data: undefined, isError: true }),
    );
    identityMocks.usePoloMe.mockReturnValue(meIdentity({ isError: true }));

    render(<IdentitySection />);

    expect(screen.queryByText(/Jane Smith/)).toBeNull();
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryByText(EMPTY_ALLOWLIST)).toBeNull();
    expect(screen.getByText('Could not load the auth provider. It has not arrived.')).toBeTruthy();
  });

  it('does not call a failed data-mode read a demo workspace', () => {
    // WHY: Demo is a settled data mode. A missing public identity is not Demo,
    // and a person payload that did arrive stays on screen.
    identityMocks.usePoloPublicIdentity.mockReturnValue(
      publicIdentity({ data: undefined, isError: true }),
    );
    identityMocks.usePoloMe.mockReturnValue(
      meIdentity({
        data: {
          id: 'user-1',
          email: 'ada@example.com',
          name: 'Ada Example',
          role: 'admin',
          roles: ['admin'],
          dataMode: 'real',
          authProvider: 'cf-access',
          allowlist: [],
        },
      }),
    );

    render(<IdentitySection />);

    expect(screen.getByText('Could not load data mode. It has not arrived.')).toBeTruthy();
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.getByText('Ada Example')).toBeTruthy();
    expect(screen.getByText(EMPTY_ALLOWLIST)).toBeTruthy();
  });

  it('says Unknown only after the person payload arrives without a name or email', () => {
    identityMocks.usePoloPublicIdentity.mockReturnValue(publicIdentity());
    identityMocks.usePoloMe.mockReturnValue(
      meIdentity({
        data: {
          id: 'user-1',
          email: null,
          name: null,
          role: 'member',
          roles: [],
          dataMode: 'demo',
          authProvider: 'stub',
          allowlist: [],
        },
      }),
    );

    render(<IdentitySection />);

    expect(screen.getByText('Unknown')).toBeTruthy();
  });
});
