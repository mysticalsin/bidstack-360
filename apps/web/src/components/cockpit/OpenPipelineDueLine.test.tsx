// The header line is what a bid lead reads under the open-pipeline figure.
// Words carry the lateness. Color is extra, not the only signal.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenPipelineDueLine } from './OpenPipelineDueLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? '')) : fallback,
  }),
}));

afterEach(cleanup);

describe('OpenPipelineDueLine', () => {
  it('stays a plain open count when nothing is late', () => {
    render(<OpenPipelineDueLine open={2} overdue={0} oldestOverdueDays={0} />);
    expect(screen.getByText('2 open deals').textContent).toBe('2 open deals');
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it('names the days for the one open deal that is already late', () => {
    render(<OpenPipelineDueLine open={1} overdue={1} oldestOverdueDays={126} />);
    const line = screen.getByText(/1 open deal/);
    expect(line.textContent).toBe('1 open deal · 126d overdue');
    expect(line.querySelector('.acct-key-late')?.textContent).toContain('126d overdue');
  });

  it('says the whole open book is overdue when every open deal is late', () => {
    render(<OpenPipelineDueLine open={6} overdue={6} oldestOverdueDays={148} />);
    expect(screen.getByText(/6 open deals/).textContent).toBe('6 open deals · all overdue');
  });

  it('counts a partial late book without calling the rest overdue', () => {
    render(<OpenPipelineDueLine open={4} overdue={2} oldestOverdueDays={148} />);
    expect(screen.getByText(/4 open deals/).textContent).toBe('4 open deals · 2 overdue');
  });
});
