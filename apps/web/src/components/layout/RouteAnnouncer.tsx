// Screen-reader route announcer. On every route change we update an
// invisible aria-live region with the new page's name + any params, so
// VoiceOver/NVDA/JAWS speak "Now on Tasks" / "Now on Acme Corp account"
// without the user having to refocus the page.
//
// This is the React equivalent of Next.js' built-in router-announcer.
// Without it, SPA navigations are silent for assistive tech users — a
// regression from the multi-page-app default they expect.

import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/accounts': 'Accounts',
  '/opportunities': 'Opportunities',
  '/pipeline': 'Pipeline',
  '/contacts': 'Contacts',
  '/tasks': 'Tasks',
  '/reports': 'Reports',
  '/integrations': 'Integrations',
  '/settings': 'Settings',
  '/audit-log': 'Audit log',
  '/login': 'Sign in',
};

function titleFor(pathname: string, params: Record<string, string | undefined>): string {
  // Try most-specific first.
  if (pathname.startsWith('/accounts/') && params.accountId) {
    return `Account: ${decodeURIComponent(params.accountId)}`;
  }
  if (pathname.startsWith('/opportunities/') && params.id) {
    return 'Opportunity detail';
  }
  const segment = '/' + (pathname.split('/')[1] ?? '');
  return ROUTE_TITLES[segment] ?? 'Page';
}

export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const params = useParams<Record<string, string>>();
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Skip the initial mount so we don't announce on first paint — only
    // navigations should speak.
    const next = `Now on ${titleFor(pathname, params)}`;
    // Set after a beat so the change is detected as a live-region update
    // rather than initial content.
    const handle = window.setTimeout(() => setMessage(next), 50);
    return () => window.clearTimeout(handle);
  }, [pathname, params]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // Visually hidden but discoverable by screen readers. We use the
      // common .sr-only pattern (works with Tailwind's preset) rather than
      // CSS that hides from a11y trees.
      className="sr-only"
    >
      {message}
    </div>
  );
}
