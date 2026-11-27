// LanguageSwitcher — lets the user pick their UI language (EN | FR | ES | PT | IT | 中文).
// Persists the choice to localStorage + cookie (bidstack-locale) so both the
// i18next LanguageDetector and the API Accept-Language middleware pick it up.
// Updates <html lang> immediately for screen-reader accuracy.
//
// WHY separate from CurrencyLocaleSection: language is a personal preference
// (per-user), whereas currency/timezone are workspace-level defaults.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { isSupportedLocale, type SupportedLocale } from '@/i18n';
import {
  appearanceLanguagePhase,
  appearanceLanguageSnapshot,
  type AppearanceLanguageSource,
} from './appearance-language-read';

// The locales we expose in the switcher. AR is supported in the codebase but
// deferred from the UI switcher until RTL layout is fully QA'd.
type DisplayLocale = 'en' | 'fr' | 'es' | 'pt' | 'it' | 'zh';

const DISPLAY_LOCALES: readonly DisplayLocale[] = ['en', 'fr', 'es', 'pt', 'it', 'zh'];

// Human-readable label always shown in the language itself so the user can
// recognise their own language even when the UI is in another tongue.
const LOCALE_NATIVE_LABEL: Readonly<Record<DisplayLocale, string>> = {
  en: 'EN',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
  it: 'IT',
  zh: '中文',
};

const LOCALE_FULL_LABEL: Readonly<Record<DisplayLocale, string>> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  zh: '中文',
};

const COOKIE_NAME = 'bidstack-locale';
const STORAGE_KEY = 'bidstack-locale';

function persistLocale(locale: SupportedLocale): void {
  // Write localStorage — read by LanguageDetector on next boot.
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore storage errors (private mode, quota) */
  }
  // Write cookie — read by the API Accept-Language middleware.
  document.cookie = `${COOKIE_NAME}=${locale}; path=/; SameSite=Lax; max-age=31536000`;
  // Update <html lang> immediately for screen reader accuracy.
  document.documentElement.lang = locale;
}

function languageReadFlags(i18n: object): Pick<AppearanceLanguageSource, 'isError' | 'status'> {
  const record = i18n as { isError?: unknown; status?: unknown };
  return {
    isError: typeof record.isError === 'boolean' ? record.isError : undefined,
    status: typeof record.status === 'string' ? record.status : undefined,
  };
}

function selectedLocale(data: unknown): DisplayLocale | null {
  if (typeof data !== 'string' || data.length === 0) return null;
  const base = data.split('-')[0] ?? data;
  if (!isSupportedLocale(base)) return null;
  return DISPLAY_LOCALES.includes(base as DisplayLocale) ? (base as DisplayLocale) : null;
}

/** Standalone language-switcher widget rendered inside SettingsPage. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('settings');
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (typeof i18n.on !== 'function' || typeof i18n.off !== 'function') return;
    const onFail = () => {
      if (!i18n.isInitialized) setLoadFailed(true);
    };
    const onInit = () => setLoadFailed(false);
    i18n.on('failedLoading', onFail);
    i18n.on('initialized', onInit);
    return () => {
      i18n.off('failedLoading', onFail);
      i18n.off('initialized', onInit);
    };
  }, [i18n]);

  const flags = languageReadFlags(i18n);
  const read = appearanceLanguageSnapshot({
    language: i18n.language,
    resolvedLanguage: i18n.resolvedLanguage,
    isInitialized: i18n.isInitialized,
    isError: loadFailed || flags.isError === true,
    status: flags.status,
  });
  const phase = appearanceLanguagePhase(read);
  const activeLocale = selectedLocale(read.data);

  const changeLanguage = async (locale: DisplayLocale) => {
    if (locale === activeLocale) return;
    persistLocale(locale);
    await i18n.changeLanguage(locale);
    // Announce change to screen readers via a live region managed by LiveAnnouncer.
    // We dispatch a custom event rather than importing LiveAnnouncer to avoid
    // a circular dep (LiveAnnouncer already imports from i18n).
    window.dispatchEvent(
      new CustomEvent('bidstack:announce', {
        detail: {
          message: t('languageSwitcher.changeSuccess', { lang: LOCALE_FULL_LABEL[locale] }),
        },
      }),
    );
  };

  if (phase === 'unread') {
    return (
      <p role="status">
        {t('languageSwitcher.checking', 'Checking language. The preference has not arrived.')}
      </p>
    );
  }
  if (phase === 'failed') {
    return (
      <p role="alert">
        {t('languageSwitcher.loadError', 'Could not load language. Please retry.')}
      </p>
    );
  }

  const currentLanguage =
    activeLocale != null
      ? t('languageSwitcher.currentLanguage', 'Current language: {{lang}}', {
          lang: LOCALE_FULL_LABEL[activeLocale],
        })
      : typeof read.data === 'string' && read.data.length > 0
        ? t('languageSwitcher.currentLanguage', 'Current language: {{lang}}', {
            lang: read.data,
          })
        : t('languageSwitcher.noneSaved', 'No language preference is saved.');

  return (
    <Card>
      <SectionHeader
        title={t('sections.language.title')}
        caption={t('sections.language.caption')}
      />
      <div className="p-5">
        <fieldset>
          <legend className="sr-only">{t('languageSwitcher.ariaLabel')}</legend>
          {/* Badge-style toggle row: EN | FR | ES | PT | IT | 中文 */}
          <div
            role="group"
            aria-label={t('languageSwitcher.ariaLabel')}
            className="flex gap-2 flex-wrap"
          >
            {DISPLAY_LOCALES.map((locale) => {
              const isActive = locale === activeLocale;
              return (
                <button
                  key={locale}
                  type="button"
                  onClick={() => void changeLanguage(locale)}
                  aria-pressed={isActive}
                  aria-label={`${t('languageSwitcher.label')} ${LOCALE_FULL_LABEL[locale]}`}
                  title={LOCALE_FULL_LABEL[locale]}
                  className={cn(
                    // 44×44 min touch target (WCAG 2.2 AA)
                    'min-w-[44px] min-h-[44px] px-4 py-2',
                    'rounded-lg text-sm font-semibold tracking-wide',
                    'border transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
                    isActive
                      ? [
                          'bg-[var(--accent)] text-white border-[var(--accent)]',
                          'dark:bg-[var(--accent-dim)] dark:text-[var(--accent-fg)] dark:border-[var(--accent-dim)]',
                        ]
                      : [
                          'bg-transparent text-[var(--fg-secondary)] border-[var(--border-subtle)]',
                          'hover:border-[var(--accent)] hover:text-[var(--accent)]',
                          'dark:text-[var(--fg-muted)] dark:hover:text-[var(--accent-fg)]',
                        ],
                  )}
                >
                  <span aria-hidden="true">{LOCALE_NATIVE_LABEL[locale]}</span>
                  <span className="sr-only">{LOCALE_FULL_LABEL[locale]}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--fg-secondary)] dark:text-[var(--fg-muted)]">
            {currentLanguage}
          </p>
        </fieldset>
      </div>
    </Card>
  );
}
