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

  it('names a fixture figure reference records and keeps source, method, date and inferred', () => {
    const base = intelSummary();
    render(
      <IntelCellFor
        column="revenueGrowth"
        summary={intelSummary({
          revenueGrowth: { ...base.revenueGrowth!, sample: true },
        })}
      />,
    );
    const label =
      screen.getByText('+14%').closest('[aria-label]')?.getAttribute('aria-label') ?? '';
    // sample:true still marks the fixture. The words are production copy.
    expect(label).toMatch(/ESEF/);
    expect(label).toMatch(/Derived from FY2024 and FY2025 revenue/);
    expect(label).toMatch(/as of 2026-11-06/);
    expect(label).toMatch(/inferred/i);
    expect(label).toMatch(/reference records/);
    expect(label).not.toMatch(/sample data/i);
    expect(screen.getByText('+14%').textContent).toBe('+14%');
  });

  it('does not call a live figure a reference record', () => {
    render(<IntelCellFor column="openRoles" summary={intelSummary()} />);
    const label = screen.getByText('42').closest('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/Greenhouse/);
    expect(label).toMatch(/Open postings on public job boards/);
    expect(label).not.toMatch(/reference records/i);
    expect(label).not.toMatch(/sample data/i);
  });

  it('names a fixture hiring sparkline reference records and keeps the monthly counts', () => {
    const base = intelSummary();
    render(
      <IntelCellFor
        column="hiringTrend"
        summary={intelSummary({
          hiringTrend: { ...base.hiringTrend!, sample: true },
        })}
      />,
    );
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/3, 4, 6, 5, 8, 12/);
    expect(label).toMatch(/Greenhouse/);
    expect(label).toMatch(/reference records/);
    expect(label).not.toMatch(/sample data/i);
  });

  it('does not call a live hiring sparkline a reference record', () => {
    render(<IntelCellFor column="hiringTrend" summary={intelSummary()} />);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/Greenhouse/);
    expect(label).not.toMatch(/reference records/i);
    expect(label).not.toMatch(/sample data/i);
  });

  it('names a fixture signal reference records on the pill label and title', () => {
    const base = intelSummary();
    render(
      <IntelCellFor
        column="signal"
        summary={intelSummary({
          signal: { ...base.signal!, sample: true },
        })}
      />,
    );
    const host = screen.getByText('Acquisition').closest('[aria-label]');
    const label = host?.getAttribute('aria-label') ?? '';
    const title = host?.getAttribute('title') ?? '';
    expect(label).toBe(title);
    expect(label).toMatch(/Acme buys Nordic payments firm/);
    expect(label).toMatch(/Company newsroom/);
    expect(label).toMatch(/2026-10-20/);
    expect(label).toMatch(/reference records/);
    expect(label).not.toMatch(/sample data/i);
    expect(screen.getByText('Acquisition').textContent).toBe('Acquisition');
  });

  it('does not call a live signal a reference record', () => {
    render(<IntelCellFor column="signal" summary={intelSummary()} />);
    const host = screen.getByText('Acquisition').closest('[aria-label]');
    const label = host?.getAttribute('aria-label') ?? '';
    expect(label).toBe(host?.getAttribute('title'));
    expect(label).toMatch(/Company newsroom/);
    expect(label).not.toMatch(/reference records/i);
    expect(label).not.toMatch(/sample data/i);
  });
});
