import { lazy, Suspense, type ReactNode } from 'react';

import { RouteAnnouncer } from './RouteAnnouncer';

// Chrome loads in its own chunks so the entry does not evaluate it. The
// fallback landmark is real navigation: gating the chunk on animation frames
// left WebKit and the iPad width with no reachable nav.
const Sidebar = lazy(() => import('./Sidebar').then((m) => ({ default: m.Sidebar })));
const Topbar = lazy(() => import('./Topbar').then((m) => ({ default: m.Topbar })));
const MobileNav = lazy(() => import('./MobileNav').then((m) => ({ default: m.MobileNav })));
const OfflineIndicator = lazy(() =>
  import('./OfflineIndicator').then((m) => ({ default: m.OfflineIndicator })),
);

function SidebarFallback() {
  return (
    <div className="sidebar">
      <nav aria-label="Primary navigation" />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Suspense fallback={<SidebarFallback />}>
        <Sidebar />
      </Suspense>
      <div className="main">
        <Suspense fallback={<div className="topbar" aria-hidden="true" />}>
          <Topbar />
        </Suspense>
        <main id="main" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <MobileNav />
        <OfflineIndicator />
      </Suspense>
      <RouteAnnouncer />
    </div>
  );
}
