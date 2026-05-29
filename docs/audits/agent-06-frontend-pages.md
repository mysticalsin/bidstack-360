# Frontend Pages Audit — BidStack 360° CRM

**Scope:** `apps/web/src/pages/**/*.tsx`, `apps/web/src/App.tsx`, routing  
**Rubric:** Design 25 + Functional 25  
**Score:** **84 / 100**

---

## Strengths

1. **Comprehensive route-level code splitting** — Every page is lazy-loaded via `React.lazy()` with named exports (`App.tsx:29-148`). The `Suspense` fallback uses `LoadingSkeleton` for login and a layout-matched skeleton set inside `AppShell` for authenticated routes (`App.tsx:545-558`).

2. **Layout-matched skeletons reduce CLS** — Custom skeletons mirror the real page structure instead of generic spinners:
   - `DashboardSkeleton` replicates the KPI row + 2-column cockpit grid (`PageSkeletons.tsx:47-94`).
   - `TableSkeleton` accepts `rows`, `columns`, and `headless` props to match list pages (`PageSkeletons.tsx:121-167`).
   - `DetailPageSkeleton` approximates breadcrumb + header card + tab bar + content grid (`DetailPageSkeleton.tsx:18-93`).

3. **Deep linking via URL-synced state** — Filters, sort, and view toggles are persisted in `useSearchParams`:
   - Opportunities: `?search=&pipelineStageId=&sort=` (`OpportunitiesPage.tsx:55-121`).
   - Tasks: `?filter=&sort=&view=` (`TasksPage.tsx:70-165`).
   - Search: `?q=&type=` (`SearchPage.tsx:42-73`).
     This makes every filtered/sorted view back-button-navigable and shareable.

4. **Accessibility patterns above average for a CRM** —
   - `aria-sort` on sortable table headers with `getSortableHeaderAriaSort` (`OpportunitiesPage.tsx:472-538`, `ContactsPage.tsx:500-547`).
   - Keyboard-only stage movement in Pipeline (`←/→` arrows on focused cards) because drag-and-drop is unreachable alone (`PipelinePage.tsx:90-107`).
   - `sr-only` live region announcing result counts (`ContactsPage.tsx:426-434`, `SearchPage.tsx:133`).
   - `useDocumentTitle` updates `document.title` on every route change so screen readers announce navigation (`useDocumentTitle.ts:25-32`).

5. **Auth guards with role separation** — `RequireAuth` and `RequireAdmin` wrappers protect routes at the JSX level (`App.tsx:150-182`). The admin gate redirects non-admins to `/dashboard` rather than failing silently.

6. **Prefetching on hover** — Opportunities list rows prefetch the detail route chunk and warm the React Query cache on `mouseenter` (`OpportunitiesPage.tsx:596-610`).

---

## P0 Gaps

### 1. No skip-navigation link (Accessibility — WCAG 2.4.1)

**File:** `App.tsx:527-578`  
There is no `<a href="#main-content">Skip to content</a>` link. Keyboard users must tab through the entire sidebar/topbar on every page load.

### 2. Single ErrorBoundary for the entire route tree

**File:** `App.tsx:554-558`  
Only one `ErrorBoundary` wraps `<AnimatedRoutes>`. A render crash in any page unmounts the entire route subtree; users lose the sidebar and must reload. Per-page boundaries (e.g., inside `RequireAuth` or around individual `<Route>` elements) would contain the blast radius.

### 3. Login page does not redirect authenticated users

**File:** `App.tsx:194`, `LoginPage.tsx:43-356`  
`/login` is rendered without any guard. A signed-in user who lands on `/login` (e.g., from a bookmark) sees the full login UI and the "Skip to Dashboard" dev button instead of being redirected to `/dashboard`.

### 4. ContactDetailPage fires broad, unconditional queries

**File:** `ContactDetailPage.tsx:20-21`

```tsx
const allOpps = useOpportunities({ limit: 100 });
const allTasks = useTasks();
```

These fetch the entire opportunity and task universes just to client-side filter 2–3 related records (`ContactDetailPage.tsx:51-54`). For large tenants this is a broken data-fetching pattern that wastes bandwidth and causes secondary layout shifts when the subsets resolve.

### 5. No focus management after route transitions

**File:** `App.tsx:191-524`  
`AnimatePresence` with `mode="wait"` animates page swaps, but focus is never sent to the new page’s `<h1>` or a container ref. Screen-reader users receive no "page changed" announcement beyond the title update, which some SRs ignore during animation.

---

## P1 Gaps

### 1. No pagination on list pages

**Files:** `OpportunitiesPage.tsx:73`, `ContactsPage.tsx:52`, `TasksPage.tsx:66`  
Opportunities loads `limit: 100`; Contacts and Tasks load an unbounded list. As the dataset grows, these pages will download, render, and sort increasingly large arrays without virtualisation or pagination controls.

### 2. SettingsPage sections are not URL-addressable

**File:** `SettingsPage.tsx:40-61`  
Active section is stored in local `useState`. Refreshing `/settings` always lands on **Profile**, and users cannot share a link to `/settings/appearance` or `/settings/security`.

### 3. Detail page skeletons don’t always match loaded layouts

**File:** `OpportunityDetailPage.tsx:74`

```tsx
if (isLoading) return <DetailPageSkeleton tabs columns={2} cards={3} />;
```

The loaded page renders a 4-column grid (`OpportunityDetailPage.tsx:247`), a 2-column grid (`line 254`), tabs, and an additional notes section. The skeleton under-represents the final vertical height, causing noticeable layout shift on load.

