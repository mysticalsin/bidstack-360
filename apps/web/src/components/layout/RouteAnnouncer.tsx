// Screen-reader route announcer. On every route change we update an
// invisible aria-live region with the new page's name + any params, so
// VoiceOver/NVDA/JAWS speak "Now on Tasks" / "Now on Acme Corp account"
// without the user having to refocus the page.
//
// This is the React equivalent of Next.js' built-in router-announcer.
// Without it, SPA navigations are silent for assistive tech users — a
// regression from the multi-page-app default they expect.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/accounts': 'Accounts',
  '/accounts/key': 'Key Accounts',
  '/accounts/top': 'Top Accounts',
  '/key-accounts': 'Key Accounts',
  '/top-accounts': 'Top Accounts',
  '/companies': 'Companies',
  '/references': 'Reference Library',
  '/opportunities': 'Opportunities',
  '/pipeline': 'Pipeline',
  '/bid-matrix': 'Bid Decision Matrix',
  '/leads': 'Leads',
  '/contacts': 'Contacts',
  '/tasks': 'Tasks',
  '/territories': 'Territories',
  '/service-desk': 'Service Desk',
  '/workflows': 'Workflows',
  '/intake': 'Document Intake',
  '/reports': 'Reports',
  '/analytics': 'Analytics',
  '/dashboards': 'Dashboards',
  '/search': 'Search',
  '/integrations': 'Integrations',
  '/audit-log': 'Audit Log',
  '/settings': 'Settings',
  '/login': 'Sign in',
};

function titleFor(pathname: string, params: Record<string, string | undefined>): string {
  // Detail routes — announce record type + identifier.
  if (pathname.startsWith('/accounts/') && params.accountId) {
    return `Account: ${decodeURIComponent(params.accountId)}`;
  }
  if (pathname.startsWith('/opportunities/') && params.id) {
    return 'Opportunity detail';
  }
  if (pathname.startsWith('/contacts/') && params.id) {
    return 'Contact detail';
  }
  if (pathname.startsWith('/leads/') && params.id) {
    return 'Lead detail';
  }
  if (pathname.startsWith('/companies/') && params.id) {
    return 'Company detail';
  }
  if (pathname.startsWith('/tasks/') && params.id) {
    return 'Task detail';
  }
  if (pathname.startsWith('/service-desk/') && params.id) {
    return 'Service desk case detail';
  }

  // Sub-routes (e.g., /accounts/key, /sales/orders).
  const twoSegments = pathname.split('/').slice(0, 3).join('/');
  if (ROUTE_TITLES[twoSegments]) {
    return ROUTE_TITLES[twoSegments];
  }

  // Single-segment routes.
  const segment = '/' + (pathname.split('/')[1] ?? '');
  return ROUTE_TITLES[segment] ?? 'Page';
}

export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const params = useParams<Record<string, string>>();
  const [message, setMessage] = useState('');
  const isFirstMount = useRef(true);

  useEffect(() => {
    // Skip the initial mount so we don't announce on first paint — only
    // navigations should speak.
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const next = `Now on ${titleFor(pathname, params)}`;
    // Set after a beat so the change is detected as a live-region update
    // rather than initial content.
    const handle = window.setTimeout(() => setMessage(next), 50);

    // Move focus to the main content area so keyboard users start at the
    // top of the new page instead of staying on the sidebar link.
    const focusHandle = window.setTimeout(() => {
      const main = document.getElementById('main');
      if (main) {
        main.focus({ preventScroll: true });
      }
    }, 60);

    return () => {
      window.clearTimeout(handle);
      window.clearTimeout(focusHandle);
    };
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
