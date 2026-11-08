import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatStage,
  formatMoney,
  formatMoneyMicros,
  formatMoneyMicrosFull,
  daysUntil,
} from './format.js';

describe('formatStage', () => {
  it('humanizes snake_case enum values for display', () => {
    expect(formatStage('closed_won')).toBe('Closed Won');
    expect(formatStage('s1_ongoing')).toBe('S1 Ongoing');
    expect(formatStage('in_progress')).toBe('In Progress');
  });
});

describe('formatMoney', () => {
  it('uses compact notation for sums >= 1M (so dashboard cards stay scannable)', () => {
    const out = formatMoney(1_240_000, 'EUR');
    expect(out).toMatch(/1\.24\s*M/);
  });

  it('uses zero-decimal notation under 1M', () => {
    const out = formatMoney(320_000, 'EUR');
    expect(out).toMatch(/320,000/);
  });
});

// Expected strings are literal so a renderer that drifts through Number cannot
// pass by agreeing with itself. Prisma money columns are BigInt (int8), whose
// ceiling 9223372036854775807 micros is ~9.2e12 units.
describe('formatMoneyMicros exact digits', () => {
  const full = (micros: string | bigint, currency: string, locale = 'en-US') =>
    formatMoneyMicros(micros, currency, { compact: false, locale });

  it('renders every whole unit of values past Number.MAX_SAFE_INTEGER units', () => {
    expect(full(9007199254740993000000n, 'EUR')).toBe('€9,007,199,254,740,993.00');
    expect(full(-9007199254740993000000n, 'EUR')).toBe('-€9,007,199,254,740,993.00');
    expect(full('9007199254740993000000', 'USD')).toBe('$9,007,199,254,740,993.00');
  });

  it('rounds cents from the exact micros at the int8 column ceiling', () => {
    expect(full(9223372036854775807n, 'EUR')).toBe('€9,223,372,036,854.78');
    expect(full(9223372036854774999n, 'EUR')).toBe('€9,223,372,036,854.77');
    expect(full(-9223372036854774999n, 'EUR')).toBe('-€9,223,372,036,854.77');
    expect(full(1099511627776004999n, 'EUR')).toBe('€1,099,511,627,776.00');
    expect(full(1099511627776005000n, 'EUR')).toBe('€1,099,511,627,776.01');
  });

  it('rounds half-cents away from zero and keeps sub-cent amounts', () => {
    expect(full(1_005_000n, 'EUR')).toBe('€1.01');
    expect(full(1_004_999n, 'EUR')).toBe('€1.00');
    expect(full(-1_005_000n, 'EUR')).toBe('-€1.01');
    expect(full(10_000n, 'EUR')).toBe('€0.01');
    expect(full(999_999n, 'EUR')).toBe('€1.00');
    expect(full(123_456_789n, 'USD')).toBe('$123.46');
  });

  it('renders zero without a sign', () => {
    expect(full(0n, 'EUR')).toBe('€0.00');
    expect(full('0', 'USD')).toBe('$0.00');
    expect(formatMoneyMicros(0, 'EUR', { locale: 'en-US' })).toBe('€0.00');
  });

  it('applies locale grouping, decimal marks and currency placement', () => {
    expect(full(-1234567890000n, 'EUR', 'fr-FR')).toBe('-1\u202f234\u202f567,89\u00a0€');
    expect(full(1234567890000n, 'BRL', 'pt-BR')).toBe('R$\u00a01.234.567,89');
    expect(full(-1234567000000n, 'SEK', 'sv-SE')).toBe('\u22121\u00a0234\u00a0567,00\u00a0kr');
    expect(full(1234567000000n, 'JPY')).toBe('¥1,234,567');
  });

  it('keeps compact display rounding for scannable cards', () => {
    expect(formatMoneyMicros(9007199254740993000000n, 'EUR', { locale: 'en-US' })).toBe(
      '€9007.2T',
    );
    expect(formatMoneyMicros(1_234_000_000n, 'USD', { locale: 'en-US' })).toBe('$1.2K');
    expect(formatMoneyMicros(999_990_000n, 'USD', { locale: 'en-US' })).toBe('$999.99');
    expect(formatMoneyMicros(1_000_000_000n, 'USD', { locale: 'en-US' })).toBe('$1K');
  });

  it('formatMoneyMicrosFull shows exact digits for huge values', () => {
    expect(formatMoneyMicrosFull(9007199254740993000000n, 'EUR', 'en-US')).toBe(
      '€9,007,199,254,740,993.00',
    );
  });

  it('renders the int8 minimum and its neighbours from exact input', () => {
    expect(full(-9223372036854775808n, 'EUR')).toBe('-€9,223,372,036,854.78');
    expect(full('-9223372036854775000', 'EUR')).toBe('-€9,223,372,036,854.78');
    expect(full('-9223372036854774999', 'EUR')).toBe('-€9,223,372,036,854.77');
  });

  it('keeps the minus sign on tiny negatives that round to zero cents', () => {
    expect(full(-1n, 'EUR')).toBe('-€0.00');
    expect(full(-4999n, 'EUR')).toBe('-€0.00');
    expect(full(-5000n, 'EUR')).toBe('-€0.01');
  });
});

