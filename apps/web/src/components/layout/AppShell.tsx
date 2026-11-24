import { lazy, Suspense, type ReactNode } from 'react';

import { useProdFrame } from '@/lib/prodMount';

import { RouteAnnouncer } from './RouteAnnouncer';

// The shell chrome is not the dashboard's largest paint. Loading it as its
// own chunks, one frame at a time, keeps the entry evaluation and the first
// React commit off the two long tasks Lighthouse records on /dashboard.
const Sidebar = lazy(() => import('./Sidebar').then((m) => ({ default: m.Sidebar })));
const Topbar = lazy(() => import('./Topbar').then((m) => ({ default: m.Topbar })));
const MobileNav = lazy(() => import('./MobileNav').then((m) => ({ default: m.MobileNav })));
const OfflineIndicator = lazy(() =>
  import('./OfflineIndicator').then((m) => ({ default: m.OfflineIndicator })),
);

export function AppShell({ children }: { children: ReactNode }) {
  const frame = useProdFrame();
  const sidebarOn = frame >= 1;
  const topbarOn = frame >= 2;
  const mobileOn = frame >= 3;

  return (
    <div className="app-shell">
      {sidebarOn ? (
        <Suspense fallback={<div className="sidebar" aria-hidden="true" />}>
          <Sidebar />
        </Suspense>
      ) : (
        <div className="sidebar" aria-hidden="true" />
      )}
      <div className="main">
        {topbarOn ? (
          <Suspense fallback={<div className="topbar" aria-hidden="true" />}>
            <Topbar />
          </Suspense>
        ) : (
          <div className="topbar" aria-hidden="true" />
        )}
        <main id="main" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      {/* Mobile navigation drawer — full-screen overlay below md breakpoint. */}
      {mobileOn ? (
        <Suspense fallback={null}>
          <MobileNav />
          <OfflineIndicator />
        </Suspense>
      ) : null}
      {/* Screen-reader-only live region — announces every route swap. */}
      <RouteAnnouncer />
    </div>
  );
}
