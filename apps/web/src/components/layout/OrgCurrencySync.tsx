import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrgLocaleSettings } from '@/hooks/useOrgLocaleSettings';
import { useCurrencyStore } from '@/stores/currency';

import { orgCurrencyPhase } from './org-currency-read';

/**
 * Feeds the workspace currency into the display-currency store once the
 * locale read has arrived. Mounted once in the top bar.
 */
function currencyCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const currency = (data as { currency?: unknown }).currency;
  if (typeof currency !== 'string') return null;
  const trimmed = currency.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function OrgCurrencySync() {
  const { t } = useTranslation();
  const locale = useOrgLocaleSettings();
  const applyOrgCurrency = useCurrencyStore((s) => s.applyOrgCurrency);
  const phase = orgCurrencyPhase(locale);
  const code = phase === 'ready' ? currencyCode(locale.data) : null;

  useEffect(() => {
    if (phase !== 'ready' || code === null) return;
    applyOrgCurrency(code);
  }, [phase, code, applyOrgCurrency]);

  if (phase === 'unread') {
    return (
      <p className="text-xs text-[var(--fg-secondary)]">
        {t(
          'orgCurrencySync.checking',
          'Checking the workspace currency. The currency has not arrived.',
        )}
      </p>
    );
  }
  if (phase === 'failed') {
    return (
      <p role="alert" className="text-xs text-[var(--fg-secondary)]">
        {t('orgCurrencySync.loadError', 'Could not load the workspace currency.')}
      </p>
    );
  }
  return null;
}
