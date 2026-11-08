import { describe, expect, it, vi } from 'vitest';

import * as money from '@bidstack/shared';
import { formatMicrosAmount } from '@bidstack/shared';

import { fmtMoney } from '@/components/financials/financials-format';

import * as format from '@/lib/format';
import { formatConvertedMicros, formatMoney, formatMoneyMicros } from '@/lib/format';

import { formatPlainMoney, formatStoredMicros } from './useFormatMoney';

describe('failed conversion keeps the source currency', () => {
  it('does not label a non-finite conversion with the display currency', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', () => Number.NaN, 'USD');
    expect(text).toContain('€');
    expect(text).not.toContain('$');
    expect(text).toContain('2.50');
  });

  it('keeps a parity conversion in the display currency', () => {
    const text = formatStoredMicros(
      2_500_000n,
      'EUR',
      (amount) => ({ ok: true, amount }),
      'USD',
    );
    expect(text).toContain('$');
    expect(text).toContain('2.50');
    expect(text).not.toContain('€');
  });

  it('keeps integer parity in the display currency', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', (amount) => amount, 'USD', undefined, () => 2_500_000n);
    expect(text).toContain('$');
    expect(text).toContain('2.50');
    expect(text).not.toContain('€');
  });

  it('keeps the source label when conversion reports failure', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', () => ({ ok: false }), 'USD');
    expect(text).toContain('€');
    expect(text).toContain('2.50');
    expect(text).not.toContain('$');
  });

  it('keeps the source label when a numeric converter echoes the amount', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', (amount) => amount, 'USD');
    expect(text).toContain('€');
    expect(text).toContain('2.50');
    expect(text).not.toContain('$');
  });

  it('does not treat a changed bare number as a successful conversion', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', (amount) => amount * 2, 'USD');
    expect(text).toContain('€');
    expect(text).toContain('2.50');
    expect(text).not.toContain('$');
  });

  it('keeps the source label when integer conversion is unavailable', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', (amount) => amount, 'USD', undefined, () => null);
    expect(text).toContain('€');
    expect(text).toContain('2.50');
    expect(text).not.toContain('$');
  });

  it('does not throw when the display currency is not a code', () => {
    const shown = formatStoredMicros(2_500_000n, 'EUR', (amount) => ({ ok: true, amount: amount * 2 }), 'NOTREAL');
    expect(shown).toContain('5');
    expect(shown).toContain('NOTREAL');
    expect(shown).not.toContain('€');
    expect(formatMoneyMicros(2_500_000n, 'NOTREAL', { compact: false })).toBe('2.50 NOTREAL');
    expect(formatMoney(2.5, 'NOTREAL')).toContain('2.5');
    expect(formatMoney(2.5, 'NOTREAL')).toContain('NOTREAL');
    expect(formatConvertedMicros(2_500_000n, 'NOTREAL')).toContain('2.50');
    expect(formatConvertedMicros(2_500_000n, 'NOTREAL')).toContain('NOTREAL');
  });

  it('renders an invalid source currency as plain text', () => {
    const text = formatStoredMicros(2_500_000n, 'NOTREAL', () => Number.NaN, 'USD');
    expect(text).toContain('2.50');
    expect(text).toContain('NOTREAL');
    expect(text).not.toContain('$');
  });

  it('uses the display currency when conversion explicitly changes the amount', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', (amount) => ({ ok: true, amount: amount * 2 }), 'USD');
    expect(text).toContain('$');
    expect(text).not.toContain('€');
  });

  it('labels a blank financial currency as unspecified', () => {
    expect(fmtMoney(1200, ' ')).toContain('unspecified');
    expect(fmtMoney(1200, ' ')).not.toMatch(/^\s/);
  });

  it('scales the stored micros before labelling them', () => {
    expect(formatMicrosAmount(100_000_000_000n)).toBe('100,000');
  });

  it('contains a throwing unit or formatter and still names the source', () => {
    const units = vi.spyOn(money, 'unitsToMicros').mockImplementation(() => {
      throw new Error('units');
    });
    expect(formatPlainMoney(2.5, 'EUR')).toContain('2.5');
    expect(formatPlainMoney(2.5, 'EUR')).toContain('EUR');
    expect(formatPlainMoney(-2.5, 'EUR')).toContain('EUR');
    units.mockRestore();
    const rendered = vi.spyOn(format, 'formatMoneyMicros').mockImplementation(() => {
      throw new Error('format');
    });
    expect(formatPlainMoney(2.5, 'EUR')).toBe('2.5 EUR');
    expect(formatPlainMoney(0, 'EUR')).toBe('0 EUR');
    expect(formatPlainMoney(Number.NaN, 'EUR')).toContain('EUR');
    rendered.mockRestore();
    expect(formatPlainMoney(2.5, 'EUR')).toContain('2.50');
    expect(formatPlainMoney(-2.5, 'EUR')).toContain('2.50');
  });
});
