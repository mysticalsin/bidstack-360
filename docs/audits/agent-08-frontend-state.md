# Frontend State Management Audit — BidStack 360° CRM

**Scope:** `apps/web/src/hooks/**/*.ts`, `apps/web/src/stores/**/*.ts`, global state patterns  
**Rubric dimension:** Code 25 + Design 25  
**Date:** 2026-05-23  
**Auditor:** Agent-08 (read-only)

---

## 1. Score

**72 / 100**

The codebase demonstrates a solid architectural split between server state (React Query) and client state (Zustand), with thoughtful defaults, custom cache persistence, and well-implemented optimistic updates in several high-traffic hooks. However, the domain suffers from inconsistent mutation error handling, overly broad invalidation patterns that risk cache thrashing, missing form-state abstractions, and ad-hoc polling strategies that could become production liabilities at scale.

---

## 2. Strengths

### 2.1 Architectural separation of concerns

The project rigorously separates **server state** (React Query) from **client state** (Zustand). Every API-backed entity has a dedicated hook file (`useOpportunities.ts`, `useCompanies.ts`, `useContacts.ts`, etc.), while UI chrome (sidebar, theme, preferences) lives in `stores/`. This aligns with the AGENTS.md convention:

> "Zustand for global UI state; React Query for server state. No Redux."

### 2.2 Custom React Query cache persistence with auth hygiene

`apps/web/src/lib/queryCache.ts` implements a lightweight localStorage-backed persistence layer that:

- Only serializes primitive query keys (lines 11–22), avoiding crashes from functions or DOM nodes in keys.
- Hydrates on boot (line 80 `main.tsx`) and subscribes to cache updates (line 26).
- Watches auth state and **clears the entire cache on logout** (lines 72–87), preventing cross-user data leakage.

### 2.3 Sensible QueryClient defaults

`apps/web/src/main.tsx:47–76` configures global defaults:

- `staleTime: 120_000` (2 min) — avoids refetch storms on tab switches.
- `gcTime: 600_000` (10 min) — keeps data warm without unbounded growth.
- `refetchOnWindowFocus: false` — respects user attention; only opt-in surfaces (e.g., provider health) override this.
- Smart retry logic: retries once for 5xx/network errors, never for 4xx (lines 52–58).

### 2.4 Optimistic updates with rollback

Several hooks implement full optimistic flows including snapshot, cancel, mutate, and rollback:

- `usePatchOpportunity` (`useOpportunities.ts:69–111`) — fans out across every paginated list query plus the detail cache.
- `useUpdateContact` (`useContacts.ts:49–72`) and `useDeleteContact` (`useContacts.ts:75–96`) — optimistic patch + optimistic delete with rollback.
- `useUpdateLeadById` (`useLeads.ts:91–114`) — inline table edits feel instant.

### 2.5 Real-time and polling patterns are domain-aware

- `useReportRun` (`useAnalyticsReports.ts:162–175`) polls at 2-second intervals **only while** `status === 'pending' || 'running'`, then stops.
- `useOrgPresence` (`useUsers.ts:35–45`) polls every 30 s, matching the Redis TTL on the backend.
- `useYjsField` (`useYjsField.ts:36–103`) wraps WebSocket-driven collaborative editing with proper lifecycle management (`connect` on mount, `destroy` on unmount).

---

## 3. P0 Gaps — Critical (stale data, cache invalidation bugs, race conditions)

### 3.1 Most mutations lack user-facing error handling

**Risk:** Silent failures leave the UI in an inconsistent state and confuse users.

**Evidence:**

- `useCreateCompany` (`useCompanies.ts:37–44`) has `onSuccess` but no `onError`.
- `useStartCall` (`useCalls.ts:138–148`) has no error handler.
- `useCreateLead` (`useLeads.ts:41–51`) navigates on success but never surfaces a 4xx/5xx failure.
- `useAiFeedback` (`useAiAssistant.ts:31–39`) is a pure mutation with no success or error callback.

The optimistic hooks (`usePatchOpportunity`, `useUpdateContact`) at least roll back on error, but the UI still shows no toast or retry affordance.

### 3.2 Overly broad `invalidateQueries` without scoping

