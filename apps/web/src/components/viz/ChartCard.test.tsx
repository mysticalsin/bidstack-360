import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ChartCard } from './ChartCard';

afterEach(() => cleanup());

describe('ChartCard', () => {
  it('exposes a text alternative and toggles to a data table', () => {
    render(
      <ChartCard title="Bids by status" summary="Open 2, won 1" sample table={{ columns: ['Status', 'Bids'], rows: [['Open', 2], ['Won', 1]] }}>
        <svg />
      </ChartCard>,
    );
    expect(screen.getByRole('img', { name: 'Open 2, won 1' })).toBeDefined();
    // Fixture charts stay marked with the viz-sample flag, but sellers read Reference.
    const badge = screen.getByText('Reference');
    expect(badge.classList.contains('viz-sample')).toBe(true);
    expect(badge.getAttribute('title')).toBe('Reference record');
    expect(screen.queryByText('Sample')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByRole('rowheader', { name: 'Open' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Chart' }).getAttribute('aria-pressed')).toBe('true');
  });
});
