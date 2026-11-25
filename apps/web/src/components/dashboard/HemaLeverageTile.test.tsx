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

  it('says the leverage read failed and retries instead of leaving the dashboard slot blank', () => {
    // A failed summary is not "no under-leveraged MSAs". Blanking the tile
    // hides the miss and leaves no way to ask again.
    const refetch = vi.fn();
    vi.mocked(useMsaLeverageSummary).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error('leverage summary unavailable'),
      refetch,
    } as never);
    render(
      <MemoryRouter>
        <HemaLeverageTile />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('hema-leverage-tile')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/Could not load under-leveraged MSAs/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('stays quiet while the leverage summary is still loading', () => {
    vi.mocked(useMsaLeverageSummary).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    } as never);
    const { container } = render(
      <MemoryRouter>
        <HemaLeverageTile />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
