import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { usePoloPublicIdentity } from '@/hooks/usePoloIdentity';

const REAL_CLASS =
  'border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-2 text-xs text-[var(--fg-secondary)] break-words';
const DEMO_CLASS =
  'border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-950 dark:text-amber-100 break-words';
// Same box as the settled real bar, without amber. Loading and failure must
// not wear a mode color. A stored mode is not an answer.
const PENDING_CLASS = REAL_CLASS;

export function DataModeBanner() {
  const { t } = useTranslation('settings');
  const identity = usePoloPublicIdentity();
  const data = identity.data;

  if (!data) {
    const label = identity.isLoading
      ? t('dataModeBanner.loading', 'Loading')
      : t('dataModeBanner.error', 'Could not load');
    return (
      <div
        role="status"
        aria-label={label}
        data-testid="data-mode-banner"
        className={PENDING_CLASS}
      >
        {label}
      </div>
    );
  }

  if (data.dataMode === 'real') {
    return (
      <div
        role="status"
        data-testid="data-mode-banner"
        className={REAL_CLASS}
      >
        {t(
          'dataModeBanner.real',
          'Real-data mode. Signed MSAs and revenue figures are live. Changes are audited.',
        )}{' '}
        <Link to="/settings?tab=identity" className="underline underline-offset-2">
          {t('dataModeBanner.identityLink', 'Identity & roles')}
        </Link>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="data-mode-banner"
      className={DEMO_CLASS}
    >
      <strong className="font-semibold">{t('dataModeBanner.demoTitle', 'DEMO MODE')}</strong>
      {': '}
      {t(
        'dataModeBanner.demo',
        'Fixture and synthetic data only. Do not load real accounts, revenue, or signed MSAs until POLO_DATA_MODE=real and Cloudflare Access identity are configured.',
      )}{' '}
      <Link to="/settings?tab=identity" className="underline underline-offset-2">
        {t('dataModeBanner.whyLink', 'Why this banner')}
      </Link>
    </div>
  );
}
