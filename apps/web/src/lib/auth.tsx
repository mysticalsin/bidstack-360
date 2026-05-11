// Auth abstraction that supports both Clerk (production) and stub mode (dev/E2E).
// When VITE_CLERK_PUBLISHABLE_KEY is missing, we bypass Clerk entirely and
// pretend the user is authenticated. This keeps E2E and local dev working
// without external auth dependencies.
//
// Hook safety: which provider is active is fixed at AuthProvider mount
// time. We expose ONE shared context (AuthCtx) and split the implementation
// into two non-overlapping subtrees. Consumers always call the same hooks
// in the same order — Rules of Hooks satisfied.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import {
  ClerkProvider,
  useAuth as useClerkAuth,
  useUser as useClerkUser,
  useClerk,
} from '@clerk/clerk-react';

interface AuthUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
}

interface AuthCtx {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AuthUser | null;
  signOut: (cb?: () => void) => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

const STUB_USER: AuthUser = {
  id: 'stub-user-1',
  firstName: 'Jane',
  lastName: 'Smith',
  fullName: 'Jane Smith',
  primaryEmailAddress: { emailAddress: 'jane@mantu.com' },
};

function StubAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(true);

  const signOut = useCallback((cb?: () => void) => {
    setSignedIn(false);
    cb?.();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isLoaded: true,
        isSignedIn: signedIn,
        user: signedIn ? STUB_USER : null,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Bridges Clerk's hook outputs into the unified AuthCtx. Mounted only when
// a publishableKey is configured.
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const auth = useClerkAuth();
  const { user } = useClerkUser();
  const clerk = useClerk();

  return (
    <AuthContext.Provider
      value={{
        isLoaded: auth.isLoaded,
        isSignedIn: auth.isSignedIn ?? false,
        user: user
          ? {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              fullName: user.fullName,
              primaryEmailAddress: user.primaryEmailAddress
                ? { emailAddress: user.primaryEmailAddress.emailAddress }
                : null,
            }
          : null,
        signOut: (cb) => {
          void clerk.signOut().then(() => cb?.());
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({
  publishableKey,
  children,
}: {
  publishableKey: string | undefined;
  children: ReactNode;
}) {
  if (!publishableKey) {
    return <StubAuthProvider>{children}</StubAuthProvider>;
  }
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

function useAuthCtx(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth/useUser/useSignOut must be used inside <AuthProvider>');
  }
  return ctx;
}

export function useAuth(): { isLoaded: boolean; isSignedIn: boolean } {
  const ctx = useAuthCtx();
  return { isLoaded: ctx.isLoaded, isSignedIn: ctx.isSignedIn };
}

export function useUser(): { user: AuthUser | null } {
  const ctx = useAuthCtx();
  return { user: ctx.user };
}

export function useSignOut() {
  const ctx = useAuthCtx();
  return { signOut: ctx.signOut };
}
