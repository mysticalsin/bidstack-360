// Small formatters used across cards and tables. No date-fns dep — Intl is
// already present in the runtime.

export function formatMoney(value: number, currency = 'EUR'): string {
  if (value >= 1_000_000)
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      notation: 'compact',
    }).format(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
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
  currency = 'CAD',
  options: { compact?: boolean } = {},
): string {
  // Convert micros → unit value (whole + fractional). We split rather than
  // going through Number directly to keep precision on very large totals.
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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

/** Same as formatMoneyMicros but always returns full-precision (e.g. tooltips). */
export function formatMoneyMicrosFull(micros: string | number | bigint, currency = 'CAD'): string {
  return formatMoneyMicros(micros, currency, { compact: false });
}

/** Render a +/- percentage delta with one decimal. Null → "—". */
export function formatPctDelta(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return '—';
  const sign = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
