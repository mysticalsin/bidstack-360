// These tests cover the two non-overlapping branches of <AuthProvider>:
//
//  1. Stub mode (no publishableKey) — must mount synchronously without
//     touching @clerk/clerk-react. This is what guarantees that local dev,
//     E2E, and any preview build without a Clerk key never pull the SDK.
//  2. Clerk mode (publishableKey set) — the lazy boundary must yield to its
//     Suspense fallback while the dynamic import resolves. We mock
//     @clerk/clerk-react so the test stays a unit test (no real SDK
//     bootstrap required) and so we can assert the bridge wires through.
//
// Why this matters: Frontend B2 in the 2026-05-10 deep audit. Static-importing
// @clerk/clerk-react inside auth.tsx collapsed ~50 KB gzip into the eager
// chunk. The lazy boundary in auth.tsx is the fix; a regression that re-adds
// a top-level `import '@clerk/clerk-react'` would not break this unit test
// but WOULD break the bundle-size assertion that lives in CI / the audit
// (grep `dist/assets/index-*.js` for "clerk").

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth, useSignOut, useUser } from './auth';
import { api } from './api';

// Mocked Clerk SDK. The real one would attempt to fetch session JWKs and
// throw on a dummy key; we only need the *shape* to validate our bridge.
const clerkGetToken = vi.hoisted(() => vi.fn(async () => 'clerk-token'));
const clerkState = vi.hoisted(
  (): {
    isLoaded: boolean;
    isSignedIn: boolean;
    userId: string | null;
    orgId: string | null;
    orgRole: string | null;
    user: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      fullName: string | null;
      primaryEmailAddress: { emailAddress: string } | null;
    } | null;
  } => ({
    isLoaded: true,
    isSignedIn: true,
    userId: 'clerk-user-1',
    orgId: 'org-a',
    orgRole: 'org:admin',
    user: {
      id: 'clerk-user-1',
      firstName: 'Real',
      lastName: 'User',
      fullName: 'Real User',
      primaryEmailAddress: { emailAddress: 'real@mantu.com' },
    },
  }),
);

