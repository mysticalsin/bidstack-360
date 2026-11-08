import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { usePoloPublicIdentity, type PoloPublicIdentity } from '@/hooks/usePoloIdentity';

const LAST_MODE_KEY = 'polo:last-data-mode';

function readLastMode(): PoloPublicIdentity['dataMode'] {
  try {
    return localStorage.getItem(LAST_MODE_KEY) === 'real' ? 'real' : 'demo';
  } catch {
    return 'demo';
  }
}

function rememberMode(mode: PoloPublicIdentity['dataMode']) {
  try {
    if (localStorage.getItem(LAST_MODE_KEY) !== mode) localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    // Storage can be blocked; the placeholder then falls back to demo.
  }
}

const REAL_CLASS =
  'border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-2 text-xs text-[var(--fg-secondary)] break-words';
const DEMO_CLASS =
  'border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-950 dark:text-amber-100 break-words';

export function DataModeBanner() {
  const { t } = useTranslation('settings');
  const identity = usePoloPublicIdentity();
  const data = identity.data;
  const mode = data?.dataMode;
  useEffect(() => {
    if (mode) rememberMode(mode);
  }, [mode]);

  if (!data) {
    if (!identity.isLoading) return null;
    // The banner sits above the topbar, so appearing late pushes the whole page
    // down. Reserve its box with the same copy (hidden) for the last-known mode.
    const lastMode = readLastMode();
    return (
      <div
        aria-hidden="true"
        data-testid="data-mode-banner-placeholder"
        className={lastMode === 'real' ? REAL_CLASS : DEMO_CLASS}
      >
        <span className="invisible">
          {lastMode === 'real' ? (
            <>
              {t(
                'dataModeBanner.real',
                'Real-data mode. Signed MSAs and revenue figures are live. Changes are audited.',
              )}{' '}
              {t('dataModeBanner.identityLink', 'Identity & roles')}
            </>
          ) : (
            <>
              <strong className="font-semibold">{t('dataModeBanner.demoTitle', 'DEMO MODE')}</strong>
              {': '}
              {t(
                'dataModeBanner.demo',
                'Fixture and synthetic data only. Do not load real accounts, revenue, or signed MSAs until POLO_DATA_MODE=real and Cloudflare Access identity are configured.',
              )}{' '}
              {t('dataModeBanner.whyLink', 'Why this banner')}
            </>
          )}
        </span>
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
