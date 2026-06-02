import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrencySelector } from './CurrencySelector';
import { SUPPORTED_CURRENCIES, useCurrencyStore } from '@/stores/currency';

describe('CurrencySelector', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          base: 'EUR',
          date: '2026-05-31',
          rates: Object.fromEntries(SUPPORTED_CURRENCIES.map((c) => [c.code, 1])),
        }),
      })),
    );
    useCurrencyStore.setState({
      currency: 'USD',
      autoDetect: false,
      rates: null,
      ratesLoading: false,
      ratesError: null,
    });
  });

  afterEach(() => {
    cleanup();
    try {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    } catch {
      // ignore: jsdom may lock navigator in some runners
    }
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows every supported currency in one non-scrolling chooser', async () => {
    render(<CurrencySelector />);

    fireEvent.click(screen.getByRole('button', { name: /select currency/i }));

    const listbox = await screen.findByRole('listbox', { name: 'Select currency' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(SUPPORTED_CURRENCIES.length);
    expect(listbox.className).not.toContain('overflow-y-auto');
    expect(within(listbox).getByText('Rates updated May 31')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Auto' })).toBeDefined();
  });

  it('updates the compact top-bar trigger after choosing a currency', async () => {
    render(<CurrencySelector />);

    fireEvent.click(screen.getByRole('button', { name: /select currency/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Canadian Dollar/i }));

    expect(screen.getByRole('button', { name: /current: CAD/i })).toBeDefined();
  });

  it('uses browser geolocation when Auto is selected from the top bar', async () => {
    vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/New_York',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          success({
            coords: {
              latitude: 45.5019,
              longitude: -73.5674,
              accuracy: 100,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          });
        }),
      },
    });
    render(<CurrencySelector />);

    fireEvent.click(screen.getByRole('button', { name: /select currency/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Auto' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /current: CAD/i })).toBeDefined();
    });
  });
});
