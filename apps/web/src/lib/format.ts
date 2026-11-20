// Locale-aware formatters used across cards and tables. All public functions
// accept an optional `locale` string so they're safe to call from both React
// (thread locale via useUserLocale) and non-React callsites (selectors, loaders,
// tests). When `locale` is omitted the function reads localStorage for the
// user's stored preference, falling back to the browser navigator, then "en".
//
// WHY: hardcoded 'en-US' throughout the codebase broke FR/ES locales —
// numbers, dates, and currency symbols all rendered in English format regardless
// of the user's selected language. Switched to Intl with explicit locale param.

const DEFAULT_LOCALE = 'en';
const DEFAULT_CURRENCY = 'EUR';

// Read the stored locale without importing i18next (keeps this module
// tree-shakable for non-React callers and avoids circular deps).
function detectLocale(): string {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem('bidstack-locale');
    if (stored) return stored;
  } catch {
    /* ignore — storage may be blocked by browser policy */
  }
  return typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : DEFAULT_LOCALE;
}

function detectCurrency(): string {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY;
  try {
    const raw = window.localStorage.getItem('bidstack:currency-locale');
    if (raw) {
      const parsed = JSON.parse(raw) as { currency?: string };
      if (parsed.currency) return parsed.currency;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CURRENCY;
}

export function formatMoney(value: number, currency?: string, locale?: string): string {
  const resolvedCurrency = currency ?? detectCurrency();
  const resolvedLocale = locale ?? detectLocale();
  if (value >= 1_000_000)
    return new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency: resolvedCurrency,
      maximumFractionDigits: 2,
      notation: 'compact',
    }).format(value);
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency: resolvedCurrency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '—';
  const resolvedLocale = locale ?? detectLocale();
  return new Date(iso).toLocaleDateString(resolvedLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function formatStage(stage: string): string {
  return stage
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Format a money amount carried on the wire as integer micros (string).
 * Compacts ≥ 1M as `$1.2M`, ≥ 1k as `$12k`, otherwise full currency.
 * The string-encoded micros preserve BigInt precision over JSON.
 */
export function formatMoneyMicros(
  micros: string | number | bigint,
  currency?: string,
  options: { compact?: boolean; locale?: string } = {},
): string {
  const resolvedCurrency = currency ?? detectCurrency();
  const resolvedLocale = options.locale ?? detectLocale();
  const asBigInt =
    typeof micros === 'bigint'
      ? micros
      : typeof micros === 'number'
        ? BigInt(Math.trunc(micros))
        : BigInt(micros);
  const million = BigInt(1_000_000);
  const whole = asBigInt / million;
  const remainder = asBigInt % million;
  const value = Number(whole) + Number(remainder) / 1_000_000;
  const compact = options.compact ?? Math.abs(value) >= 1000;
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency: resolvedCurrency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

/** Same as formatMoneyMicros but always returns full-precision (e.g. tooltips). */
export function formatMoneyMicrosFull(
  micros: string | number | bigint,
  currency?: string,
  locale?: string,
): string {
  return formatMoneyMicros(micros, currency, { compact: false, locale });
}

/** Render a +/- percentage delta with one decimal. Null → "—". */
export function formatPctDelta(pct: number | null, locale?: string): string {
  if (pct === null || Number.isNaN(pct)) return '—';
  const resolvedLocale = locale ?? detectLocale();
  const sign = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
  return `${sign}${Math.abs(pct).toLocaleString(resolvedLocale, { maximumFractionDigits: 1 })}%`;
}

/**
 * Format a 0..1 fraction as a localized percentage. `null` → "—".
 * Pass `fractionDigits` to override (default 0 — "73%", not "73.4%").
 */
export function formatPercent(
  value: number | null,
  options: { fractionDigits?: number; locale?: string } = {},
): string {
  if (value === null || Number.isNaN(value)) return '—';
  const resolvedLocale = options.locale ?? detectLocale();
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'percent',
    minimumFractionDigits: options.fractionDigits ?? 0,
    maximumFractionDigits: options.fractionDigits ?? 0,
  }).format(value);
}

export function relativeTime(iso: string, locale?: string): string {
  const resolvedLocale = locale ?? detectLocale();
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: 'auto' });
  if (sec < 60) return rtf.format(-sec, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, 'hour');
  const day = Math.floor(hr / 24);
  if (day < 30) return rtf.format(-day, 'day');
  return new Date(iso).toLocaleDateString(resolvedLocale, { month: 'short', day: 'numeric' });
}

/**
 * Format a byte count using locale-aware unit display (e.g. "1.2 MB" in
 * en-US, "1,2 Mo" in fr).
 */
export function formatBytes(bytes: number, locale?: string): string {
  const resolvedLocale = locale ?? detectLocale();
  const safe = Math.max(0, bytes);
  const units: Array<{ unit: 'byte' | 'kilobyte' | 'megabyte' | 'gigabyte' | 'terabyte'; threshold: number }> = [
    { unit: 'terabyte', threshold: 1024 ** 4 },
    { unit: 'gigabyte', threshold: 1024 ** 3 },
    { unit: 'megabyte', threshold: 1024 ** 2 },
    { unit: 'kilobyte', threshold: 1024 },
  ];
  const match = units.find((u) => safe >= u.threshold);
  const unit = match?.unit ?? 'byte';
  const divisor = match?.threshold ?? 1;
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(safe / divisor);
}

/**
 * Locale-aware list formatter — "Alice, Bob and Carol" (en) vs
 * "Alice, Bob et Carol" (fr) vs "Alice, Bob y Carol" (es).
 */
export function formatList(items: readonly string[], locale?: string): string {
  const resolvedLocale = locale ?? detectLocale();
  return new Intl.ListFormat(resolvedLocale, { style: 'long', type: 'conjunction' }).format(items);
}
