import type { ReactNode } from 'react';

import { FlowFieldBackground } from '@/components/ui/FlowFieldBackground';
import { AmbientOrbs } from '@/components/motion/AmbientOrbs';
import { usePreferences } from '@/stores/preferences';
import { useThemeStore } from '@/stores/theme';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

import { MobileNav } from './MobileNav';
import { OfflineIndicator } from './OfflineIndicator';
import { RouteAnnouncer } from './RouteAnnouncer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const visualEffects = usePreferences((s) => s.visualEffects);
  const theme = useThemeStore((s) => s.theme);
  // WHY: the sidebar collapses from 220px → 72px via Sidebar.tsx, but the
  // app-shell grid template needs to reflow at the same time or the main
  // content column leaves a 168px empty gutter beside the icon rail.
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);

  return (
    <div className={cn('app-shell', sidebarCollapsed && 'has-collapsed-sidebar')}>
      <Sidebar />
      <div className={cn('main', visualEffects && 'has-flow-field')}>
        {visualEffects ? (
          <FlowFieldBackground className="app-flow-field" density="compact" />
        ) : null}
        {theme === 'dark' && <AmbientOrbs />}
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
