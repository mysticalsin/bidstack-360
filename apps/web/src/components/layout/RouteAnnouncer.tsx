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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

function routeTitles(t: TFunction): Record<string, string> {
  return {
    '/dashboard': t('routeAnnouncer.routeDashboard', 'Dashboard'),
    '/accounts': t('routeAnnouncer.routeAccounts', 'Accounts'),
    '/accounts/key': t('routeAnnouncer.routeKeyAccounts', 'Key Accounts'),
    '/accounts/top': t('routeAnnouncer.routeTopAccounts', 'Top Accounts'),
    '/key-accounts': t('routeAnnouncer.routeKeyAccounts', 'Key Accounts'),
    '/top-accounts': t('routeAnnouncer.routeTopAccounts', 'Top Accounts'),
    '/companies': t('routeAnnouncer.routeCompanies', 'Companies'),
    '/references': t('routeAnnouncer.routeReferenceLibrary', 'Reference Library'),
    '/opportunities': t('routeAnnouncer.routeOpportunities', 'Opportunities'),
    '/pipeline': t('routeAnnouncer.routePipeline', 'Pipeline'),
    '/bid-matrix': t('routeAnnouncer.routeBidDecisionMatrix', 'Bid Decision Matrix'),
    '/leads': t('routeAnnouncer.routeLeads', 'Leads'),
    '/contacts': t('routeAnnouncer.routeContacts', 'Contacts'),
    '/tasks': t('routeAnnouncer.routeTasks', 'Tasks'),
    '/territories': t('routeAnnouncer.routeTerritories', 'Territories'),
    '/service-desk': t('routeAnnouncer.routeServiceDesk', 'Service Desk'),
    '/workflows': t('routeAnnouncer.routeWorkflows', 'Workflows'),
    '/intake': t('routeAnnouncer.routeDocumentIntake', 'Document Intake'),
    '/reports': t('routeAnnouncer.routeReports', 'Reports'),
    '/analytics': t('routeAnnouncer.routeAnalytics', 'Analytics'),
    '/dashboards': t('routeAnnouncer.routeDashboards', 'Dashboards'),
    '/search': t('routeAnnouncer.routeSearch', 'Search'),
    '/integrations': t('routeAnnouncer.routeIntegrations', 'Integrations'),
    '/audit-log': t('routeAnnouncer.routeAuditLog', 'Audit Log'),
    '/settings': t('routeAnnouncer.routeSettings', 'Settings'),
    '/login': t('routeAnnouncer.routeLogin', 'Sign in'),
  };
}

function titleFor(
  pathname: string,
  params: Record<string, string | undefined>,
  t: TFunction,
): string {
  // Detail routes — announce record type + identifier.
  if (pathname.startsWith('/accounts/') && params.accountId) {
    return t('routeAnnouncer.accountDetail', 'Account: {{name}}', {
      name: decodeURIComponent(params.accountId),
    });
  }
  if (pathname.startsWith('/opportunities/') && params.id) {
    return t('routeAnnouncer.opportunityDetail', 'Opportunity detail');
  }
  if (pathname.startsWith('/contacts/') && params.id) {
    return t('routeAnnouncer.contactDetail', 'Contact detail');
  }
  if (pathname.startsWith('/leads/') && params.id) {
    return t('routeAnnouncer.leadDetail', 'Lead detail');
  }
  if (pathname.startsWith('/companies/') && params.id) {
    return t('routeAnnouncer.companyDetail', 'Company detail');
  }
  if (pathname.startsWith('/tasks/') && params.id) {
    return t('routeAnnouncer.taskDetail', 'Task detail');
  }
  if (pathname.startsWith('/service-desk/') && params.id) {
    return t('routeAnnouncer.serviceDeskCaseDetail', 'Service desk case detail');
  }

  const titles = routeTitles(t);

  // Sub-routes (e.g., /accounts/key, /sales/orders).
  const twoSegments = pathname.split('/').slice(0, 3).join('/');
  if (titles[twoSegments]) {
    return titles[twoSegments];
  }

  // Single-segment routes.
  const segment = '/' + (pathname.split('/')[1] ?? '');
  return titles[segment] ?? t('routeAnnouncer.routeFallback', 'Page');
}

export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const params = useParams<Record<string, string>>();
  const { t } = useTranslation('crm');
  const [message, setMessage] = useState('');
  const isFirstMount = useRef(true);

  useEffect(() => {
    // Skip the initial mount so we don't announce on first paint — only
    // navigations should speak.
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const next = t('routeAnnouncer.nowOn', 'Now on {{title}}', {
      title: titleFor(pathname, params, t),
    });
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
  }, [pathname, params, t]);

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
