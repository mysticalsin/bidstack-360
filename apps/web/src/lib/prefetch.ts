// Route-chunk prefetcher. Each lazy page import has its own JS chunk; when
// the user hovers a nav link we kick off the chunk fetch so by the time they
// click, the chunk is already in-cache. This mimics Apple's "prepare the
// next view" feel — the click never blocks on the network.
//
// Why not React Router's `<Link prefetch>` or Next.js-style prefetch?
// react-router-dom 6 has no built-in prefetch primitive; the simplest robust
// solution is to import() the route module ourselves. The browser dedupes
// duplicate imports, so a second hover is free.
//
// The functions intentionally return void — fire-and-forget. We swallow
// rejection because a prefetch failure is non-actionable: the real
// navigation will surface the error if the chunk truly can't load.

type Prefetcher = () => Promise<unknown>;

const PREFETCH_MAP: Record<string, Prefetcher> = {
  '/dashboard': () => import('@/pages/DashboardPage'),
  '/accounts': () => import('@/pages/AccountsPage'),
  '/opportunities': () => import('@/pages/OpportunitiesPage'),
  // Detail-page chunk. Distinct from the list — hovering an opportunity
  // row in the list should pre-load the detail bundle, not re-fetch the
  // list bundle (already in memory).
  '/opportunities/:id': () => import('@/pages/OpportunityDetailPage'),
  '/pipeline': () => import('@/pages/PipelinePage'),
  '/contacts': () => import('@/pages/ContactsPage'),
  '/tasks': () => import('@/pages/TasksPage'),
  '/workload': () => import('@/pages/WorkloadPage'),
  '/reports/list': () => import('@/pages/ReportsListPage'),
  '/win-loss': () => import('@/pages/WinLossPage'),
  '/analytics': () => import('@/pages/AnalyticsDashboardPage'),
  '/integrations': () => import('@/pages/IntegrationsPage'),
  '/audit-log': () => import('@/pages/AuditLogPage'),
  '/settings': () => import('@/pages/SettingsPage'),
};

// Module-level set tracks which routes have been requested this session so
// we don't re-call import() on every hover (the browser caches already, but
// we save the call overhead).
const requested = new Set<string>();

export function prefetchRoute(path: string): void {
  // Explicit keys (e.g. "/opportunities/:id") match verbatim — used by
  // callers that want to prefetch a child route without auto-prefix logic.
  if (PREFETCH_MAP[path]) {
    if (requested.has(path)) return;
    requested.add(path);
    PREFETCH_MAP[path]!().catch(() => requested.delete(path));
    return;
  }
  // Otherwise: match the longest-prefix route — /accounts/CI Financial
  // → /accounts.
  const segment = '/' + (path.split('/')[1] ?? '');
  if (requested.has(segment)) return;
  const loader = PREFETCH_MAP[segment];
  if (!loader) return;
  requested.add(segment);
  // Swallow the rejection — prefetch failures should never break the UI.
  loader().catch(() => requested.delete(segment));
}
