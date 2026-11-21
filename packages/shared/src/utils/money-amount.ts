/**
 * A money amount is an integer in that currency's minor unit, plus the
 * ISO 4217 code. Display uses this code. There is no conversion step:
 * a header selector is only a label when it differs.
 *
 * Storage elsewhere is still micros (major unit × 1e6). `moneyFromMicros`
 * rounds half away from zero onto the minor unit. Yen, peso, and won have
 * no fraction, so a half unit becomes the next whole unit.
 */

export type Money = {
  amountMinor: bigint;
  currency: string;
};

export type FormattedMoney = {
  text: string;
  currency: string;
};

export type MoneyRollup =
  | { kind: 'single'; total: Money }
  | { kind: 'mixed'; subtotals: Money[] };

const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const MICROS_PER_MAJOR = 1_000_000n;

export function minorUnitDigits(currency: string): number {
  const code = normalizeCurrency(currency);
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export function money(amountMinor: bigint, currency: string): Money {
  return { amountMinor, currency: normalizeCurrency(currency) };
}

/** Round micros onto the currency's minor unit, half away from zero. */
export function moneyFromMicros(micros: bigint, currency: string): Money {
  const code = normalizeCurrency(currency);
  const digits = minorUnitDigits(code);
  const perMinor = MICROS_PER_MAJOR / 10n ** BigInt(digits);
  return { amountMinor: roundAwayFromZero(micros, perMinor), currency: code };
}

export function formatMoneyAmount(
  value: Money,
  options?: { locale?: string; compact?: boolean },
): FormattedMoney {
  const currency = normalizeCurrency(value.currency);
  return {
    currency,
    text: renderAmount(value.amountMinor, currency, options?.locale ?? 'en', options?.compact),
  };
}

/**
 * Render `value` in its own currency. When `selectorCurrency` is a different
 * code, the text says the amount was not converted. No rate is applied.
 */
export function presentMoney(
  value: Money,
  selectorCurrency?: string | null,
  options?: { locale?: string; compact?: boolean },
): FormattedMoney {
  const formatted = formatMoneyAmount(value, options);
  const selected = (selectorCurrency ?? '').trim().toUpperCase();
  if (!selected || selected === formatted.currency) return formatted;
  return {
    currency: formatted.currency,
    text: `${formatted.text} · not converted to ${selected}`,
  };
}

/** Sum only rows that share a currency. Mixed codes stay as subtotals. */
export function aggregateMoney(amounts: readonly Money[]): MoneyRollup {
  const totals = new Map<string, bigint>();
  for (const row of amounts) {
    const currency = normalizeCurrency(row.currency);
    totals.set(currency, (totals.get(currency) ?? 0n) + row.amountMinor);
  }
  const codes = [...totals.keys()].sort();
  if (codes.length === 1) {
    const currency = codes[0]!;
    return { kind: 'single', total: { amountMinor: totals.get(currency)!, currency } };
  }
  return {
    kind: 'mixed',
    subtotals: codes.map((currency) => ({ currency, amountMinor: totals.get(currency)! })),
  };
}

function normalizeCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error('Invalid currency');
  }
  return code;
}

function roundAwayFromZero(value: bigint, unit: bigint): bigint {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const quotient = abs / unit;
  const remainder = abs % unit;
  const rounded = remainder * 2n >= unit ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function renderAmount(
  amountMinor: bigint,
  currency: string,
  locale: string,
  compact: boolean | undefined,
): string {
  const digits = minorUnitDigits(currency);
  const scale = 10n ** BigInt(digits);
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const whole = digits === 0 ? abs : abs / scale;
  const fraction = digits === 0 ? 0n : abs % scale;
  const compactText =
    compact === false || fraction !== 0n || whole < 1000n ? null : compactWhole(whole);
  const { group, decimal } = separators(locale);
  const number =
    compactText ??
    (digits === 0
      ? groupDigits(whole.toString(), group)
      : `${groupDigits(whole.toString(), group)}${decimal}${fraction.toString().padStart(digits, '0')}`);
  const symbol = currencySymbol(locale, currency);
  return `${negative ? '-' : ''}${symbol}${number} ${currency}`;
}

function compactWhole(whole: bigint): string | null {
  const scales: Array<[bigint, string]> = [
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ];
  for (const [divisor, suffix] of scales) {
    if (whole < divisor) continue;
    const places = 2;
    const factor = 10n ** BigInt(places);
    const remainder = whole % divisor;
    if ((remainder * factor) % divisor !== 0n) return null;
    const frac = (remainder * factor) / divisor;
    const fracText = frac.toString().padStart(places, '0').replace(/0+$/, '');
    const body = fracText.length === 0 ? whole / divisor : `${whole / divisor}.${fracText}`;
    return `${body.toString()}${suffix}`;
  }
  return null;
}

function groupDigits(digits: string, group: string): string {
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    parts.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return parts.join(group);
}

function separators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1000.1);
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

function currencySymbol(locale: string, currency: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? '';
  } catch {
    return '';
  }
}
