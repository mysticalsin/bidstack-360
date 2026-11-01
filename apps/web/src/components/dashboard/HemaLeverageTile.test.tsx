import { cleanup, render, screen } from '@testing-library/react';
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
});
