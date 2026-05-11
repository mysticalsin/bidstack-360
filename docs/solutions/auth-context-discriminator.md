# Auth provider with stub + Clerk modes (and stable hook order)

**Problem:** the app needs to support two auth backends at runtime — Clerk
in production, a no-op stub for dev/E2E so we don't need a real Clerk
account to boot. The naive implementation (call Clerk's hooks only when in
Clerk mode) violates React's Rules of Hooks: Clerk's `useAuth/useUser/useClerk`
throw at runtime when there's no `<ClerkProvider>` ancestor, AND the
hook-order contract requires the same hooks be called in the same order
every render.

**Diagnosis:** the audit shipped this anti-pattern in `apps/web/src/lib/auth.tsx`:

```ts
export function useAuth() {
  const stub = useContext(StubAuthContext);
  if (stub.user?.id === 'stub-user-1') return stub; // early return
  const clerk = useClerkAuth(); // ← unreachable in stub mode
  return clerk;
}
```

ESLint's `react-hooks/rules-of-hooks` flagged the conditional Clerk call.
At runtime this would also crash: `useClerkAuth()` requires `<ClerkProvider>`,
and stub mode doesn't mount one.

**Fix:** flip the discriminator. Gate the **provider tree** (mount Stub OR
Clerk subtree once at `AuthProvider`), then have each subtree write to a
single shared `AuthContext`. Consumers only ever read that shared context —
same hooks, same order, every render.

```ts
// One context, two providers.
const AuthContext = createContext<AuthCtx | null>(null);

function StubAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(true);
  const signOut = useCallback((cb?: () => void) => { setSignedIn(false); cb?.(); }, []);
  return (
    <AuthContext.Provider value={{ isLoaded: true, isSignedIn: signedIn, user: STUB_USER, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// Mounted only when a publishableKey is configured. Bridges Clerk's hooks
// into the shared AuthContext.
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const auth = useClerkAuth();
  const { user } = useClerkUser();
  const clerk = useClerk();
  return (
    <AuthContext.Provider value={{
      isLoaded: auth.isLoaded,
      isSignedIn: auth.isSignedIn ?? false,
      user: user ? mapClerkUser(user) : null,
      signOut: (cb) => { void clerk.signOut().then(() => cb?.()); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ publishableKey, children }: Props) {
  if (!publishableKey) return <StubAuthProvider>{children}</StubAuthProvider>;
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

// Consumers — same hooks, same order, every render.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return { isLoaded: ctx.isLoaded, isSignedIn: ctx.isSignedIn };
}
```

**Why it works:**

- `AuthProvider`'s conditional happens at the React tree level (mount Stub OR
  Clerk subtree). Once mounted, that subtree never switches.
- Inside each subtree, hooks are called in a fixed order on every render.
- Consumers (`useAuth/useUser/useSignOut`) only ever call `useContext` —
  there is no third-party SDK call at the consumer level.
- ESLint is happy. React is happy. SDK-not-mounted errors can't happen.

**Prevention:**

- Never call an SDK hook conditionally if the SDK throws without its
  provider. Stub it via context or branch the provider tree.
- Whenever you write `if (...) return ... ; const x = useSomething();`
  treat it as a Rules-of-Hooks bug regardless of whether the lint rule
  fires.

**Where else this pattern applies:**

- Multi-tenant feature flags (LaunchDarkly stub vs real)
- Analytics SDKs (Segment/Posthog stub for E2E)
- Anything with a runtime "production vs dev shim" toggle that has its
  own React hooks
