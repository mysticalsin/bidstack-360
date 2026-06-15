import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, SectionHeader } from '@/components/ui/Card';

const STORAGE_KEY = 'bidstack:currency-locale';

interface CurrencyLocale {
  currency: string;
  dateFormat: string;
  timezone: string;
}

function load(): CurrencyLocale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { currency: 'CAD', dateFormat: 'YYYY-MM-DD', timezone: 'America/Toronto' };
}

export function CurrencyLocaleSection() {
  const { t } = useTranslation('settings');
  const [values, setValues] = useState(load);

  const update = (patch: Partial<CurrencyLocale>) => {
    const next = { ...values, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode — silent */
    }
    setValues(next);
  };

  return (
    <Card>
      <SectionHeader
        title={t('currencyLocale.title', 'Currency & locale')}
        caption={t(
          'currencyLocale.caption',
          'Default currency, date format, and timezone for your workspace.',
        )}
      />
      <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
            {t('currencyLocale.currencyLabel', 'Default currency')}
          </label>
          <select
            className="input w-full"
            value={values.currency}
            onChange={(e) => update({ currency: e.target.value })}
          >
            <option value="CAD">{t('currencyLocale.currency.cad', 'CAD — Canadian Dollar')}</option>
            <option value="USD">{t('currencyLocale.currency.usd', 'USD — US Dollar')}</option>
            <option value="EUR">{t('currencyLocale.currency.eur', 'EUR — Euro')}</option>
            <option value="GBP">{t('currencyLocale.currency.gbp', 'GBP — British Pound')}</option>
            <option value="AUD">{t('currencyLocale.currency.aud', 'AUD — Australian Dollar')}</option>
            <option value="JPY">{t('currencyLocale.currency.jpy', 'JPY — Japanese Yen')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
            {t('currencyLocale.dateFormatLabel', 'Date format')}
          </label>
          <select
            className="input w-full"
            value={values.dateFormat}
            onChange={(e) => update({ dateFormat: e.target.value })}
          >
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD.MM.YYYY">DD.MM.YYYY</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
            {t('currencyLocale.timezoneLabel', 'Timezone')}
          </label>
          <select
            className="input w-full"
            value={values.timezone}
            onChange={(e) => update({ timezone: e.target.value })}
          >
            <option value="America/Toronto">America/Toronto</option>
            <option value="America/New_York">America/New_York</option>
            <option value="America/Chicago">America/Chicago</option>
            <option value="America/Denver">America/Denver</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
            <option value="Europe/Paris">Europe/Paris</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="Australia/Sydney">Australia/Sydney</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      </div>
    </Card>
  );
}