**Risk:** Cache thrashing, unnecessary re-renders, and thundering-herd backend load.

**Evidence:**

- `useCreateCompany` invalidates **all** `['companies']` queries (`useCompanies.ts:42`), including every pagination cursor and filtered view.
- `useDeleteCompany` does the same (`useCompanies.ts:58–63`).
- `useImportMeetingNotes` (`useNotes.ts:102–119`) invalidates five unrelated top-level keys (`crm-dashboard`, `crm-company-lookup`, `tasks`, `contacts`) without considering whether the import actually touched those entities.

**Recommendation:** Use `exact: false` with predicate filtering, or invalidate only the first page and let cursor pages be fetched on demand.

### 3.3 Race condition in `useNotes` account-scoped mutations

**Risk:** If `accountId` changes between render and mutation settlement, the wrong cache key is invalidated or rolled back.

**Evidence:**

```ts
// useNotes.ts:47–73
export function useUpdateNote(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: async ({ id, patch }) => {
      if (!accountId) return undefined; // ← captured at render time
      const key = notesKey(accountId);
      // ... mutate key
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot && accountId) qc.setQueryData(notesKey(accountId), ctx.snapshot);
    },
    onSettled: () => {
      if (accountId) void qc.invalidateQueries({ queryKey: notesKey(accountId) });
    },
  });
}
```

Because `accountId` is read from closure rather than from the mutation variables or `queryClient.getQueryData`, a rapid navigation between accounts can corrupt the wrong cache entry.

### 3.4 Optimistic updates silently drop `customFieldValues`

**Risk:** Inline edits to custom fields appear to succeed locally but revert the custom fields to their previous state.

**Evidence:**

```ts
// useOpportunities.ts:79
const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;
// useContacts.ts:60
const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;
```

The spread intentionally strips `customFieldValues` from the optimistic patch, with no comment explaining why. If the backend returns the full object on settlement, this is a visual glitch; if not, it's data loss.

### 3.5 `useAccountIntel` exposes unbounded `refetchInterval`

**Risk:** Consumers can pass `refetchInterval: 100` and DDoS the backend.

**Evidence:**

```ts
// useAccountIntel.ts:11–22
export function useAccountIntel(
  accountId: string | undefined,
  opts?: { refetchInterval?: number | false },
) {
  return useQuery({
    // ...
    refetchInterval: opts?.refetchInterval,
  });
}
```

There is no minimum clamping or documentation warning about aggressive polling.

---

## 4. P1 Gaps — Performance, over-fetching, prop drilling

### 4.1 Inconsistent query-key conventions

Some hooks use centralized key factories (`useAnalyticsReports.ts:126–132`, `useGoals.ts:53–58`), while others use inline arrays (`useOpportunities.ts:14`, `useCompanies.ts:25`). This makes cross-cutting invalidation fragile — a developer refactoring one hook may miss dependent invalidations in another.

### 4.2 List queries lack explicit `staleTime` / `gcTime`

The global defaults (2 min / 10 min) are reasonable, but high-churn lists (opportunities, leads, contacts) should declare their own SLA. Currently only `useOpportunityCount`, `useCompany`, `useContact`, `useCompanyHierarchy`, `useConnectorCatalog`, and a few others set `staleTime`. The majority of list hooks inherit globals, which is acceptable but reduces explicitness.

### 4.3 `useProviderHealth` polls every 30 s even when tab is backgrounded

While `refetchIntervalInBackground: false` is set (`useCrmIntegrations.ts:36`), the hook still mounts the interval timer on every render. At scale with many admin users, this creates a steady background load. Consider using `useOnlineStatus` to pause polling when offline.

### 4.4 `useGlobalSearch` has no debounce guard in the hook

**Evidence:**

```ts
// useGlobalSearch.ts:19–26
export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: ['global-search', query],
    enabled: query.trim().length >= 2,
    // ...
  });
}
```

If the caller passes `query` on every keystroke without a `useDeferredValue` or debounce, React Query fires a request per keystroke after the 2-character threshold. The hook should either document this contract or internalize a `useDebounce`.

### 4.5 Currency store bypasses React Query entirely

