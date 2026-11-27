// Below the md breakpoint the currency menu is a fixed phone panel. The rate
// sheet starts empty. A missing payload and a failed read both wore a settled
// sentence: "Live rates" or "Using cached rates". A bid lead on a phone then
// treats a sheet that has not arrived as a rate sheet that has.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import { CurrencySelector } from './CurrencySelector';
import { useCurrencyStore } from '@/stores/currency';

const UNREAD = 'The rates have not arrived.';
const FAILED = 'Rates did not load.';
const EMPTY = 'No rates are listed.';
const UPDATED = 'Rates updated May 31';
const CACHED = 'Using cached rates';
const LIVE = 'Live rates';
const UPDATING = 'Updating live rates';

function holdRates(state: {
  rates: { base: string; rates: Record<string, number>; date: string } | null;
  ratesLoading: boolean;
  ratesError: string | null;
}) {
  useCurrencyStore.setState({
    currency: 'USD',
    autoDetect: false,
    followOrg: false,
    ...state,
    fetchRates: async () => {},
  });
}

function openPanel() {
  render(<CurrencySelector />);
  fireEvent.click(screen.getByRole('button', { name: /select currency/i }));
  return screen.getByRole('listbox', { name: 'Select currency' });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('phone currency panel rates that have not arrived', () => {
  it('does not call a paused rate read live', () => {
    // A paused first read has no payload and is not loading. "Live rates" is
    // the settled sentence. This sheet has not arrived.
    holdRates({ rates: null, ratesLoading: false, ratesError: null });
    const panel = openPanel();

    expect(panel.textContent).toContain(UNREAD);
    expect(panel.textContent).not.toContain(LIVE);
    expect(panel.textContent).not.toContain(UPDATING);
    expect(panel.textContent).not.toContain(CACHED);
    expect(panel.textContent).not.toContain(FAILED);
    expect(panel.textContent).not.toContain(EMPTY);
  });

  it('does not call an in-flight rate read live', () => {
    // A slow read also has no payload. "Updating live rates" names a sheet
    // that is not here yet.
    holdRates({ rates: null, ratesLoading: true, ratesError: null });
    const panel = openPanel();

    expect(panel.textContent).toContain(UNREAD);
    expect(panel.textContent).not.toContain(UPDATING);
    expect(panel.textContent).not.toContain(LIVE);
    expect(panel.textContent).not.toContain(FAILED);
  });

  it('does not call a failed rate read cached', () => {
    // A failed read with no payload has no cached sheet. "Using cached rates"
    // is the sentence for a payload we still hold.
    holdRates({ rates: null, ratesLoading: false, ratesError: 'HTTP 503' });
    const panel = openPanel();

    expect(panel.textContent).toContain(FAILED);
    expect(panel.textContent).not.toContain(CACHED);
    expect(panel.textContent).not.toContain(LIVE);
    expect(panel.textContent).not.toContain(UNREAD);
    expect(panel.textContent).not.toContain(EMPTY);
  });

  it('says a settled sheet with no date is empty', () => {
    // A payload arrived and its date is blank. That is an empty rate sheet,
    // not a live one, and not a read that is still out.
    holdRates({
      rates: { base: 'EUR', date: '', rates: {} },
      ratesLoading: false,
      ratesError: null,
    });
    const panel = openPanel();

    expect(panel.textContent).toContain(EMPTY);
    expect(panel.textContent).not.toContain(LIVE);
    expect(panel.textContent).not.toContain(UNREAD);
    expect(panel.textContent).not.toContain(FAILED);
    expect(panel.textContent).toContain('US Dollar');
  });

  it('keeps a settled dated rate sheet', () => {
    // A payload with a date stays on that date. The currency catalog stays.
    holdRates({
      rates: { base: 'EUR', date: '2026-05-31', rates: { USD: 1.08 } },
      ratesLoading: false,
      ratesError: null,
    });
    const panel = openPanel();

    expect(panel.textContent).toContain(UPDATED);
    expect(panel.textContent).not.toContain(UNREAD);
    expect(panel.textContent).not.toContain(FAILED);
    expect(panel.textContent).not.toContain(EMPTY);
    expect(panel.textContent).toContain('US Dollar');
  });

  it('keeps the last rates when a later read fails with a payload', () => {
    // A failure that still has a sheet keeps the cached sentence. It does
    // not switch to the no-payload failure.
    holdRates({
      rates: { base: 'EUR', date: '2026-05-31', rates: { USD: 1.08 } },
      ratesLoading: false,
      ratesError: 'HTTP 503',
    });
    const panel = openPanel();

    expect(panel.textContent).toContain(CACHED);
    expect(panel.textContent).not.toContain(FAILED);
    expect(panel.textContent).not.toContain(UNREAD);
    expect(panel.textContent).not.toContain(EMPTY);
  });
});
