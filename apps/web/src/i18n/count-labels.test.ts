// A count of one must not wear a plural noun. i18next picks the CLDR
// category, so French zero is singular too. Hardcoded "{{count}} contacts"
// would keep reading "1 contacts" and "0 contacts" in French.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstance, type i18n as I18n } from 'i18next';
import { describe, expect, it } from 'vitest';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '../../public/locales');

function load(locale: string, namespace: string): object {
  return JSON.parse(readFileSync(join(localesDir, locale, `${namespace}.json`), 'utf8')) as object;
}

async function translator(locale: string): Promise<I18n> {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: 'en',
    ns: ['crm', 'integrations'],
    defaultNS: 'crm',
    interpolation: { escapeValue: false },
    resources: {
      [locale]: {
        crm: load(locale, 'crm'),
        integrations: load(locale, 'integrations'),
      },
    },
  });
  return instance;
}

describe('count labels', () => {
  it('uses the singular English noun for one record and the plural for many', async () => {
    const t = await translator('en');
    expect(t.t('topAccounts.resultCount', { count: 1 })).toBe('1 account');
    expect(t.t('topAccounts.resultCount', { count: 4 })).toBe('4 accounts');
    expect(t.t('topAccounts.openDeals', { count: 1 })).toBe('1 open deal');
    expect(t.t('topAccounts.contacts', { count: 1 })).toBe('1 contact');
    expect(t.t('accounts.summary.openDeals', { count: 1 })).toBe('1 open deal');
    expect(t.t('contacts.countCaption', { count: 1 })).toBe('1 contact');
    expect(t.t('companyDetail.meta.employees', { count: 1 })).toBe('1 employee');
    expect(t.t('references.resultCount', { count: 1 })).toBe('1 reference');
    expect(t.t('salesToolkits.resultCount', { count: 2 })).toBe('2 courses');
    expect(t.t('commandCenter.committee.buyers', { count: 2 })).toBe('2 buyers mapped');
    expect(t.t('connectors.header.sourcesBadge', { ns: 'integrations', count: 1 })).toBe('1 source');
    expect(t.t('pipelineByStageMini.dealCount', { count: 1 })).toBe('1 deal');
    expect(t.t('oppIndustryBreakdown.sectorCount', { count: 2 })).toBe('2 sectors');
    expect(t.t('activityTimeline.itemCount', { count: 1 })).toBe('Last 1 item');
    expect(t.t('activityTimeline.itemCount', { count: 3 })).toBe('Last 3 items');
    expect(t.t('sectorView.geoIndustryMeta', { count: 1, value: '2.7M unspecified' })).toBe(
      '1 opp · 2.7M unspecified',
    );
    expect(t.t('sectorView.geoIndustryMeta', { count: 3, value: '8M unspecified' })).toBe(
      '3 opps · 8M unspecified',
    );
    expect(t.t('customObjectNavItem.recordCountLabel', { count: 1 })).toBe('1 record');
  });

  it('uses the French singular for zero as well as one', async () => {
    const t = await translator('fr');
    expect(t.t('topAccounts.resultCount', { count: 0 })).toBe('0 compte');
    expect(t.t('topAccounts.resultCount', { count: 1 })).toBe('1 compte');
    expect(t.t('topAccounts.resultCount', { count: 2 })).toBe('2 comptes');
    expect(t.t('accounts.summary.openDeals', { count: 1 })).toBe('1 affaire ouverte');
    expect(t.t('references.resultCount', { count: 1 })).toBe('1 référence');
  });
});
