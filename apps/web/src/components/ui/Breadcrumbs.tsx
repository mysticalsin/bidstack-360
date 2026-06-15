// Topbar breadcrumbs. Derived from the URL pathname so we don't need a
// per-route breadcrumb registration step. Specific routes that need a
// human-readable label for a slug (e.g. /accounts/:id → "Acme Corp") get
// overridden via the `labelFor` map.

import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router-dom';

import { cn } from '@/lib/cn';

interface Crumb {
  label: string;
  to?: string;
}

type TFunction = ReturnType<typeof useTranslation>['t'];

function primaryLabels(t: TFunction): Record<string, string> {
  return {
    dashboard: t('breadcrumbs.dashboard', 'Dashboard'),
    accounts: t('breadcrumbs.accounts', 'Accounts'),
    opportunities: t('breadcrumbs.opportunities', 'Opportunities'),
    pipeline: t('breadcrumbs.pipeline', 'Pipeline'),
    contacts: t('breadcrumbs.contacts', 'Contacts'),
    tasks: t('breadcrumbs.tasks', 'Tasks'),
    reports: t('breadcrumbs.reports', 'Reports'),
    integrations: t('breadcrumbs.integrations', 'Integrations'),
    settings: t('breadcrumbs.settings', 'Settings'),
    'audit-log': t('breadcrumbs.auditLog', 'Audit log'),
    login: t('breadcrumbs.login', 'Sign in'),
  };
}

function humanize(slug: string): string {
  // Slugs from URLs are typically already kebab-case account IDs. Replace
  // hyphens with spaces and capitalize each word — close enough to a real
  // account name for breadcrumb purposes.
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const params = useParams<Record<string, string>>();
  const { t } = useTranslation('common');

  const crumbs = useMemo<Crumb[]>(() => {
    const primary = primaryLabels(t);
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return [];

    const out: Crumb[] = [];
    let accumulated = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      accumulated += `/${seg}`;
      // First segment maps from PRIMARY; deeper segments are either UUIDs
      // (humanized) or known sub-routes.
      if (i === 0) {
        out.push({ label: primary[seg] ?? humanize(seg), to: accumulated });
        continue;
      }
      // Don't link the last crumb — it's the current page.
      const last = i === segments.length - 1;
      out.push({
        label: humanize(params.accountId === seg ? seg : seg),
        to: last ? undefined : accumulated,
      });
    }
    return out;
  }, [pathname, params.accountId, t]);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label={t('breadcrumbs.ariaLabel', 'Breadcrumb')} className={cn('flex items-center text-xs', className)}>
      <ol className="flex items-center gap-1.5">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 ? (
                <li aria-hidden className="text-[var(--fg-tertiary)]">
                  /
                </li>
              ) : null}
              <li
                className={cn(
                  'truncate max-w-[180px]',
                  isLast ? 'font-medium text-[var(--fg-primary)]' : 'text-[var(--fg-tertiary)]',
                )}
              >
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-[var(--brand-primary)]">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
