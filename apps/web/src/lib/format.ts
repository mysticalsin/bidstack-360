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

// A rounded scaled integer of at most 15 digits (trailing zeros counted)
// survives a Number round trip; the bound is conservative.
const NUMBER_EXACT_DIGITS = 15;
let decimalStringsExact: boolean | undefined;

// Engines before Intl.NumberFormat v3 coerce a string argument to Number
// without throwing, so exactness is probed instead of caught.
function intlFormatsDecimalStringsExactly(): boolean {
  if (decimalStringsExact === undefined) {
    try {
      const probe = new Intl.NumberFormat('en-US', {
        useGrouping: false,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      decimalStringsExact =
        probe.format('9007199254740993' as `${number}`) === '9007199254740993.00' &&
        probe.format('1.004999999999999999' as `${number}`) === '1.00';
    } catch {
      decimalStringsExact = false;
    }
  }
  return decimalStringsExact;
}

// Rounds half away from zero with BigInt, then hands Intl a Number that
// already has its final digits. Returns null when that Number could not
// hold them.
function formatPreRounded(
  negative: boolean,
  magnitude: bigint,
  format: Intl.NumberFormat,
): string | null {
  const fractionDigits = Math.min(format.resolvedOptions().maximumFractionDigits ?? 2, 6);
  const step = BigInt(10) ** BigInt(6 - fractionDigits);
  let scaled = magnitude / step;
  if ((magnitude % step) * BigInt(2) >= step) scaled += BigInt(1);
  if (scaled.toString().length > NUMBER_EXACT_DIGITS) return null;
  const unit = BigInt(10) ** BigInt(fractionDigits);
  const fraction = (scaled % unit).toString().padStart(fractionDigits, '0');
  const text = `${negative ? '-' : ''}${scaled / unit}${fractionDigits ? `.${fraction}` : ''}`;
  return format.format(Number(text));
}

/**
 * Format a money amount carried on the wire as integer micros (string).
 * Compacts ≥ 1M as `$1.2M`, ≥ 1k as `$12k`, otherwise full currency.
 * The string-encoded micros preserve BigInt precision over JSON.
 *
 * Exact digits need string or bigint micros, or a safe integer Number. A
 * Number past Number.MAX_SAFE_INTEGER may already be rounded, so it returns
 * an em dash in every notation. Without Intl decimal-string support,
 * compact requests render the exact full amount. Anything that cannot be
 * shown exactly returns an em dash.
 */
export function formatMoneyMicros(
  micros: string | number | bigint,
  currency?: string,
  options: { compact?: boolean; locale?: string } = {},
): string {
  // A Number past MAX_SAFE_INTEGER may already be a rounded integer, and
  // even compact rounding can show its lost digits.
  if (
    typeof micros === 'number' &&
    !(Number.isFinite(micros) && Math.abs(Math.trunc(micros)) <= Number.MAX_SAFE_INTEGER)
  ) {
    return '—';
  }
  const resolvedCurrency = currency ?? detectCurrency();
  const resolvedLocale = options.locale ?? detectLocale();
  const asBigInt =
    typeof micros === 'bigint'
      ? micros
      : typeof micros === 'number'
        ? BigInt(Math.trunc(micros))
        : BigInt(micros);
  const million = BigInt(1_000_000);
  const negative = asBigInt < BigInt(0);
  const magnitude = negative ? -asBigInt : asBigInt;
  const compact = options.compact ?? magnitude >= BigInt(1000) * million;
  const exactIntl = intlFormatsDecimalStringsExactly();
  const standard = (): Intl.NumberFormat =>
    new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency: resolvedCurrency,
      maximumFractionDigits: 2,
    });
  if (!exactIntl) return formatPreRounded(negative, magnitude, standard()) ?? '—';
  const exact = `${negative ? '-' : ''}${magnitude / million}.${(magnitude % million)
    .toString()
    .padStart(6, '0')}` as `${number}`;
  if (!compact) return standard().format(exact);
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency: resolvedCurrency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(exact);
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
