import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { intelSummary } from '../companiesPage/__fixtures__/intel-summary';
import { IntelStrip } from './IntelStrip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

afterEach(cleanup);

describe('company header intel strip', () => {
  it('shows revenue with year, headcount with growth, open roles with 30d delta, funding and direction', () => {
    render(<IntelStrip summary={intelSummary()} onOpen={vi.fn()} />);
    expect(screen.getByText('2.4bn EUR')).toBeTruthy();
    expect(screen.getByText('FY2025')).toBeTruthy();
    expect(screen.getByText('12k')).toBeTruthy();
    expect(screen.getByText('+6% 6m')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('+4 30d')).toBeTruthy();
    expect(screen.getByText('250m USD')).toBeTruthy();
    expect(screen.getByText('Growing')).toBeTruthy();
  });

  it('links each item to the matching intel tab', () => {
    const onOpen = vi.fn();
    render(<IntelStrip summary={intelSummary()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /^Revenue/ }));
    expect(onOpen).toHaveBeenLastCalledWith('financials');
    fireEvent.click(screen.getByRole('button', { name: /^Open roles/ }));
    expect(onOpen).toHaveBeenLastCalledWith('hiring');
    fireEvent.click(screen.getByRole('button', { name: /^Direction/ }));
    expect(onOpen).toHaveBeenLastCalledWith('direction');
  });

  it('shows dashes with reasons when there is no summary', () => {
    render(<IntelStrip summary={null} onOpen={vi.fn()} />);
    const dashes = screen.getAllByText('\u2013');
    expect(dashes).toHaveLength(5);
  });

  it('does not call a missing summary "not refreshed" while the read is still loading', () => {
    render(<IntelStrip summary={null} read="loading" onOpen={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toMatch(/Loading company intel/);
    expect(screen.queryByText('\u2013')).toBeNull();
    expect(screen.queryByText(/Not refreshed yet/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Revenue/ })).toBeNull();
  });

  it('says the intel read failed and retries, instead of claiming the account was never refreshed', () => {
    const onRetry = vi.fn();
    render(<IntelStrip summary={null} read="error" onOpen={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't load company intel/);
    expect(screen.getByRole('alert').textContent).toMatch(/Please try again/);
    expect(screen.queryByText('\u2013')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toMatch(/min-h-11|h-11/);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
