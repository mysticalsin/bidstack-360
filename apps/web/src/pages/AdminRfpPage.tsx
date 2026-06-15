// Admin-only RFP analytics page (/admin/rfp). The analytics themselves live in
// RfpAnalyticsSection — the same component rendered by the admin-gated "RFP
// Analytics" tab in Settings — so there is one source of truth. This page wraps it
// with the standalone heading + a link to the full proposals list. Gated by
// RequireAdmin in the route tree.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { RfpAnalyticsSection } from '@/components/settings/RfpAnalyticsSection';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function AdminRfpPage() {
  useDocumentTitle();
  const { t } = useTranslation('rfp');

  return (
    <div className="space-y-6">
      <header className="page-head">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            {t('adminRfp.eyebrow', 'Admin')}
          </p>
          <h1 className="page-title">{t('adminRfp.title', 'RFP Analytics')}</h1>
          <p className="page-sub">
            {t(
              'adminRfp.subtitle',
              'Every RFP across the organisation, its value, and the per-owner breakdown.',
            )}
          </p>
        </div>
        <Link
          to="/proposals"
          className="inline-flex h-11 items-center text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          {t('adminRfp.viewAllProposals', 'View all proposals')}
        </Link>
      </header>

      <RfpAnalyticsSection />
    </div>
  );
}
