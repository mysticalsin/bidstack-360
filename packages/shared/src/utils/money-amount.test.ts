import { describe, expect, it } from 'vitest';

/**
 * FX display contract. Amounts render in their own currency. The header
 * selector is not a rate. A mixed total is not one number.
 *
 * These tests load the module dynamically so a missing export fails the
 * named case instead of aborting the file before the titles run.
 */
async function loadMoneyAmount() {
  try {
    return await import('./money-amount.js');
  } catch {
    return null;
  }
}

const EUR_11_89M_MICROS = 11_890_000_000_000n;

describe('money amount currency', () => {
  it('shows an EUR amount as euros when the selector is CAD', async () => {
    // WHY: the command-center KPI read €11.89M while the header said CAD.
    // The euro symbol is the stored currency. It must stay, and the label
    // must say the CAD selector did not convert it.
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    const money = api!.moneyFromMicros(EUR_11_89M_MICROS, 'EUR');
    const shown = api!.presentMoney(money, 'CAD', { locale: 'en-GB', compact: true });
    expect(shown.currency).toBe('EUR');
    expect(shown.text).toContain('€');
    expect(shown.text).toContain('EUR');
    expect(shown.text).toMatch(/not converted to CAD/i);
    expect(shown.text).not.toContain('CA$');
  });

  it('refuses to silently sum a mixed EUR and CAD total', async () => {
    // WHY: adding 100 euro cents to 100 Canadian cents produces a number
    // that is neither currency. The rollup has to keep both subtotals.
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    const rollup = api!.aggregateMoney([
      api!.money(100n, 'EUR'),
      api!.money(100n, 'CAD'),
    ]);
    expect(rollup.kind).toBe('mixed');
    if (rollup.kind !== 'mixed') return;
    expect(rollup).not.toHaveProperty('total');
    expect(rollup.subtotals.map((row) => row.currency).sort()).toEqual(['CAD', 'EUR']);
    expect(rollup.subtotals.map((row) => row.amountMinor).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      100n,
      100n,
    ]);
  });

  it('formatter output currency always equals Money.currency', async () => {
    // WHY: a symbol from the header, the browser, or a failed rate fetch
    // must not replace the currency stored on the amount.
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    const currencies = ['EUR', 'CAD', 'USD', 'GBP', 'JPY', 'CLP', 'KRW', 'BHD'];
    const amounts = [0n, 1n, -1n, 100n, -250n, 10n ** 18n];
    const selectors = ['CAD', 'EUR', 'JPY', null];
    for (const currency of currencies) {
      for (const amountMinor of amounts) {
        const money = api!.money(amountMinor, currency);
        const formatted = api!.formatMoneyAmount(money, { locale: 'en-GB' });
        expect(formatted.currency).toBe(money.currency);
        expect(formatted.text).toContain(money.currency);
        for (const selector of selectors) {
          const presented = api!.presentMoney(money, selector, { locale: 'en-GB' });
          expect(presented.currency).toBe(money.currency);
          expect(presented.text).toContain(money.currency);
        }
      }
    }
  });

  it('formats zero minor units in the amount currency', async () => {
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    const shown = api!.formatMoneyAmount(api!.money(0n, 'EUR'), { locale: 'en-GB' });
    expect(shown.currency).toBe('EUR');
    expect(shown.text).toContain('EUR');
    expect(shown.text).toMatch(/0/);
    expect(shown.text).not.toContain('CAD');
  });

  it('formats a negative amount in the amount currency', async () => {
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    const shown = api!.formatMoneyAmount(api!.money(-150n, 'CAD'), { locale: 'en-GB' });
    expect(shown.currency).toBe('CAD');
    expect(shown.text).toContain('CAD');
    expect(shown.text).toContain('1.50');
    expect(shown.text).toMatch(/-|−/);
  });

  it('formats a very large minor-unit amount without losing digits', async () => {
    // WHY: Number() cannot hold 10^20 cents. The label has to keep every digit.
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    const amountMinor = 10n ** 20n;
    const shown = api!.formatMoneyAmount(api!.money(amountMinor, 'EUR'), { locale: 'en-GB', compact: false });
    expect(shown.currency).toBe('EUR');
    expect(shown.text.replace(/[^\d]/g, '')).toContain('100000000000000000000');
  });

  it('rounds JPY micros to a whole yen', async () => {
    // WHY: yen has no minor unit. 1.5 yen of micros must not render as ¥1.50.
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    expect(api!.moneyFromMicros(1_500_000n, 'JPY').amountMinor).toBe(2n);
    expect(api!.moneyFromMicros(1_499_999n, 'JPY').amountMinor).toBe(1n);
    expect(api!.moneyFromMicros(-1_500_000n, 'JPY').amountMinor).toBe(-2n);
    expect(api!.moneyFromMicros(0n, 'JPY').amountMinor).toBe(0n);
    const shown = api!.formatMoneyAmount(api!.moneyFromMicros(1_500_000n, 'JPY'), { locale: 'en-GB' });
    expect(shown.currency).toBe('JPY');
    expect(shown.text).toContain('JPY');
    expect(shown.text).not.toMatch(/\.50/);
  });

  it('rounds CLP and KRW micros to a whole unit', async () => {
    // WHY: peso and won are zero-decimal, same as yen. Half a unit rounds away from zero.
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    expect(api!.moneyFromMicros(1_500_000n, 'CLP').amountMinor).toBe(2n);
    expect(api!.moneyFromMicros(1_400_000n, 'KRW').amountMinor).toBe(1n);
    expect(api!.moneyFromMicros(-500_000n, 'CLP').amountMinor).toBe(-1n);
    const clp = api!.formatMoneyAmount(api!.moneyFromMicros(1_500_000n, 'CLP'), { locale: 'en-GB' });
    const krw = api!.formatMoneyAmount(api!.money(3n, 'KRW'), { locale: 'en-GB' });
    expect(clp.currency).toBe('CLP');
    expect(krw.currency).toBe('KRW');
    expect(clp.text).toContain('CLP');
    expect(krw.text).toContain('KRW');
    expect(clp.text).not.toMatch(/\.50/);
  });

  it('sums two amounts only when the currency code matches', async () => {
    const api = await loadMoneyAmount();
    expect(api, 'money-amount module').not.toBeNull();
    const same = api!.aggregateMoney([api!.money(100n, 'EUR'), api!.money(50n, 'eur')]);
    expect(same.kind).toBe('single');
    if (same.kind !== 'single') return;
    expect(same.total).toEqual({ amountMinor: 150n, currency: 'EUR' });
  });
});
