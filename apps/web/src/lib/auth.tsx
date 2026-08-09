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
  Component,
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  Suspense,
  lazy,
  type ReactNode,
  type ComponentType,
} from 'react';

import { setApiTokenProvider } from '@/lib/api';
import { AUTH_FINGERPRINT_EVENT } from '@/lib/queryCache';

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
  signIn: (cb?: () => void) => void;
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

const STUB_SESSION_KEY = 'bidstack:session';
const STUB_SIGNED_OUT_KEY = 'bidstack:stub-signed-out';
export const STUB_ROLE_KEY = 'bidstack:stub-role';

const STUB_USERS: Record<string, AuthUser> = {
  admin: STUB_USER,
  manager: {
    id: 'stub-user-manager',
    firstName: 'Morgan',
    lastName: 'Manager',
    fullName: 'Morgan Manager',
    primaryEmailAddress: { emailAddress: 'e2e-manager@bidstack.local' },
  },
  'read-only': {
    id: 'stub-user-read-only',
    firstName: 'Riley',
    lastName: 'Reader',
    fullName: 'Riley Reader',
    primaryEmailAddress: { emailAddress: 'e2e-read-only@bidstack.local' },
  },
  viewer: {
    id: 'stub-user-viewer',
    firstName: 'Val',
    lastName: 'Viewer',
    fullName: 'Val Viewer',
    primaryEmailAddress: { emailAddress: 'e2e-viewer@bidstack.local' },
  },
};

function normalizeStubRole(value: string | null): keyof typeof STUB_USERS {
  if (value === 'manager' || value === 'read-only' || value === 'viewer') return value;
  return 'admin';
}

function notifyAuthFingerprintChanged(): void {
  window.dispatchEvent(new Event(AUTH_FINGERPRINT_EVENT));
}

function writeSessionMarker(value: string | null): void {
  const oldValue = localStorage.getItem(STUB_SESSION_KEY);
  if (value === null) {
    localStorage.removeItem(STUB_SESSION_KEY);
  } else {
    localStorage.setItem(STUB_SESSION_KEY, value);
  }
  if (oldValue === value) {
    notifyAuthFingerprintChanged();
    return;
  }

  window.dispatchEvent(
    new StorageEvent('storage', {
      key: STUB_SESSION_KEY,
      oldValue,
      newValue: value,
      storageArea: localStorage,
    }),
  );
  notifyAuthFingerprintChanged();
}

function StubAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(() => {
    return (
      localStorage.getItem(STUB_SESSION_KEY) !== null ||
      localStorage.getItem(STUB_SIGNED_OUT_KEY) === null
    );
  });
  const [stubRole, setStubRole] = useState(() => normalizeStubRole(localStorage.getItem(STUB_ROLE_KEY)));

  useEffect(() => {
    setApiTokenProvider(null);
    if (signedIn && localStorage.getItem(STUB_SESSION_KEY) === null) {
      writeSessionMarker('stub');
    }
    return () => setApiTokenProvider(null);
  }, [signedIn]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STUB_ROLE_KEY) {
        setStubRole(normalizeStubRole(event.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const signIn = useCallback((cb?: () => void) => {
    setSignedIn(true);
    localStorage.removeItem(STUB_SIGNED_OUT_KEY);
    writeSessionMarker('stub');
    cb?.();
  }, []);

  const signOut = useCallback((cb?: () => void) => {
    setSignedIn(false);
    localStorage.setItem(STUB_SIGNED_OUT_KEY, 'true');
    // Remove the key and fire a synthetic storage event — native storage events
    // don't fire on the originating tab, so the same-tab cache-clear handler
    // in watchAuthForCacheClear would never trigger otherwise.
    writeSessionMarker(null);
    cb?.();
  }, []);

  const user = STUB_USERS[stubRole] ?? STUB_USER;
  const role = stubRole === 'admin' ? 'admin' : stubRole;

  return (
    <AuthContext.Provider
      value={{
        isLoaded: true,
        isSignedIn: signedIn,
        user: signedIn ? user : null,
        role: signedIn ? role : null,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Demo mode (VITE_AUTH_MODE=demo): public passwordless "try the demo" flow.
// The DemoSignIn screen POSTs an email to /api/v1/demo/session, stores the
// returned signed Bearer token in localStorage, then calls signIn() to flip
// state. Here we simply read that token: the API client sends it as
// `Authorization: Bearer`, and each visitor lands in their own seeded org.
// The visitor is always an org admin in their demo workspace.
export const DEMO_TOKEN_KEY = 'bidstack:demo-token';
export const DEMO_EMAIL_KEY = 'bidstack:demo-email';

function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(() => localStorage.getItem(DEMO_TOKEN_KEY) !== null);

  // Register the token provider SYNCHRONOUSLY, during this component's own
  // render — not in a useEffect. React commits child effects before parent
  // effects, so a parent-only useEffect registration would still let a child
  // data-fetching hook (useQuery et al.) mount and fire its first request
  // before this ran, sending it with a null token → a guaranteed 401 on every
  // cold page load, immediately "fixed" by that hook's own forced-refresh
  // retry. useState's lazy initializer runs inline in this render, strictly
  // before React ever invokes a child component, so the provider is
  // guaranteed live before any descendant can issue a fetch. The initializer
  // itself is idempotent (last-write-wins on a module-level variable), so
  // re-mounts are harmless.
  useState(() => {
    // The token is a plain string in localStorage (the app has no cookie layer;
    // this matches the existing Bearer-token model used for Clerk).
    setApiTokenProvider(() => localStorage.getItem(DEMO_TOKEN_KEY));
    return null;
  });

  // Cleanup only — registration happens above, once, at first render.
  useEffect(() => () => setApiTokenProvider(null), []);

  useEffect(() => {
    if (signedIn && localStorage.getItem(DEMO_TOKEN_KEY)) {
      writeSessionMarker('demo');
    }
  }, [signedIn]);

  const signIn = useCallback((cb?: () => void) => {
    const hasToken = localStorage.getItem(DEMO_TOKEN_KEY) !== null;
    setSignedIn(hasToken);
    if (hasToken) writeSessionMarker('demo');
    cb?.();
  }, []);

  const signOut = useCallback((cb?: () => void) => {
    localStorage.removeItem(DEMO_TOKEN_KEY);
    localStorage.removeItem(DEMO_EMAIL_KEY);
    setSignedIn(false);
    writeSessionMarker(null);
    cb?.();
  }, []);

  const email = typeof window !== 'undefined' ? localStorage.getItem(DEMO_EMAIL_KEY) : null;

  return (
    <AuthContext.Provider
      value={{
        isLoaded: true,
        isSignedIn: signedIn,
        user: signedIn
          ? {
              id: 'demo-user',
              firstName: null,
              lastName: null,
              fullName: email ?? 'Demo User',
              primaryEmailAddress: email ? { emailAddress: email } : null,
            }
          : null,
        role: 'admin',
        signIn,
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

    useEffect(() => {
      setApiTokenProvider(({ forceRefresh } = {}) =>
        auth.getToken(forceRefresh ? { skipCache: true } : undefined),
      );
      // Keep bidstack:session in sync with Clerk auth state so
      // watchAuthForCacheClear can detect sign-out/org switches on any tab.
      if (auth.isLoaded) {
        if (auth.isSignedIn && auth.userId) {
          const orgId = auth.orgId ?? 'personal';
          const orgRole = auth.orgRole ?? 'member';
          writeSessionMarker(`${auth.userId}:${orgId}:${orgRole}`);
        } else if (!auth.isSignedIn) {
          writeSessionMarker(null);
        }
      }
      return () => setApiTokenProvider(null);
    }, [auth]);

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
          signIn: (cb) => {
            cb?.();
          },
          signOut: (cb) => {
            void clerk.signOut().then(() => {
              writeSessionMarker(null);
              cb?.();
            });
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
        signIn: () => undefined,
        signOut: () => undefined,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// P2 #32: ErrorBoundary that catches CDN chunk load failures (and any error
// thrown inside <LazyClerkBranch>). On error we surface isLoaded:true /
// isSignedIn:false so RequireAuth in App.tsx redirects to /login instead of
// rendering a blank white screen. Class component is required because only
// class components can implement componentDidCatch / getDerivedStateFromError.
class ClerkErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <AuthContext.Provider
          value={{
            isLoaded: true,
            isSignedIn: false,
            user: null,
            role: null,
            signIn: () => undefined,
            signOut: () => undefined,
          }}
        >
          {this.props.children}
        </AuthContext.Provider>
      );
    }
    return this.props.children;
  }
}

export function AuthProvider({
  publishableKey,
  children,
}: {
  publishableKey: string | undefined;
  children: ReactNode;
}) {
  const hasKey = publishableKey !== undefined && publishableKey !== null && publishableKey !== '';
  const authMode = import.meta.env.VITE_AUTH_MODE;
  // Public demo deployment: no Clerk, no stub — a per-visitor passwordless door.
  if (authMode === 'demo') {
    return <DemoAuthProvider>{children}</DemoAuthProvider>;
  }
  const forceClerkAuth = authMode === 'clerk';
  if (!hasKey) {
    if (forceClerkAuth) {
      throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required when VITE_AUTH_MODE=clerk');
    }
    return <StubAuthProvider>{children}</StubAuthProvider>;
  }
  return (
    <ClerkErrorBoundary>
      <Suspense fallback={<ClerkLoadingFallback>{children}</ClerkLoadingFallback>}>
        <LazyClerkBranch publishableKey={publishableKey}>{children}</LazyClerkBranch>
      </Suspense>
    </ClerkErrorBoundary>
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

// eslint-disable-next-line react-refresh/only-export-components
export function useSignInAction() {
  const ctx = useAuthCtx();
  return { signIn: ctx.signIn };
}
