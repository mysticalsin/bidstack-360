// A paused or in-flight language read has no preference yet. The Appearance
// switcher marked English pressed, which is how a settled English choice looks.
// The preference has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const i18nState = vi.hoisted(() => ({
  language: undefined as string | null | undefined,
  resolvedLanguage: undefined as string | null | undefined,
  isInitialized: false,
  isError: false as boolean | undefined,
  status: 'pending' as string | undefined,
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
    i18n: {
      get language() {
        return i18nState.language;
      },
      get resolvedLanguage() {
        return i18nState.resolvedLanguage;
      },
      get isInitialized() {
        return i18nState.isInitialized;
      },
      get isError() {
        return i18nState.isError;
      },
      get status() {
        return i18nState.status;
      },
      changeLanguage: vi.fn(),
    },
    }),
  };
});

import { LanguageSwitcher } from './LanguageSwitcher';

const CHECKING = 'Checking language. The preference has not arrived.';
const FAILED = 'Could not load language. Please retry.';
const NONE_SAVED = 'No language preference is saved.';

function renderSwitcher() {
  render(<LanguageSwitcher />);
}

describe('LanguageSwitcher read', () => {
  afterEach(() => {
    cleanup();
    i18nState.language = undefined;
    i18nState.resolvedLanguage = undefined;
    i18nState.isInitialized = false;
    i18nState.isError = false;
    i18nState.status = 'pending';
  });

  it('does not treat a paused language read as English', () => {
    // WHY: a paused first read has no preference. English pressed is a settled
    // choice. This one has not arrived.
    i18nState.language = undefined;
    i18nState.isInitialized = false;
    i18nState.isError = false;
    i18nState.status = 'pending';

    renderSwitcher();

    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    expect(screen.queryByText('English')).toBeNull();
    expect(screen.queryByText('Current language: English')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE_SAVED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight language read as the English default', () => {
    // WHY: i18next can already say "en" while detection is still running.
    // That fallback is not a saved preference.
    i18nState.language = 'en';
    i18nState.resolvedLanguage = 'en';
    i18nState.isInitialized = false;
    i18nState.isError = false;
    i18nState.status = 'pending';

    renderSwitcher();

    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    expect(screen.queryByText('English')).toBeNull();
    expect(screen.queryByText('Current language: English')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed language read on the error', () => {
    // WHY: a failed read is not an unread pause and not the English default.
    i18nState.language = undefined;
    i18nState.isInitialized = false;
    i18nState.isError = true;
    i18nState.status = 'error';

    renderSwitcher();

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    expect(screen.queryByText('English')).toBeNull();
    expect(screen.queryByText(NONE_SAVED)).toBeNull();
  });

  it('lets a failed status win over a stale language', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Francais pressed when isError is still false.
    i18nState.language = 'fr';
    i18nState.resolvedLanguage = 'fr';
    i18nState.isInitialized = true;
    i18nState.isError = false;
    i18nState.status = 'error';

    renderSwitcher();

    expect(screen.queryByText('Français')).toBeNull();
    expect(screen.queryByText('Current language: Français')).toBeNull();
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('English')).toBeNull();
  });

  it('drops a stale language when the read is in error', () => {
    // WHY: isError wins even when a previous language is still on the source.
    // That language is not the settled preference.
    i18nState.language = 'fr';
    i18nState.resolvedLanguage = 'fr';
    i18nState.isInitialized = true;
    i18nState.isError = true;
    i18nState.status = 'error';

    renderSwitcher();

    expect(screen.queryByText('Français')).toBeNull();
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on no saved preference when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not the English default.
    i18nState.language = null;
    i18nState.resolvedLanguage = null;
    i18nState.isInitialized = true;
    i18nState.isError = false;
    i18nState.status = 'success';

    renderSwitcher();

    expect(screen.getByText(NONE_SAVED)).toBeTruthy();
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Current language: English')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows a settled English preference', () => {
    // WHY: English that has arrived is the choice. Unread must not replace it,
    // and it must not say the load failed.
    i18nState.language = 'en';
    i18nState.resolvedLanguage = 'en';
    i18nState.isInitialized = true;
    i18nState.isError = false;
    i18nState.status = 'success';

    renderSwitcher();

    expect(screen.getByRole('button', { name: /English/, pressed: true })).toBeTruthy();
    expect(screen.getByText('Current language: English')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE_SAVED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows a settled French preference, including the native label', () => {
    // WHY: a loaded language stays. Unread must not drop it, and a non-English
    // label is still a loaded choice.
    i18nState.language = 'fr';
    i18nState.resolvedLanguage = 'fr';
    i18nState.isInitialized = true;
    i18nState.isError = false;
    i18nState.status = 'success';

    renderSwitcher();

    expect(screen.getByRole('button', { name: /Français/, pressed: true })).toBeTruthy();
    expect(screen.getByText('Current language: Français')).toBeTruthy();
    expect(screen.getByRole('button', { name: /English/, pressed: false })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE_SAVED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