vi.mock('@clerk/clerk-react', () => {
  const ClerkProvider = ({ children }: { publishableKey: string; children: ReactNode }) => (
    <div data-testid="mock-clerk-provider">{children}</div>
  );
  return {
    ClerkProvider,
    useAuth: () => ({
      isLoaded: clerkState.isLoaded,
      isSignedIn: clerkState.isSignedIn,
      userId: clerkState.userId,
      orgId: clerkState.orgId,
      orgRole: clerkState.orgRole,
      getToken: clerkGetToken,
    }),
    useUser: () => ({ user: clerkState.user }),
    useClerk: () => ({ signOut: () => Promise.resolve() }),
  };
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clerkGetToken.mockClear();
  clerkGetToken.mockResolvedValue('clerk-token');
  clerkState.isLoaded = true;
  clerkState.isSignedIn = true;
  clerkState.userId = 'clerk-user-1';
  clerkState.orgId = 'org-a';
  clerkState.orgRole = 'org:admin';
  clerkState.user = {
    id: 'clerk-user-1',
    firstName: 'Real',
    lastName: 'User',
    fullName: 'Real User',
    primaryEmailAddress: { emailAddress: 'real@mantu.com' },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useSignOut();
  return (
    <div data-testid="probe">
      <span data-testid="loaded">{String(isLoaded)}</span>
      <span data-testid="signed-in">{String(isSignedIn)}</span>
      <span data-testid="email">{user?.primaryEmailAddress?.emailAddress ?? 'none'}</span>
      <button type="button" onClick={() => signOut()}>
        Sign out
      </button>
    </div>
  );
}

describe('AuthProvider — stub mode (no publishableKey)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mounts synchronously and exposes the stub user when signed in', () => {
    localStorage.setItem('bidstack:session', 'stub');
    render(
      <AuthProvider publishableKey={undefined}>
        <Probe />
      </AuthProvider>,
    );

    // Stub mode has no async boundary — the context is observable on first
    // render. This is the contract App.tsx's RequireAuth depends on so it
    // doesn't briefly redirect to /login during dev.
    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(screen.getByTestId('signed-in').textContent).toBe('true');
    expect(screen.getByTestId('email').textContent).toBe('jane@mantu.com');
  });

  it('defaults to the stub user when no explicit signed-out marker exists', () => {
    render(
      <AuthProvider publishableKey={undefined}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(screen.getByTestId('signed-in').textContent).toBe('true');
    expect(screen.getByTestId('email').textContent).toBe('jane@mantu.com');
  });

  it('preserves explicit stub sign-out across reloads', async () => {
    const { rerender } = render(
      <AuthProvider publishableKey={undefined}>
        <Probe />
      </AuthProvider>,
    );

    screen.getByRole('button', { name: /sign out/i }).click();
    await waitFor(() => {
      expect(screen.getByTestId('signed-in').textContent).toBe('false');
    });

    rerender(
      <AuthProvider publishableKey={undefined}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(screen.getByTestId('signed-in').textContent).toBe('false');
    expect(screen.getByTestId('email').textContent).toBe('none');
  });

  it('treats empty string as missing key (defensive against misconfigured CI)', () => {
    localStorage.setItem('bidstack:session', 'stub');
    // Vite exposes unset env vars as undefined, but a misconfigured CI could
    // set VITE_CLERK_PUBLISHABLE_KEY="" — that must NOT trigger the lazy
    // Clerk branch (it would pull the chunk for nothing and then crash when
    // ClerkProvider rejects the empty key).
    render(
      <AuthProvider publishableKey="">
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(screen.getByTestId('signed-in').textContent).toBe('true');
    expect(screen.getByTestId('email').textContent).toBe('jane@mantu.com');
  });
});

describe('AuthProvider — clerk mode (publishableKey set)', () => {
  it('lazy-loads Clerk and bridges its hooks into the unified context', async () => {
    render(
      <AuthProvider publishableKey="pk_test_dummy">
        <Probe />
      </AuthProvider>,
    );

    // The lazy boundary resolves in a microtask under happy-dom; wait for
    // the bridged Clerk context to surface. The bridged user identity
    // proves we went through ClerkAuthBridge, not StubAuthProvider.
    await waitFor(() => {
      expect(screen.getByTestId('email').textContent).toBe('real@mantu.com');
    });
    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(screen.getByTestId('signed-in').textContent).toBe('true');
    expect(screen.getByTestId('mock-clerk-provider')).toBeDefined();
  });

  it('maps forced API token refreshes to Clerk skipCache calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Token expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider publishableKey="pk_test_dummy">
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('email').textContent).toBe('real@mantu.com');
    });

    await expect(api('/api/session-check')).resolves.toEqual({ ok: true });

    expect(clerkGetToken).toHaveBeenNthCalledWith(1, undefined);
    expect(clerkGetToken).toHaveBeenNthCalledWith(2, { skipCache: true });
  });

  it('includes the active Clerk organization and role in the cache identity marker', async () => {
    render(
      <AuthProvider publishableKey="pk_test_dummy">
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('email').textContent).toBe('real@mantu.com');
    });

    expect(localStorage.getItem('bidstack:session')).toBe('clerk-user-1:org-a:org:admin');
  });

  it('updates the Clerk cache identity marker when the active role changes', async () => {
    const { rerender } = render(
      <AuthProvider publishableKey="pk_test_dummy">
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(localStorage.getItem('bidstack:session')).toBe('clerk-user-1:org-a:org:admin');
    });

    clerkState.orgRole = 'org:member';

    rerender(
      <AuthProvider publishableKey="pk_test_dummy">
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(localStorage.getItem('bidstack:session')).toBe('clerk-user-1:org-a:org:member');
    });
  });

  it('does not treat a stale local session marker as valid Clerk auth', async () => {
    localStorage.setItem('bidstack:session', 'stale-clerk-user');
    clerkState.isSignedIn = false;
    clerkState.userId = null;
    clerkState.orgId = null;
    clerkState.user = null;

    render(
      <AuthProvider publishableKey="pk_test_dummy">
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loaded').textContent).toBe('true');
    });

    expect(screen.getByTestId('signed-in').textContent).toBe('false');
    expect(screen.getByTestId('email').textContent).toBe('none');
    expect(localStorage.getItem('bidstack:session')).toBeNull();
  });
});