`apps/web/src/stores/currency.ts` manages server-fetched exchange rates inside Zustand with hand-rolled `fetch`, caching, and error states. This duplicates React Query's value proposition and lacks the benefits of automatic background refetching, retry logic, and global error boundaries.

### 4.6 Duplicate shortcut hooks

Both `useKeyboardShortcuts.ts` and `useGlobalShortcuts.ts` implement Vim-style `g` chord navigation with slightly different timeout windows (1200 ms vs 900 ms) and route tables. This is a maintenance hazard — the two can drift and conflict.

### 4.7 `useCalls` infinite query has no `staleTime`

```ts
// useCalls.ts:105–121
return useInfiniteQuery({
  queryKey: ['calls', params],
  // ...
  // staleTime missing
});
```

Without an explicit `staleTime`, every mount of a call list triggers a refetch even if data is fresh.

---

## 5. P2 Gaps — Nice-to-have improvements

### 5.1 No `placeholderData` or prefetching for detail pages

Navigating from an opportunity list to a detail page shows a hard loading state. Prefetching the detail query on hover/row focus (or using `placeholderData` from the list item) would improve perceived performance.

### 5.2 Zustand stores don't use the `persist` middleware consistently

Only `currency.ts` uses `zustand/middleware`'s `persist`; all others (`ui.ts`, `preferences.ts`, `onboarding.ts`, etc.) re-implement `read()`/`write()` by hand. While the hand-rolled code is solid, standardizing on `persist` would reduce boilerplate and gain automatic hydration mismatch handling.

### 5.3 No React Query Devtools

There is no `<ReactQueryDevtools />` import in `main.tsx`. In a monorepo with 70+ hooks, this makes debugging cache state unnecessarily difficult for developers.

### 5.4 Form state is managed ad-hoc

No centralized form library (react-hook-form, Formik, etc.) is used in the hooks layer. Forms likely manage state locally inside page components, which risks inconsistent validation, submission, and error-display patterns across the product.

### 5.5 `useMentions` mark-read could be optimistic

```ts
// useMentions.ts:32–40
export function useMarkMentionRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Mention>(`/api/mentions/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mentions'] });
      qc.invalidateQueries({ queryKey: ['mentions', 'summary'] });
    },
  });
}
```

A notification badge decrement is a prime candidate for an optimistic update, yet it waits for the round-trip.

### 5.6 Onboarding store persistence is fragile

`useOnboardingStore` (`onboarding.ts:84–121`) reaches into `localStorage` inside action creators to derive the `userId` by scanning all keys:

```ts
const allKeys = Object.keys(localStorage ?? {});
const key = allKeys.find((k) => k.startsWith(STORAGE_KEY_PREFIX + ':'));
```

This is brittle if multiple users have ever signed in on the same browser. The `hydrate` action takes a `userId`, but actions that persist should receive it explicitly or store it in Zustand state.

---

## 6. Evidence — Specific Code Snippets

### 6.1 Good: QueryClient defaults with smart retry

`apps/web/src/main.tsx:47–76`

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        if (error instanceof ApiError) {
          return error.status >= 500 || error.status === 0;
        }
        return true;
      },
      refetchOnWindowFocus: false,
      staleTime: 120_000,
      gcTime: 600_000,
    },
    mutations: {
      retry: (failureCount, error) => {
        /* 5xx-only, once */
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
});
```

### 6.2 Good: Full optimistic update with snapshot rollback

`apps/web/src/hooks/useOpportunities.ts:75–104`

```ts
onMutate: async ({ id, patch }) => {
  await qc.cancelQueries({ queryKey: ['opportunities'] });
  await qc.cancelQueries({ queryKey: ['opportunity', id] });
  const listSnapshots: Array<readonly [readonly unknown[], OpportunityPage | undefined]> = [];
  qc.getQueriesData<OpportunityPage>({ queryKey: ['opportunities'] }).forEach(
    ([key, value]) => {
      listSnapshots.push([key, value]);
      if (!value) return;
      qc.setQueryData<OpportunityPage>(key, {
        ...value,
        items: value.items.map((o) => (o.id === id ? { ...o, ...rest } : o)),
      });
    },
  );
  // ... detail snapshot
  return { listSnapshots, detailSnap, id };
},
onError: (_err, _vars, ctx) => {
  ctx?.listSnapshots.forEach(([key, value]) => qc.setQueryData(key, value));
  if (ctx?.detailSnap && ctx.id) qc.setQueryData(['opportunity', ctx.id], ctx.detailSnap);
},
```

