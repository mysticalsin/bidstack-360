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
});
