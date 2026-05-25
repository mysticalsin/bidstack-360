// i18next bootstrap. Loads JSON resources from /locales/{lng}/{ns}.json at
// runtime via http-backend, with language detected from cookie → localStorage
// → navigator → fallback en. The dev stub auth ships English; production EU
// tenants will land in fr / es / ar based on the browser.
//
// Namespaces:
//   common       — nav, buttons, generic UI strings (the lion's share)
//   auth         — sign-in / sign-out flows
//   crm          — entity labels, stage names, KPI captions
//   settings     — Settings page section titles + helper text
//   onboarding   — guided tour, quick-start, sample data banner
//   ai           — Dust agents, meeting prep, account intel
//   reports      — report builder, chart labels, periods
//   signatures   — e-signature send modal, signing pad, timeline
//   integrations — connector status labels, connect/disconnect flows
//
// Adding a new locale: drop apps/web/public/locales/{lng}/{ns}.json files,
// add the code to SUPPORTED_LOCALES below.

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'ar'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set(['ar']);

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const NAMESPACES = [
  'common',
  'auth',
  'crm',
  'settings',
  'onboarding',
  'ai',
  'reports',
  'signatures',
  'integrations',
] as const;

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value != null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale as SupportedLocale);
}

// Test environments preload synchronous resources via init() to avoid the
// network-backend's lazy-load races inside Vitest. Production / dev fetch
// from /locales/{lng}/{ns}.json.
const isTest = typeof import.meta.env !== 'undefined' && import.meta.env.MODE === 'test';

void i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    // Strip region from "en-US" → "en" so we only fetch the locales we ship.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'common',
    fallbackNS: 'common',
    // Synchronous boot for tests; async lazy-load for runtime.
    initImmediate: !isTest,
    interpolation: {
      // React already escapes JSX output — double escaping would mangle
      // values that legitimately contain HTML entities (e.g. company names).
      escapeValue: false,
    },
    detection: {
      // Cookie wins so a server-rendered locale (Set-Cookie from the API
      // Accept-Language middleware) takes precedence over the browser; the
      // CurrencyLocale switcher writes both cookie + localStorage.
      order: ['cookie', 'localStorage', 'navigator', 'htmlTag'],
      lookupCookie: 'bidstack-locale',
      lookupLocalStorage: 'bidstack-locale',
      caches: ['cookie', 'localStorage'],
      cookieOptions: { path: '/', sameSite: 'lax' },
    },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    react: {
      // Wait for translations before rendering — prevents the
      // English-key flash on initial paint for non-en users.
      useSuspense: false,
    },
  });

export { i18n };
