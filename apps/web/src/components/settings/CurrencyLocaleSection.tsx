import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useOrgLocaleSettings, useUpdateOrgLocaleSettings } from '@/hooks/useOrgLocaleSettings';
import { useIsAdmin } from '@/lib/auth';
import {
  ORG_LOCALE_CURRENCIES,
  ORG_LOCALE_DATE_FORMATS,
  ORG_LOCALE_TIMEZONES,
  type OrgLocaleSettings,
} from '@bidstack/shared';

const CURRENCY_LABELS: Record<OrgLocaleSettings['currency'], string> = {
  CAD: 'CAD - Canadian Dollar',
  USD: 'USD - US Dollar',
  EUR: 'EUR - Euro',
  GBP: 'GBP - British Pound',
  AUD: 'AUD - Australian Dollar',
  JPY: 'JPY - Japanese Yen',
};

// bidstack/src/lib/format.ts's detectCurrency() reads this exact flat shape
// to pick formatMoney's default currency for non-React callsites. Keep it in
// sync with the server-persisted org setting on every load and save, or
// formatMoney silently falls back to EUR regardless of the saved workspace
// currency.
const CURRENCY_LOCALE_STORAGE_KEY = 'bidstack:currency-locale';

function syncCurrencyLocaleStorage(settings: OrgLocaleSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CURRENCY_LOCALE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore — storage may be blocked by browser policy */
  }
}

export function CurrencyLocaleSection() {
  const { t } = useTranslation('settings');
  const locale = useOrgLocaleSettings();

  if (locale.isLoading) return <LoadingSkeleton rows={3} />;
  if (locale.isError || !locale.data) {
    return (
      <ErrorState
        title={t('currencyLocale.loadErrorTitle', 'Could not load currency and locale')}
        message={
          locale.error?.message ?? t('currencyLocale.loadErrorMessage', 'Try again shortly.')
        }
      />
    );
  }

  return <CurrencyLocaleForm key={JSON.stringify(locale.data)} initial={locale.data} />;
}

function CurrencyLocaleForm({ initial }: { initial: OrgLocaleSettings }) {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const update = useUpdateOrgLocaleSettings();
  const [values, setValues] = useState(initial);
  const changed =
    values.currency !== initial.currency ||
    values.dateFormat !== initial.dateFormat ||
    values.timezone !== initial.timezone;

  // Sync on every successful load — this form remounts (via the `key` on the
  // parent) whenever fresh server data arrives, so keying the effect on
  // `initial` covers both the first load and any refetch.
  useEffect(() => {
    syncCurrencyLocaleStorage(initial);
  }, [initial]);

  const patch = (next: Partial<OrgLocaleSettings>) => {
    setValues((current) => ({ ...current, ...next }));
  };

  const onSave = () => {
    update.mutate(values, {
      onSuccess: (data) => {
        syncCurrencyLocaleStorage(data);
        toast.success(t('currencyLocale.saveSuccess', 'Currency and locale saved'));
      },
      onError: (err: Error) =>
        toast.error(t('currencyLocale.saveError', 'Could not save currency and locale'), {
          description: err.message,
        }),
    });
  };

  const disabled = !isAdmin || update.isPending;

  return (
    <Card>
      <SectionHeader
        title={t('currencyLocale.title', 'Currency & locale')}
        caption={t(
          'currencyLocale.caption',
          'Default currency, date format, and timezone for your workspace.',
        )}
      />
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
        <div>
          <label
            htmlFor="org-default-currency"
            className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
          >
            {t('currencyLocale.currencyLabel', 'Default currency')}
          </label>
          <select
            id="org-default-currency"
            className="input w-full"
            disabled={disabled}
            value={values.currency}
            onChange={(e) => patch({ currency: e.target.value as OrgLocaleSettings['currency'] })}
          >
            {ORG_LOCALE_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {t(`currencyLocale.currency.${currency.toLowerCase()}`, CURRENCY_LABELS[currency])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="org-date-format"
            className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
          >
            {t('currencyLocale.dateFormatLabel', 'Date format')}
          </label>
          <select
            id="org-date-format"
            className="input w-full"
            disabled={disabled}
            value={values.dateFormat}
            onChange={(e) =>
              patch({ dateFormat: e.target.value as OrgLocaleSettings['dateFormat'] })
            }
          >
            {ORG_LOCALE_DATE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="org-timezone"
            className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
          >
            {t('currencyLocale.timezoneLabel', 'Timezone')}
          </label>
          <select
            id="org-timezone"
            className="input w-full"
            disabled={disabled}
            value={values.timezone}
            onChange={(e) => patch({ timezone: e.target.value as OrgLocaleSettings['timezone'] })}
          >
            {ORG_LOCALE_TIMEZONES.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--fg-tertiary)]">
          {isAdmin
            ? t(
                'currencyLocale.persistedHint',
                'Saved defaults apply to everyone in this workspace.',
              )
            : t(
                'currencyLocale.readOnlyHint',
                'Workspace defaults are read-only unless you are an admin.',
              )}
        </p>
        <Button
          variant="primary"
          onClick={onSave}
          disabled={disabled || !changed}
          aria-label={t('currencyLocale.saveButton', 'Save currency and locale')}
        >
          {update.isPending
            ? t('currencyLocale.savingButton', 'Saving...')
            : t('currencyLocale.saveButton', 'Save currency and locale')}
        </Button>
      </div>
    </Card>
  );
}
