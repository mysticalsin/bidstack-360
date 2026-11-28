import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LiquidQuickActions } from './LiquidQuickActions';
import { MobileNav } from './MobileNav';
import { OfflineIndicator } from './OfflineIndicator';
import { RouteAnnouncer } from './RouteAnnouncer';
import { Sidebar } from './Sidebar';
import { DataModeBanner } from '@/components/identity/DataModeBanner';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  return (
    <div className="app-shell">
      {/* First in the DOM, before the rail. A skip link inside the top bar
          is reached only after every sidebar control. */}
      <a href="#main" className="skip-link">
        {t('topbar.skipToContent', 'Skip to content')}
      </a>
      <Sidebar />
      <div className="main">
        <DataModeBanner />
        <Topbar />
        <main id="main" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      {/* Navigation drawer below 56rem, rendered in place inside the shell. */}
      <MobileNav />
      {/* Screen-reader-only live region — announces every route swap. */}
      <RouteAnnouncer />
      {/* Bottom-left pill — only visible when navigator reports offline. */}
      <OfflineIndicator />
      {/* Floating gooey quick-actions (new account / opportunity / task). */}
      <LiquidQuickActions />
    </div>
  );
}
