import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state: {
  current: { data: unknown; isLoading: boolean; isError: boolean };
} = { current: { data: undefined, isLoading: false, isError: false } };

vi.mock('@/hooks/useAccountPositioning', () => ({
  useAccountKeyNumbers: () => ({ ...state.current, refetch: vi.fn() }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoneyMicros: (v: number) => String(v),
  }),
}));

import { KeyNumbersStrip } from './KeyNumbersStrip';

afterEach(cleanup);

describe('key numbers wait for the read', () => {
  it('does not call an unread strip a failed load', () => {
    // WHY: a paused key-numbers read has isLoading false and no payload.
    // "Couldn't load" is a failure. The company figures have not arrived.
    state.current = { data: undefined, isLoading: false, isError: false };
    render(<KeyNumbersStrip companyId="c1" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Checking key numbers')).toBeTruthy();
  });

  it('says the load failed only after the read errors', () => {
    state.current = { data: undefined, isLoading: false, isError: true };
    render(<KeyNumbersStrip companyId="c1" />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load the key numbers");
    expect(screen.queryByRole('status')).toBeNull();
  });
});
