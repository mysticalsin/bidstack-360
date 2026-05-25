// LanguageSwitcher — lets the user pick their UI language (EN | FR | ES).
// Persists the choice to localStorage + cookie (bidstack-locale) so both the
// i18next LanguageDetector and the API Accept-Language middleware pick it up.
// Updates <html lang> immediately for screen-reader accuracy.
//
// WHY separate from CurrencyLocaleSection: language is a personal preference
// (per-user), whereas currency/timezone are workspace-level defaults.

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { isSupportedLocale, type SupportedLocale } from '@/i18n';

// The locales we expose in the switcher this wave. AR is supported in the
// codebase but deferred from the UI switcher until RTL layout is fully QA'd.
type DisplayLocale = 'en' | 'fr' | 'es';

const DISPLAY_LOCALES: readonly DisplayLocale[] = ['en', 'fr', 'es'];

// Human-readable label always shown in the language itself so the user can
// recognise their own language even when the UI is in another tongue.
const LOCALE_NATIVE_LABEL: Readonly<Record<DisplayLocale, string>> = {
  en: 'EN',
  fr: 'FR',
  es: 'ES',
};

const LOCALE_FULL_LABEL: Readonly<Record<DisplayLocale, string>> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
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

/** Standalone language-switcher widget rendered inside SettingsPage. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('settings');

  const rawLocale = isSupportedLocale(i18n.language) ? i18n.language : 'en';
  const activeLocale: DisplayLocale = DISPLAY_LOCALES.includes(
    rawLocale as DisplayLocale,
  )
    ? (rawLocale as DisplayLocale)
    : 'en';

  const changeLanguage = useCallback(
    async (locale: DisplayLocale) => {
      if (locale === activeLocale) return;
      persistLocale(locale);
      await i18n.changeLanguage(locale);
      // Announce change to screen readers via a live region managed by LiveAnnouncer.
      // We dispatch a custom event rather than importing LiveAnnouncer to avoid
      // a circular dep (LiveAnnouncer already imports from i18n).
      window.dispatchEvent(
        new CustomEvent('bidstack:announce', {
          detail: { message: t('languageSwitcher.changeSuccess', { lang: LOCALE_FULL_LABEL[locale] }) },
        }),
      );
    },
    [activeLocale, i18n, t],
  );

  return (
    <Card>
      <SectionHeader
        title={t('sections.language.title')}
        caption={t('sections.language.caption')}
      />
      <div className="p-5">
        <fieldset>
          <legend className="sr-only">{t('languageSwitcher.ariaLabel')}</legend>
          {/* Badge-style toggle row: EN | FR | ES */}
          <div role="group" aria-label={t('languageSwitcher.ariaLabel')} className="flex gap-2 flex-wrap">
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
            {t('languageSwitcher.currentLanguage', { lang: LOCALE_FULL_LABEL[activeLocale] })}
          </p>
        </fieldset>
      </div>
    </Card>
  );
}
