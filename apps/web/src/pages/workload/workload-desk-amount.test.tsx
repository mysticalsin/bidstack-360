import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFormatMoney } from '@/hooks/useFormatMoney';
import type { WorkloadOwner } from '@/hooks/useWorkload';
import { WorkloadTable } from '@/pages/workload/WorkloadTable';
import { useCurrencyStore } from '@/stores/currency';

import { workloadDeskAmount } from './workload-desk-amount';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const UNITS_61520_MICROS = '61520000000';

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function owner(): WorkloadOwner {
  return {
    ownerId: OWNER_ID,
    name: 'Ada Owner',
    email: 'ada@example.com',
    openBids: 1,
    openValueMicros: UNITS_61520_MICROS,
    weightedValueMicros: UNITS_61520_MICROS,
    openTasks: 0,
    overdueTasks: 0,
    closingWithin7Days: 0,
  };
}

function DeskHarness() {
  const { formatMoneyMicros } = useFormatMoney();
  return <WorkloadTable owners={[owner()]} formatMoneyMicros={formatMoneyMicros} />;
}

describe('workload desk weighted amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a desk weighted pipeline of 61520 as euros', () => {
    // WHY: a desk row prints opportunity valueMicros. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so a weighted desk of 61520 units looked like a euro forecast.
    // The figure stays 61520 and does not name EUR. The team total is separate.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });
    render(<DeskHarness />);

    const row = screen.getByTestId(`workload-row-${OWNER_ID}`);
    const weighted = within(row).getAllByRole('cell')[4];
    const text = weighted?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a desk figure that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero. The team total is separate.
    expect(workloadDeskAmount(Number.NaN)).toBe('Not a number');
    expect(workloadDeskAmount(1.5)).toBe('Not a number');
    expect(workloadDeskAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