### 4. No background-refetch indicator

**Files:** Multiple pages  
React Query is configured with `staleTime: 120_000` (`main.tsx:60`). When a user returns to a page and a background refetch runs, there is no subtle toast/spinner to indicate stale data is being refreshed. Users may edit records based on outdated values.

### 5. Mobile table experience is horizontal-scroll only

**File:** `OpportunitiesPage.tsx:450`

```tsx
<table className="min-w-[980px] w-full text-left text-sm">
```

There is no card-based mobile alternative. On viewports below ~980 px the table overflows and requires horizontal scrolling, which is usable but not ideal for touch.

### 6. CompanyDetailPage uses `window.history.back()` for empty-state recovery

**File:** `CompanyDetailPage.tsx:51`

```tsx
<Button variant="secondary" onClick={() => window.history.back()}>
```

If the user deep-links directly to a deleted company, `history.back()` may send them to an external referrer or a blank history state. A `<Link to="/companies">` would be deterministic.

---

## P2 Gaps

1. **No SEO meta tags beyond `<title>`** — `useDocumentTitle` sets `document.title`, but no `<meta name="description">`, Open Graph, or Twitter cards are rendered. A CRM is internally-facing, yet shareable links to `/opportunities/:id` or `/companies/:id` lose preview context.

2. **404 page is inline JSX** — The catch-all route in `App.tsx:502-520` renders an ad-hoc JSX block rather than a dedicated `NotFoundPage.tsx` component. This is inconsistent with the lazy-loading convention used for every other page.

3. **Missing row-level prefetch on other list pages** — Only `OpportunitiesPage` prefetches detail routes on hover. `ContactsPage`, `CompaniesPage`, `LeadsPage`, and `TasksPage` do not, so navigation to detail views from those lists feels slower.

4. **SettingsPage has no loading/error scaffold for async sections** — The page is a thin wrapper around local sub-components. If any section (e.g., `MicrosoftSection`) performs an async fetch and errors, there is no page-level `ErrorState` or `LoadingSkeleton` fallback; the error bubbles to the global boundary.

5. **No canonical URL or `navigate` replace on redirects** — `App.tsx:195` redirects `/` to `/dashboard` with `<Navigate replace>`, but other aliases (e.g., `/accounts` vs `/accounts/`) are not normalised, risking duplicate analytics entries.

---

## Evidence

### App.tsx — routing, auth guards, and boundary placement

```tsx
// App.tsx:29-34  — lazy splitting for every page
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

// App.tsx:150-163 — auth guard with loading skeleton
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSkeleton rows={3} />
      </div>
    );
  }
  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// App.tsx:554-558 — single boundary around the whole route tree
<ErrorBoundary>
  <Suspense fallback={<LoadingSkeleton rows={6} />}>
    <AnimatedRoutes />
  </Suspense>
</ErrorBoundary>;
```

### OpportunitiesPage — URL state, inline editing, and prefetch

```tsx
// OpportunitiesPage.tsx:55-71 — filter state in URL
const stageFilterRaw = searchParams.get('pipelineStageId');
const setStageFilter = (next: string | null) => {
  const params = new URLSearchParams(searchParams);
  if (next) params.set('pipelineStageId', next);
  else params.delete('pipelineStageId');
  setSearchParams(params, { replace: true });
};

// OpportunitiesPage.tsx:596-610 — hover prefetch
const prefetch = () => { prefetchRoute('/opportunities/:id'); };
<tr … onMouseEnter={prefetch}>
```

### ContactDetailPage — over-fetching anti-pattern

```tsx
// ContactDetailPage.tsx:18-23
export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const contact = useContact(id);
  const allOpps = useOpportunities({ limit: 100 });   // ← fetches 100 opps
  const allTasks = useTasks();                         // ← fetches all tasks
  const allNotes = useNotes(contact.data?.customer);
  …
  const relatedOpps = allOpps.data?.items.filter((o) => o.customer === c.customer) ?? [];
```

### PipelinePage — keyboard-accessible drag alternative

```tsx
// PipelinePage.tsx:90-107
const handleKey = useCallback(
  (e: KeyboardEvent<HTMLDivElement>, opp: Opportunity) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const ids = stages.map((s) => s.id);
    const idx = ids.indexOf(getStageId(opp));
    const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    e.preventDefault();
    move.mutate({ id: opp.id, pipelineStageId: ids[nextIdx]! });
  },
  [stages, move],
);
```

### useDocumentTitle — route-derived titles

```tsx
// useDocumentTitle.ts:25-32
export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const segment = '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
    const label = ROUTE_TITLES[segment] ?? 'BidStack 360°';
    document.title = label === 'BidStack 360°' ? label : `${label} · BidStack 360°`;
  }, [pathname]);
}
```

---

## Summary

The Frontend Pages domain is well-architected: every route is code-split, data fetching follows React Query best practices, auth is guarded at the route level, and list pages sync filter/sort state to the URL for deep linking. Skeletons are layout-matched rather than generic, and accessibility considerations (keyboard nav, aria-live regions, sort announcements) are present throughout.

The biggest functional risks are the **single global ErrorBoundary** (a page crash evicts the entire shell), the **absence of a skip link** (WCAG 2.4.1 failure), and **unbounded list fetching** without pagination. Design polish gaps include missing SEO meta tags, non-addressable Settings tabs, and skeleton-to-content layout mismatches on some detail pages.
