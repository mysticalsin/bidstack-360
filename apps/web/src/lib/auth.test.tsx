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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth, useUser } from './auth';

// Mocked Clerk SDK. The real one would attempt to fetch session JWKs and
// throw on a dummy key; we only need the *shape* to validate our bridge.
vi.mock('@clerk/clerk-react', () => {
  const ClerkProvider = ({ children }: { publishableKey: string; children: ReactNode }) => (
    <div data-testid="mock-clerk-provider">{children}</div>
  );
  return {
    ClerkProvider,
    useAuth: () => ({ isLoaded: true, isSignedIn: true }),
    useUser: () => ({
      user: {
        id: 'clerk-user-1',
        firstName: 'Real',
        lastName: 'User',
        fullName: 'Real User',
        primaryEmailAddress: { emailAddress: 'real@mantu.com' },
      },
    }),
    useClerk: () => ({ signOut: () => Promise.resolve() }),
  };
});

afterEach(() => {
  cleanup();
});

function Probe() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  return (
    <div data-testid="probe">
      <span data-testid="loaded">{String(isLoaded)}</span>
      <span data-testid="signed-in">{String(isSignedIn)}</span>
      <span data-testid="email">{user?.primaryEmailAddress?.emailAddress ?? 'none'}</span>
    </div>
  );
}

describe('AuthProvider — stub mode (no publishableKey)', () => {
  it('mounts synchronously and exposes the stub user without throwing', () => {
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

  it('treats empty string as missing key (defensive against misconfigured CI)', () => {
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
});
