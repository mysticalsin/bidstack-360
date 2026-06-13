import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Portfolio',
  '/opportunities': 'Opportunities',
  '/pipeline': 'Pipeline',
  '/contacts': 'Contacts',
  '/tasks': 'Tasks',
  '/reports': 'Reports',
  '/integrations': 'Integrations',
  '/settings': 'Settings',
  '/login': 'Sign in',
  '/bid-matrix': 'Bid/No-Bid Matrix',
  '/proposals': 'Proposals',
  '/sales': 'Sales',
  '/accounts': 'Accounts',
  '/audit-log': 'Audit Log',
};

// SPA navigations don't update <title>, leaving screen-reader users without
// a "you are now on Foo" announcement (WCAG 2.4.2). Drive title from the
// route path; nested paths inherit their first segment's label.
export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const segment = '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
    const label = ROUTE_TITLES[segment] ?? 'BidStack 360°';
    document.title = label === 'BidStack 360°' ? label : `${label} · BidStack 360°`;
  }, [pathname]);
}
