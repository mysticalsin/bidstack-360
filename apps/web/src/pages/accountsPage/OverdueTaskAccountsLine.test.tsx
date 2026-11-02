import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverdueTaskAccountsLine } from './OverdueTaskAccountsLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (typeof values?.count === 'number')
        return fallback.replace('{{count}}', String(values.count));
      return fallback;
    },
  }),
}));

describe('OverdueTaskAccountsLine', () => {
  afterEach(cleanup);

  it('says how many accounts in this view already have an overdue open task', () => {
    // WHY: the number is accounts in the filtered view, not tasks and not one
    // page of cards. A partial read must not be captioned as this view.
    render(<OverdueTaskAccountsLine status="ready" hasAccounts complete accounts={2} />);
    const line = screen.getByTestId('overdue-task-accounts');
    expect(line.textContent).toBe('2 accounts in this view already have an overdue open task.');
    expect(line.textContent).toMatch(/this view/i);
    expect(line.textContent).not.toMatch(/\bpage\b/i);

    cleanup();
    render(<OverdueTaskAccountsLine status="ready" hasAccounts complete accounts={1} />);
    expect(
      screen.getByText('1 account in this view already has an overdue open task.'),
    ).toBeTruthy();

    cleanup();
    render(<OverdueTaskAccountsLine status="ready" hasAccounts complete accounts={0} />);
    expect(screen.getByText('No account in this view has an overdue open task.')).toBeTruthy();

    cleanup();
    render(<OverdueTaskAccountsLine status="ready" hasAccounts complete={false} accounts={2} />);
    expect(screen.getByTestId('overdue-task-accounts').textContent).toMatch(/latest page/i);
    expect(screen.getByTestId('overdue-task-accounts').textContent).toMatch(
      /not every account in this view/i,
    );

    cleanup();
    render(<OverdueTaskAccountsLine status="error" hasAccounts complete accounts={4} />);
    expect(screen.getByRole('alert').textContent).toMatch(/didn't load/i);
    expect(screen.queryByTestId('overdue-task-accounts')).toBeNull();
  });

  it('asks for the filtered view, not the card page', () => {
    const segment = readFileSync(
      join(process.cwd(), 'src/pages/accountsPage/AccountsAllSegment.tsx'),
      'utf8',
    );
    expect(segment).toContain('useOverdueTaskAccounts(viewCompanyIds)');
    expect(segment).not.toMatch(/useOverdueTaskAccounts\(\s*pagedRows/);
    expect(segment).not.toMatch(/viewCompanyIds\.slice\(\s*0\s*,\s*(30|100|500)\s*\)/);
    const at = segment.indexOf('<OverdueTaskAccountsLine');
    const next = segment.indexOf('<NextOpenTaskLine');
    expect(at).toBeGreaterThan(next);
  });
});
