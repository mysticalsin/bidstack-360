// A tasks read that has not arrived is not a clean desk. The cockpit
// platform status used the same jade "0" for "still loading", "the read
// failed", and "the list settled with nothing overdue".
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import type { CrmDashboardSnapshot } from '@bidstack/shared';

import { KpiSidebar } from './KpiSidebar';

vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

function snapshot(): CrmDashboardSnapshot {
  return {
    releaseScore: { total: 90, passed: true },
    providerHealth: [{ status: 'healthy' }],
    queueHealth: [{ waiting: 0, active: 0 }],
  } as CrmDashboardSnapshot;
}

function overdueRow(): HTMLElement {
  const row = screen.getByText('Overdue tasks').closest('.pulse-row');
  if (!row) throw new Error('overdue tasks row missing');
  return row as HTMLElement;
}

describe('cockpit overdue tasks before the list arrives', () => {
  afterEach(cleanup);

  it('does not paint a tasks read that is still in flight as zero and all clear', () => {
    // WHY: the org cockpit shows this row before /api/tasks returns. A jade
    // zero is the settled empty list. An in-flight read is not that list.
    render(
      <KpiSidebar snapshot={snapshot()} overdueCount={0} tasksLoading tasksFailed={false} />,
    );
    const row = overdueRow();
    expect(row.textContent).not.toMatch(/\b0\b/);
    expect(row.className).not.toContain('pulse-row-jade');
    expect(row.textContent).toContain('...');
  });

  it('does not paint a failed tasks read as zero and all clear', () => {
    // WHY: a failed read has no count. Showing 0 in jade tells a bid lead
    // the desk is clear when the list never arrived.
    render(
      <KpiSidebar snapshot={snapshot()} overdueCount={0} tasksLoading={false} tasksFailed />,
    );
    const row = overdueRow();
    expect(row.textContent).toContain('Not loaded');
    expect(row.textContent).not.toMatch(/\b0\b/);
    expect(row.className).not.toContain('pulse-row-jade');
  });

  it('says zero overdue only after the tasks read settles empty', () => {
    render(<KpiSidebar snapshot={snapshot()} overdueCount={0} tasksLoading={false} />);
    const row = overdueRow();
    expect(row.textContent).toContain('0');
    expect(row.className).toContain('pulse-row-jade');
  });

  it('keeps a settled overdue count', () => {
    render(<KpiSidebar snapshot={snapshot()} overdueCount={2} tasksLoading={false} />);
    const row = overdueRow();
    expect(row.textContent).toContain('2');
    expect(row.className).toContain('pulse-row-rose');
  });
});
