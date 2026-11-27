import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatUnspecifiedAmount, UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';

import { ForecastProjection } from './ForecastProjection';

const projection = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => projection.result }));
vi.mock('@/hooks/useFormatMoney', () => ({
  // The euro converter. A bid-derived figure that still reaches this hook
  // comes back with a currency the opportunity row never stored.
  useFormatMoney: () => ({ formatMoneyMicros: (m: number) => `R$${m / 1e6}` }),
}));

afterEach(cleanup);

const BASIS_ID = 'forecast-projection-currency-basis';

function amountCard(label: string): HTMLElement {
  const card = screen
    .getAllByText(label)
    .map((node) => node.closest('.rounded-lg'))
    .find((node): node is HTMLElement => node instanceof HTMLElement);
  if (!card) throw new Error(`no amount card for ${label}`);
  return card;
}

describe('ForecastProjection recorded amounts', () => {
  it('prints bid-derived figures as the recorded amount, not a euro conversion', () => {
    // Demo OP-2041 is 1,240,000. The opportunity stores no currency, and the
    // opportunities list already says so. The projection payload still names
    // EUR. Sending the sum through the euro converter invents a forecast and
    // a display currency would change the number. A manual commit is a stored
    // forecast row with a currency, so that badge stays on the converter.
    projection.result = {
      data: {
        currency: 'EUR',
        periods: [
          {
            period: '2026-Q4',
            label: 'Q4 2026',
            openMicros: 1_240_000 * 1e6,
            weightedMicros: 744_000 * 1e6,
            wonMicros: 0,
            manualCommitMicros: 2_000_000 * 1e6,
            byOwner: [
              {
                ownerId: '11111111-1111-4111-8111-111111111111',
                ownerName: 'Alex Example',
                openMicros: 1_240_000 * 1e6,
                weightedMicros: 744_000 * 1e6,
                wonMicros: 0,
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
    };

    render(<ForecastProjection />);

    const openCard = amountCard('Open pipeline');
    const openAmount = within(openCard).getByText(formatUnspecifiedAmount(1_240_000));
    expect(openAmount.getAttribute('aria-describedby')).toBe(BASIS_ID);
    expect(within(openCard).queryByText(/R\$/)).toBeNull();

    const weightedCard = amountCard('Weighted');
    expect(within(weightedCard).getByText(formatUnspecifiedAmount(744_000))).toBeTruthy();
    expect(within(weightedCard).getByText(/Manual commit: R\$2000000/)).toBeTruthy();

    const owners = screen.getByRole('table', { name: /weighted pipeline by owner/i });
    expect(owners.getAttribute('aria-describedby')).toBe(BASIS_ID);
    expect(within(owners).getByText(formatUnspecifiedAmount(1_240_000))).toBeTruthy();
    expect(within(owners).queryByText(/R\$/)).toBeNull();

    expect(screen.getByText(UNSPECIFIED_CURRENCY_BASIS).id).toBe(BASIS_ID);
  });
});
