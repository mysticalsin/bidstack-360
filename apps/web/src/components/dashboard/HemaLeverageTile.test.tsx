import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverageSummary: vi.fn(),
}));

import { useMsaLeverageSummary } from '@/hooks/useMsaLeverage';

import { HemaLeverageTile } from './HemaLeverageTile';

afterEach(cleanup);

describe('HemaLeverageTile', () => {
  it('counts under-leveraged HEMA or pharma MSAs and links to the accounts filter', () => {
    vi.mocked(useMsaLeverageSummary).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { underLeveragedAccounts: 3, hemaPharmaAccounts: 2 },
    } as never);
    render(
      <MemoryRouter>
        <HemaLeverageTile />
      </MemoryRouter>,
    );
    const tile = screen.getByTestId('hema-leverage-tile');
    expect(tile.textContent).toContain('2');
    expect(tile.getAttribute('href')).toBe('/accounts?leverage=hema');
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('keeps the last HEMA count when a refresh fails instead of clearing the slot', () => {
    // A failed refresh is not an empty book. Demo synthetic data has one
    // under-leveraged HEMA MSA (Northwind Pharma). Blanking the tile after
    // that count loaded reads as if the book had none, and leaves no Retry.
    const refetch = vi.fn();
    vi.mocked(useMsaLeverageSummary).mockReturnValue({
      isLoading: false,
      isError: true,
      isRefetchError: true,
      data: { underLeveragedAccounts: 1, hemaPharmaAccounts: 1 },
      error: new Error('leverage summary unavailable'),
      refetch,
    } as never);
    render(
      <MemoryRouter>
        <HemaLeverageTile />
      </MemoryRouter>,
    );
    const tile = screen.getByTestId('hema-leverage-tile');
    expect(tile.textContent).toContain('1');
    expect(tile.textContent).toMatch(/Could not refresh this count/);
    expect(tile.querySelector('a')?.getAttribute('href')).toBe('/accounts?leverage=hema');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('does not offer Retry when a zero count loaded', () => {
    // A finished read of zero is an empty book, not a failed refresh.
    vi.mocked(useMsaLeverageSummary).mockReturnValue({
      isLoading: false,
      isError: false,
      isRefetchError: false,
      data: { underLeveragedAccounts: 0, hemaPharmaAccounts: 0 },
      refetch: vi.fn(),
    } as never);
    render(
      <MemoryRouter>
        <HemaLeverageTile />
      </MemoryRouter>,
    );
    const tile = screen.getByTestId('hema-leverage-tile');
    expect(tile.textContent).toContain('0');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });
});
