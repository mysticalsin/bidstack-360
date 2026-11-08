import { useEffect } from 'react';

import { useOrgLocaleSettings } from '@/hooks/useOrgLocaleSettings';
import { useCurrencyStore } from '@/stores/currency';

/**
 * Feeds the workspace currency (Settings, Currency and locale) into the
 * display-currency store. Renders nothing; mounted once in the top bar.
 */
export function OrgCurrencySync() {
  const orgCurrency = useOrgLocaleSettings().data?.currency;
  const applyOrgCurrency = useCurrencyStore((s) => s.applyOrgCurrency);
  useEffect(() => {
    if (orgCurrency) applyOrgCurrency(orgCurrency);
  }, [orgCurrency, applyOrgCurrency]);
  return null;
}
