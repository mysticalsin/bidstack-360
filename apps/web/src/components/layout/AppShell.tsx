import type { ReactNode } from 'react';

import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

import { MobileNav } from './MobileNav';
import { OfflineIndicator } from './OfflineIndicator';
import { RouteAnnouncer } from './RouteAnnouncer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  // WHY: the sidebar collapses from 220px → 72px via Sidebar.tsx, but the
  // app-shell grid template needs to reflow at the same time or the main
  // content column leaves a 168px empty gutter beside the icon rail.
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);

  return (
    <div className={cn('app-shell', sidebarCollapsed && 'has-collapsed-sidebar')}>
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
