import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectionBadge, EmptyIntel, IntelCellFor } from './IntelCells';
import { intelSummary } from './__fixtures__/intel-summary';

afterEach(cleanup);

describe('intel cells', () => {
  it('shows revenue with currency and puts year, source and method in the label', () => {
    render(<IntelCellFor column="revenue" summary={intelSummary()} />);
    const cell = screen.getByText('2.4bn EUR');
    const label = cell.closest('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/FY2025/);
    expect(label).toMatch(/ESEF/);
    expect(label).toMatch(/Filed annual accounts/);
  });

  it('marks derived numbers as inferred', () => {
    render(<IntelCellFor column="revenueGrowth" summary={intelSummary()} />);
    const label =
      screen.getByText('+14%').closest('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/inferred/i);
  });

  it('shows a dash with the reason when a value is empty', () => {
    render(
      <IntelCellFor
        column="revenue"
        summary={intelSummary({
          revenue: null,
          gaps: { revenue: { reason: 'private_company', detail: 'No published accounts found' } },
        })}
      />,
    );
    const dash = screen.getByText('\u2013');
    expect(dash.getAttribute('aria-label')).toMatch(/Private company/);
    expect(dash.getAttribute('aria-label')).toMatch(/No published accounts/);
  });

  it('shows a dash with a reason when the company has no summary yet', () => {
    render(<IntelCellFor column="openRoles" summary={null} />);
    expect(screen.getByText('\u2013').getAttribute('aria-label')).toMatch(/No public data/);
  });

  it('never renders an em dash', () => {
    const { container } = render(
      <EmptyIntel gap={{ reason: 'not_connected', detail: 'Apollo not connected' }} />,
    );
    expect(container.textContent).not.toContain('\u2014');
  });

  it('shows new roles with the 30 day delta and the hiring proxy method', () => {
    render(<IntelCellFor column="newRoles30d" summary={intelSummary()} />);
    const label = screen.getByText('12').closest('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/hiring proxy/i);
    expect(screen.getByText('+4')).toBeTruthy();
  });

  it('direction badge names the direction and carries the reasons', () => {
    render(<DirectionBadge summary={intelSummary()} />);
    const badge = screen.getByText('Growing');
    const label = badge.closest('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/Headcount up 6%/);
    expect(label).toMatch(/inferred/i);
  });

  it('direction badge for contracting', () => {
    render(
      <DirectionBadge
        summary={intelSummary({
          direction: {
            value: 'contracting',
            reasons: ['Layoffs post: Acme to cut 800 roles'],
            inferred: true,
          },
        })}
      />,
    );
    expect(screen.getByText('Contracting')).toBeTruthy();
  });

  it('names a demo sample headline as sample when the summary still calls it live', () => {
    // WHY: CI Financial's demo story is titled "Sample:" and the list summary
    // can still store sample:false with the source label "sample". The Signal
    // cell then shows only "Results", which reads as a live filing.
    const { unmount } = render(
      <IntelCellFor
        column="signal"
        summary={intelSummary({
          signal: {
            kind: 'results',
            label: 'Results',
            title: 'Sample: CI Financial third-quarter profit rose 12% on record assets',
            url: null,
            publishedAt: '2026-11-19T00:00:00.000Z',
            sourceLabel: 'sample',
            sample: false,
          },
        })}
      />,
    );
    expect(screen.getByText('Results')).toBeTruthy();
    expect(screen.getByText('Sample')).toBeTruthy();
    const stale =
      screen.getByText('Results').closest('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(stale).toMatch(/sample data/i);
    unmount();

    render(
      <IntelCellFor
        column="signal"
        summary={intelSummary({
          signal: {
            kind: 'results',
            label: 'Results',
            title: 'CI Financial third-quarter profit rose 12% on record assets',
            url: null,
            publishedAt: '2026-11-19T00:00:00.000Z',
            sourceLabel: 'Sample data',
            sample: true,
          },
        })}
      />,
    );
    expect(screen.getByText('Sample')).toBeTruthy();
  });

  it('leaves a live news signal unmarked', () => {
    render(<IntelCellFor column="signal" summary={intelSummary()} />);
    expect(screen.getByText('Acquisition')).toBeTruthy();
    expect(screen.queryByText('Sample')).toBeNull();
  });
});