describe('formatMoneyMicros Number input', () => {
  const full = (micros: number, currency = 'EUR') =>
    formatMoneyMicros(micros, currency, { compact: false, locale: 'en-US' });

  it('formats safe integer Numbers exactly', () => {
    expect(full(9007199254740991)).toBe('€9,007,199,254.74');
    expect(full(-9007199254740991)).toBe('-€9,007,199,254.74');
    expect(full(1_005_000)).toBe('€1.01');
    expect(full(-5000)).toBe('-€0.01');
  });

  it('refuses exact digits for a Number that is no longer the intended integer', () => {
    // -9223372036854775000 as a Number is -9223372036854774784, which would
    // print .77 instead of the intended .78.
    expect(full(-9223372036854775000)).toBe('—');
    expect(full(9007199254740992)).toBe('—');
    expect(full(Number.NaN)).toBe('—');
    expect(full(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('refuses unsafe Numbers in compact notation too, where a lost digit can move the rounding', () => {
    // 9149999999999999999 is stored as the Number 9150000000000000000, so a
    // compact Number reads €9.2T where the intended amount reads €9.1T.
    expect(formatMoneyMicros(9149999999999999999n, 'EUR', { locale: 'en-US' })).toBe('€9.1T');
    const rounded = Number('9149999999999999999');
    expect(rounded).toBe(9150000000000000000);
    expect(formatMoneyMicros(rounded, 'EUR', { locale: 'en-US' })).toBe('—');
    expect(formatMoneyMicros(rounded, 'EUR', { compact: true, locale: 'en-US' })).toBe('—');
    expect(formatMoneyMicros(-9223372036854775000, 'EUR', { locale: 'en-US' })).toBe('—');
    expect(formatMoneyMicros(9007199254740992, 'EUR', { compact: true, locale: 'en-US' })).toBe('—');
  });

  it('keeps compact figures for safe Numbers', () => {
    expect(formatMoneyMicros(9007199254740991, 'EUR', { locale: 'en-US' })).toBe('€9B');
    expect(formatMoneyMicros(-9007199254740991, 'EUR', { locale: 'en-US' })).toBe('-€9B');
    expect(formatMoneyMicros(1_234_000_000, 'USD', { locale: 'en-US' })).toBe('$1.2K');
  });
});

describe('formatMoneyMicros capability probe', () => {
  const RealNumberFormat = Intl.NumberFormat;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function withNumberFormat(NumberFormat: unknown) {
    vi.resetModules();
    vi.stubGlobal('Intl', Object.create(Intl, { NumberFormat: { value: NumberFormat } }));
    return import('./format.js');
  }

  it('falls back when only fractional strings are coerced (second probe case)', async () => {
    class FractionCoercing {
      private readonly inner: Intl.NumberFormat;
      constructor(locale?: string | string[], options?: Intl.NumberFormatOptions) {
        this.inner = new RealNumberFormat(locale, options);
      }
      format(value: number | bigint | string): string {
        const coerced = typeof value === 'string' && value.includes('.') ? Number(value) : value;
        return this.inner.format(coerced as number);
      }
      resolvedOptions() {
        return this.inner.resolvedOptions();
      }
    }
    const partial = await withNumberFormat(FractionCoercing);
    expect(new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format('9223372036854.774999')).toBe(
      '9,223,372,036,854.78',
    );
    expect(
      partial.formatMoneyMicros(9223372036854774999n, 'EUR', { compact: false, locale: 'en-US' }),
    ).toBe('€9,223,372,036,854.77');
  });

  it('probes once per module load', async () => {
    let probes = 0;
    class Counting extends RealNumberFormat {
      constructor(locale?: string | string[], options?: Intl.NumberFormatOptions) {
        super(locale, options);
        if (options?.useGrouping === false) probes += 1;
      }
    }
    const counted = await withNumberFormat(Counting);
    counted.formatMoneyMicros(1n, 'EUR', { locale: 'en-US' });
    counted.formatMoneyMicros(2n, 'EUR', { locale: 'en-US' });
    counted.formatMoneyMicros(3n, 'EUR', { compact: true, locale: 'en-US' });
    expect(probes).toBe(1);
  });

  it('without Intl: the probe does not throw, the direct formatter does, the hook shows an em dash', async () => {
    vi.resetModules();
    vi.stubGlobal('Intl', undefined);
    const bare = await import('./format.js');
    const hook = await import('@/hooks/useFormatMoney');
    expect(() => bare.formatMoneyMicros(1n, 'EUR', { locale: 'en-US' })).toThrow(TypeError);
    expect(hook.formatConvertedMicros(1n, 'EUR', 'EUR', null)).toBe('—');
  });
});

// Engines before Intl.NumberFormat v3 coerce a string to Number without
// throwing. This simulates that coercion in Node; it is not an old browser.
describe('formatMoneyMicros on an Intl that coerces decimal strings', () => {
  const RealNumberFormat = Intl.NumberFormat;
  class CoercingNumberFormat {
    private readonly inner: Intl.NumberFormat;
    constructor(locale?: string | string[], options?: Intl.NumberFormatOptions) {
      this.inner = new RealNumberFormat(locale, options);
    }
    format(value: number | bigint | string): string {
      return this.inner.format(typeof value === 'string' ? Number(value) : value);
    }
    resolvedOptions() {
      return this.inner.resolvedOptions();
    }
  }

  async function legacyFormat() {
    vi.resetModules();
    vi.stubGlobal('Intl', Object.create(Intl, { NumberFormat: { value: CoercingNumberFormat } }));
    return import('./format.js');
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is a lossy simulation (negative control for the capability check)', async () => {
    await legacyFormat();
    const nf = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 2,
    });
    expect(nf.format('9007199254740993.000000')).toBe('€9,007,199,254,740,992.00');
    expect(nf.format('9223372036854.774999')).toBe('€9,223,372,036,854.78');
  });

  it('keeps exact cents inside the int8 range', async () => {
    const legacy = await legacyFormat();
    const full = (m: bigint | string) =>
      legacy.formatMoneyMicros(m, 'EUR', { compact: false, locale: 'en-US' });
    expect(full(9223372036854774999n)).toBe('€9,223,372,036,854.77');
    expect(full(-9223372036854774999n)).toBe('-€9,223,372,036,854.77');
    expect(full(-9223372036854775808n)).toBe('-€9,223,372,036,854.78');
    expect(full(1099511627776005000n)).toBe('€1,099,511,627,776.01');
    expect(full('1005000')).toBe('€1.01');
    expect(full(0n)).toBe('€0.00');
    expect(full(9223372036854775807n)).toBe('€9,223,372,036,854.78');
    expect(full(-1n)).toBe('-€0.00');
    expect(full(-4999n)).toBe('-€0.00');
    expect(full(-5000n)).toBe('-€0.01');
  });

  it('needs at most 15 digits in the rounded cents integer, trailing zeros included', async () => {
    const legacy = await legacyFormat();
    const full = (m: bigint) =>
      legacy.formatMoneyMicros(m, 'EUR', { compact: false, locale: 'en-US' });
    expect(full(9999999999999994999n)).toBe('€9,999,999,999,999.99');
    expect(full(9999999999999995000n)).toBe('—');
    expect(full(10000000000000000000n)).toBe('—');
  });

  it('refuses unsafe Numbers and keeps safe ones', async () => {
    const legacy = await legacyFormat();
    expect(legacy.formatMoneyMicros(Number('9149999999999999999'), 'EUR', { locale: 'en-US' })).toBe(
      '—',
    );
    expect(
      legacy.formatMoneyMicros(9007199254740991, 'EUR', { compact: false, locale: 'en-US' }),
    ).toBe('€9,007,199,254.74');
  });

  it('shows an em dash rather than digits it cannot render exactly', async () => {
    const legacy = await legacyFormat();
    expect(
      legacy.formatMoneyMicros(9007199254740993000000n, 'EUR', { compact: false, locale: 'en-US' }),
    ).toBe('—');
    expect(legacy.formatMoneyMicros(9007199254740993000000n, 'EUR', { locale: 'en-US' })).toBe('—');
    expect(legacy.formatMoneyMicros(-9223372036854775000, 'EUR', { locale: 'en-US' })).toBe('—');
  });

  it('renders compact amounts as exact full amounts instead of rounding a Number', async () => {
    const legacy = await legacyFormat();
    expect(legacy.formatMoneyMicros(1_234_000_000n, 'USD', { locale: 'en-US' })).toBe('$1,234.00');
    expect(legacy.formatMoneyMicros(999_990_000n, 'USD', { locale: 'en-US' })).toBe('$999.99');
  });
});

describe('daysUntil', () => {
  it('returns null for missing input (so callers can omit "due in" labels)', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
  });

  it('returns negative integer for past dates (overdue UX)', () => {
    const past = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    expect(daysUntil(past)).toBeLessThan(0);
  });
});
