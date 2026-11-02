import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuietAccountsLine } from './QuietAccountsLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (typeof values?.count === 'number')
        return fallback.replace('{{count}}', String(values.count));
      return fallback;
    },
  }),
}));

describe('QuietAccountsLine', () => {
  afterEach(cleanup);

  it('says how many accounts in this view have gone quiet', () => {
    // WHY: the number is accounts in the filtered view, not events and not one
    // page of cards. A partial read must not be captioned as this view.
    render(<QuietAccountsLine status="ready" hasAccounts complete accounts={2} />);
    const line = screen.getByTestId('quiet-accounts');
    expect(line.textContent).toBe('2 accounts in this view have gone quiet.');
    expect(line.textContent).toMatch(/this view/i);
    expect(line.textContent).not.toMatch(/\bpage\b/i);

    cleanup();
    render(<QuietAccountsLine status="ready" hasAccounts complete accounts={1} />);
    expect(screen.getByText('1 account in this view has gone quiet.')).toBeTruthy();

    cleanup();
    render(<QuietAccountsLine status="ready" hasAccounts complete accounts={0} />);
    expect(screen.getByText('No account in this view has gone quiet.')).toBeTruthy();

    cleanup();
    render(<QuietAccountsLine status="ready" hasAccounts complete={false} accounts={2} />);
    expect(screen.getByTestId('quiet-accounts').textContent).toMatch(/latest page/i);
    expect(screen.getByTestId('quiet-accounts').textContent).toMatch(/not every account in this view/i);

    cleanup();
    render(<QuietAccountsLine status="error" hasAccounts complete accounts={4} />);
    expect(screen.getByRole('alert').textContent).toMatch(/didn't load/i);
    expect(screen.queryByTestId('quiet-accounts')).toBeNull();
  });

  it('asks for the filtered view, next to the overdue line', () => {
    const segment = readFileSync(
      join(process.cwd(), 'src/pages/accountsPage/AccountsAllSegment.tsx'),
      'utf8',
    );
    expect(segment).toContain('useQuietAccounts(viewCompanyIds)');
    expect(segment).not.toMatch(/useQuietAccounts\(\s*pagedRows/);
    expect(segment).not.toMatch(/viewCompanyIds\.slice\(\s*0\s*,\s*(30|100|500)\s*\)/);
    const at = segment.indexOf('<QuietAccountsLine');
    const overdue = segment.indexOf('<OverdueTaskAccountsLine');
    expect(at).toBeGreaterThan(overdue);
  });
});
