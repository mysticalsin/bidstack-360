import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), deals: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      values ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? '')) : fallback,
  }),
}));
vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('@/components/people/AccountPeopleSection', () => ({
  AccountPeopleSection: ({ deals }: { deals: Array<{ id: string; name: string }> }) => {
    mocks.deals(deals);
    return <p data-testid="deal-count">{deals.length}</p>;
  },
}));

import { CompanyPeopleTab } from './CompanyPeopleTab';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const opp = (i: number) => ({ id: `opp-${i}`, name: `Deal ${i}` });
const inline = Array.from({ length: 200 }, (_, i) => opp(i));

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.deals.mockReset();
});
afterEach(() => cleanup());

describe('CompanyPeopleTab', () => {
  it('uses the detail payload when it is under the cap', () => {
    wrap(<CompanyPeopleTab companyId={COMPANY} opportunities={[opp(1), opp(2)]} />);
    expect(screen.getByTestId('deal-count').textContent).toBe('2');
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('offers older deals past the 200 cap by walking every opportunity page', async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path.includes('cursor=')) return { items: [opp(200), opp(201)], nextCursor: null };
      return { items: inline, nextCursor: 'opp-199' };
    });
    wrap(<CompanyPeopleTab companyId={COMPANY} opportunities={inline} />);
    await waitFor(() => expect(screen.getByTestId('deal-count').textContent).toBe('202'));
    expect(mocks.api.mock.calls[0][0]).toBe(`/api/opportunities?companyId=${COMPANY}&limit=200`);
  });

  it('says when the full deal list failed to load instead of silently truncating', async () => {
    mocks.api.mockRejectedValue(new Error('boom'));
    wrap(<CompanyPeopleTab companyId={COMPANY} opportunities={inline} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load every deal');
    expect(screen.getByTestId('deal-count').textContent).toBe('200');
  });
});
