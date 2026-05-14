// Auth abstraction that supports both Clerk (production) and stub mode (dev/E2E).
// When VITE_CLERK_PUBLISHABLE_KEY is missing, we bypass Clerk entirely and
// pretend the user is authenticated. This keeps E2E and local dev working
// without external auth dependencies.
//
// Role source of truth:
//   Production (Clerk): orgRole from Clerk's useAuth() hook / JWT payload.
//   Dev (stub): hardcoded 'admin' (first seed user is admin).
//
// Hook safety: which provider is active is fixed at AuthProvider mount
// time. We expose ONE shared context (AuthCtx) and split the implementation
// into two non-overlapping subtrees. Consumers always call the same hooks
// in the same order — Rules of Hooks satisfied.
//
// Bundle safety: `@clerk/clerk-react` is **dynamically** imported only when
// a `publishableKey` is provided. In stub mode (no key), nothing from
// @clerk/* is pulled into the eager bundle — verified post-build by grepping
// `dist/assets/index-*.js`. The lazy boundary is `LazyClerkBranch` below.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  Suspense,
  lazy,
  type ReactNode,
  type ComponentType,
} from 'react';

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
  role: string | null;
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
        role: 'admin',
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// `React.lazy` requires a default-export module, so we wrap the dynamic
// `import('@clerk/clerk-react')` in a component that closes over the loaded
// hooks/components. Once the chunk has resolved, this subtree behaves
// identically to a static-import version.
//
// Why this shape (and not `loadClerk()` returning hooks): hooks must be
// called inside a component body, not from an async function. So we lazy-load
// a *component* whose body uses the resolved Clerk hooks via closure.
const LazyClerkBranch = lazy(async () => {
  const mod = await import('@clerk/clerk-react');
  const { ClerkProvider, useAuth: useClerkAuth, useUser: useClerkUser, useClerk } = mod;

  function mapClerkRole(orgRole: string | null | undefined): string {
    if (orgRole === 'org:admin') return 'admin';
    // Future: map custom Clerk roles like 'org:bid_manager' → 'bid_manager'
    return orgRole ? orgRole.replace('org:', '') : 'member';
  }

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
          role: mapClerkRole(auth.orgRole),
          signOut: (cb) => {
            void clerk.signOut().then(() => cb?.());
          },
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  const ClerkBranch: ComponentType<{ publishableKey: string; children: ReactNode }> = ({
    publishableKey,
    children,
  }) => (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );

  return { default: ClerkBranch };
});

// Fallback shown while the @clerk/* chunk is fetched. We surface a minimal
// `isLoaded: false` context so RequireAuth in App.tsx renders its skeleton
// rather than redirecting to /login mid-load.
function ClerkLoadingFallback({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        isLoaded: false,
        isSignedIn: false,
        user: null,
        role: null,
        signOut: () => undefined,
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
    <Suspense fallback={<ClerkLoadingFallback>{children}</ClerkLoadingFallback>}>
      <LazyClerkBranch publishableKey={publishableKey}>{children}</LazyClerkBranch>
    </Suspense>
  );
}

function useAuthCtx(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth/useUser/useSignOut must be used inside <AuthProvider>');
  }
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): { isLoaded: boolean; isSignedIn: boolean } {
  const ctx = useAuthCtx();
  return { isLoaded: ctx.isLoaded, isSignedIn: ctx.isSignedIn };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUser(): { user: AuthUser | null } {
  const ctx = useAuthCtx();
  return { user: ctx.user };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRole(): { role: string | null } {
  const ctx = useAuthCtx();
  return { role: ctx.role };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useIsAdmin(): boolean {
  const ctx = useAuthCtx();
  return ctx.role === 'admin';
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSignOut() {
  const ctx = useAuthCtx();
  return { signOut: ctx.signOut };
}
