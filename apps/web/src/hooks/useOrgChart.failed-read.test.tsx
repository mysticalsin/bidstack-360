import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn() };
});
vi.mock('@/lib/auth', () => ({ useUser: () => ({ user: { fullName: 'Jane Smith' } }) }));

import { ApiError, api } from '@/lib/api';
import { OrgChartCard } from '@/components/orgchart/OrgChartCard';
import { fakeOrgChartServer } from '@/lib/orgchart/fakeOrgChartServer.testutil';

import OrgChartPage from '@/pages/accounts/OrgChartPage';

const CI = 'c0000000-0000-4000-8000-000000000001';

type Mode = 'coverage-hang' | 'coverage-fail' | 'chart-fail' | 'empty-ok' | 'live-ok';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function install(mode: Mode) {
  const srv = fakeOrgChartServer(CI);
  if (mode === 'live-ok' || mode === 'coverage-hang' || mode === 'coverage-fail') {
    const ceo = srv.add(
      { name: 'Ana Silva', title: 'Chief Executive Officer', seniority: 'c_level', meetingCount: 1, lastMetAt: '2026-10-25T10:00:00Z' },
      null,
    );
    srv.add({ name: 'Bruno Costa', title: 'Director of Operations', seniority: 'director' }, ceo.id);
  }
  const seen = { coverage: false, meetings: false };
  vi.mocked(api).mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (path.includes('/org-chart/coverage')) {
      seen.coverage = true;
      if (mode === 'coverage-hang') return new Promise(() => {}) as never;
      if (mode === 'coverage-fail') throw new ApiError('coverage down', 500, {});
    }
    if (path.includes('/org-chart')) {
      if (mode === 'chart-fail') throw new ApiError('chart down', 500, {});
      const row = srv.handle(opts?.method ?? 'GET', path, opts?.body as Record<string, unknown> | undefined);
      if (row === undefined) throw new ApiError(`no route ${path}`, 404, {});
      return row as never;
    }
    if (path.startsWith(`/api/companies/${CI}`)) return { id: CI, name: 'Northwind Demo' } as never;
    if (path.startsWith('/api/meeting-intel')) {
      seen.meetings = true;
      return { items: [], nextCursor: null } as never;
    }
    if (path.startsWith('/api/me/capabilities')) {
      return { userId: 'u1', orgId: 'o1', legacyRole: 'member', roles: [], permissions: [], isAdmin: false } as never;
    }
    throw new ApiError(`no route ${path}`, 404, {});
  });
  return seen;
}

function renderCard(withPage = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/accounts/${CI}/org-chart`]}>
        <OrgChartCard companyId={CI} />
        {withPage ? <Routes><Route path="/accounts/:accountId/org-chart" element={<OrgChartPage />} /></Routes> : null}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('org chart failed read', () => {
  it('does not call an unread coverage read zero senior gaps', async () => {
    // WHY: the account card is where a reader checks senior gaps. Coverage
    // that has not arrived is not a finished chart with no gaps.
    const seen = install('coverage-hang');
    renderCard();
    await waitFor(() => expect(seen.coverage).toBe(true));
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText(/senior gap/)).toBeNull();
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.queryByText(/Nobody has charted/)).toBeNull();
  });

  it('does not call a failed coverage read zero senior gaps', async () => {
    // WHY: a failed coverage read has no gap list. Zero gaps would say the work is done.
    install('coverage-fail');
    renderCard();
    expect(await screen.findByText('The org chart could not be loaded.')).toBeTruthy();
    expect(screen.queryByText(/senior gap/)).toBeNull();
    expect(screen.queryByText(/Nobody has charted/)).toBeNull();
    expect(screen.queryByText('Sample')).toBeNull();
  });

  it('does not call a failed chart read a sample structure', async () => {
    // WHY: a failed chart read is not "nobody has charted this account".
    const seen = install('chart-fail');
    renderCard(true);
    expect((await screen.findAllByText(/The org chart could not be loaded/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(seen.meetings).toBe(true));
    expect(screen.queryAllByText('Sample')).toEqual([]);
    expect(screen.queryByText(/Nobody has charted/)).toBeNull();
  });

  it('keeps a real empty chart as a sample once meetings have loaded', async () => {
    // WHY: an account with no saved chart, after meeting intel loads, still
    // shows the labelled Sample. That empty state stays.
    install('empty-ok');
    renderCard();
    expect(await screen.findByText('Sample')).toBeTruthy();
    expect(screen.getByText(/Nobody has charted/)).toBeTruthy();
    expect(screen.queryByText('The org chart could not be loaded.')).toBeNull();
  });

  it('keeps a loaded senior gap', async () => {
    // WHY: a settled coverage read still names the unmet director.
    install('live-ok');
    renderCard();
    await waitFor(() => expect(screen.getByTestId('account-orgchart-card').textContent).toMatch(/1 senior gap(?!s)/));
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.queryByText('The org chart could not be loaded.')).toBeNull();
  });
});
