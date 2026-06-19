import type { ReactNode } from 'react';

import { MobileNav } from './MobileNav';
import { OfflineIndicator } from './OfflineIndicator';
import { RouteAnnouncer } from './RouteAnnouncer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main id="main" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      {/* Mobile navigation drawer — full-screen overlay below md breakpoint. */}
      <MobileNav />
      {/* Screen-reader-only live region — announces every route swap. */}
      <RouteAnnouncer />
      {/* Bottom-left pill — only visible when navigator reports offline. */}
      <OfflineIndicator />
    </div>
  );
}