### 6.3 Bad: Mutation without error handling

`apps/web/src/hooks/useCompanies.ts:37–44`

```ts
export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyCreate) =>
      api<Company>('/api/companies', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}
```

### 6.4 Bad: Race-prone closure over `accountId`

`apps/web/src/hooks/useNotes.ts:47–73`

```ts
export function useUpdateNote(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: async ({ id, patch }) => {
      if (!accountId) return undefined;
      const key = notesKey(accountId);
      // ...
    },
    onSettled: () => {
      if (accountId) void qc.invalidateQueries({ queryKey: notesKey(accountId) });
    },
  });
}
```

### 6.5 Bad: Custom field stripping in optimistic patch

`apps/web/src/hooks/useContacts.ts:59–64`

```ts
const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;
qc.setQueryData<ContactsPayload>(key, {
  ...value,
  items: value.items.map((c) => (c.id === id ? { ...c, ...rest } : c)),
});
```

### 6.6 Bad: Currency store reimplements React Query

`apps/web/src/stores/currency.ts:52–110`

```ts
export const useCurrencyStore = create<CurrencyStore>()(
  persist(
    (set, get) => ({
      // ...
      fetchRates: async () => {
        const cached = loadCachedRates();
        if (cached) {
          set({ rates: cached });
          return;
        }
        set({ ratesLoading: true, ratesError: null });
        try {
          const res = await fetch('/api/v1/exchange-rates', { credentials: 'include' });
          // ...
        } catch (err) {
          set({ ratesLoading: false, ratesError: err instanceof Error ? err.message : 'Failed' });
        }
      },
    }),
    { name: 'bidstack:currency-locale', partialize: (state) => ({ currency: state.currency }) },
  ),
);
```

---

## 7. Summary Matrix

| Concern                     | Rating     | Notes                                                          |
| --------------------------- | ---------- | -------------------------------------------------------------- |
| React Query configuration   | ⭐⭐⭐⭐   | Great defaults, custom persistence, auth-aware clearing        |
| Zustand store design        | ⭐⭐⭐⭐   | Clean, typed, but inconsistent middleware usage                |
| Optimistic updates          | ⭐⭐⭐⭐   | Implemented well where present; missing in many mutations      |
| Server vs client separation | ⭐⭐⭐⭐⭐ | Strict boundary, no leakage                                    |
| Mutation invalidation       | ⭐⭐       | Too broad, risks thundering herd                               |
| Real-time / polling         | ⭐⭐⭐     | Domain-aware intervals, but unbounded `opts`                   |
| Form state management       | ⭐⭐       | Ad-hoc; no library abstraction visible                         |
| Error handling              | ⭐⭐       | Silent failures common; optimistic rollbacks are the exception |
| Cache hygiene               | ⭐⭐⭐     | Good persistence, but race conditions and over-invalidation    |
| Developer experience        | ⭐⭐⭐     | No Devtools, inconsistent query-key patterns                   |

---

## 8. Recommended Priority Order

1. **Add `onError` to every mutation** — at minimum, dispatch a toast via the global `Toaster` host.
2. **Scope invalidations** — replace broad key invalidations with targeted predicate filters or single-page invalidation.
3. **Fix `useNotes` closure race** — pass `accountId` through mutation context or read from `vars` in callbacks.
4. **Investigate `customFieldValues` stripping** — either include it in optimistic patches or document the intentional omission.
5. **Introduce a shared query-key factory** and migrate all hooks to it incrementally.
6. **Add React Query Devtools** to `main.tsx` in development mode.
7. **Standardize Zustand persistence** on `zustand/middleware`'s `persist` where possible.
8. **Add `useDebounce` to `useGlobalSearch`** or document the caller's responsibility.
9. **Migrate `currency.ts` to React Query** to unify server-state patterns.
10. **Evaluate react-hook-form** for complex forms (opportunity create, invoice create, etc.).
