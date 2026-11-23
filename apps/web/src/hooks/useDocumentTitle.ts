import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Portfolio',
  '/quick-start': 'Quick Start',
  '/forecasts': 'Forecasts',
  '/win-loss': 'Win/Loss Review',
  '/sales-toolkits': 'Sales Toolkits',
  '/opportunities': 'Opportunities',
  '/pipeline': 'Pipeline',
  '/leads': 'Leads',
  '/territories': 'Territories',
  '/contacts': 'Contacts',
  '/companies': 'Companies',
  '/kam': 'KAM Initiatives',
  '/sector-view': 'Sector View',
  '/cross-sell': 'Cross-sell',
  '/references': 'Reference Library',
  '/tasks': 'Tasks',
  '/workload': 'Team Workload',
  '/calendar': 'Calendar',
  '/workflows': 'Workflows',
  '/intake': 'Document Intake',
  '/reports': 'Reports',
  '/analytics': 'Analytics',
  '/integrations': 'Integrations',
  '/settings': 'Settings',
  '/login': 'Sign in',
  '/bid-matrix': 'Bid/No-Bid Matrix',
  '/proposals': 'Proposals',
  '/serum': 'SERUM Mission Control',
  '/agent-studio': 'Agent Studio',
  '/workspace': 'Collaborate',
  '/sales': 'Sales',
  '/accounts': 'Accounts',
  '/audit-log': 'Audit Log',
};

const PRODUCT_TITLE = 'Polo PreSales';

// SPA navigations don't update <title>, leaving screen-reader users without
// a "you are now on Foo" announcement (WCAG 2.4.2). Drive title from the
// route path; nested paths inherit their first segment's label.
export function documentTitleForPath(pathname: string): string {
  const segment = '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
  const label = ROUTE_TITLES[segment] ?? PRODUCT_TITLE;
  return label === PRODUCT_TITLE ? label : `${label} · ${PRODUCT_TITLE}`;
}

export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = documentTitleForPath(pathname);
  }, [pathname]);
}
