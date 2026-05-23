import type { ReactNode } from 'react';

import { FlowFieldBackground } from '@/components/ui/FlowFieldBackground';
import { AmbientOrbs } from '@/components/motion/AmbientOrbs';
import { usePreferences } from '@/stores/preferences';
import { useThemeStore } from '@/stores/theme';
import { cn } from '@/lib/cn';

import { MobileNav } from './MobileNav';
import { OfflineIndicator } from './OfflineIndicator';
import { RouteAnnouncer } from './RouteAnnouncer';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const visualEffects = usePreferences((s) => s.visualEffects);
  const theme = useThemeStore((s) => s.theme);

  return (
    <div className="app-shell">
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
