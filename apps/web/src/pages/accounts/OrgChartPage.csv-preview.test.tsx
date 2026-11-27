import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn() };
});
vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));
vi.mock('@/lib/auth', () => ({ useUser: () => ({ user: { fullName: 'Jane Smith' } }) }));

import { ApiError, api } from '@/lib/api';
import { fakeOrgChartServer } from '@/lib/orgchart/fakeOrgChartServer.testutil';

import OrgChartPage from './OrgChartPage';

const CI = 'c0000000-0000-4000-8000-000000000001';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

let srv = fakeOrgChartServer(CI);

beforeEach(() => {
  srv = fakeOrgChartServer(CI);
  vi.mocked(api).mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (path.includes('/org-chart')) {
      const r = srv.handle(opts?.method ?? 'GET', path, opts?.body as Record<string, unknown> | undefined);
      if (r === undefined) throw new ApiError(`no route ${path}`, 404, {});
      return r as never;
    }
    if (path.startsWith(`/api/companies/${CI}`)) return { id: CI, name: 'Northwind Freight' } as never;
    if (path.startsWith('/api/meeting-intel')) return { items: [], nextCursor: null } as never;
    if (path.startsWith('/api/contacts')) return { items: [] } as never;
    throw new ApiError(`no route ${path}`, 404, {});
  });
});

afterEach(cleanup);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/accounts/${CI}/org-chart`]}>
        <Routes>
          <Route path="/accounts/:accountId/org-chart" element={<OrgChartPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrgChartPage CSV import preview', () => {
  it('lists the people in a CSV dry run instead of an empty tray', async () => {
    // WHY: the tray only renders when the dry run sends preview rows. A count
    // of "2 to add" with no names is an empty tray, so the operator confirms
    // a file they cannot see. HTML already lists each person.
    srv.add({ name: 'Nia Calder', title: 'Chief Executive Officer', seniority: 'c_level' }, null);
    renderPage();
    fireEvent.click(await screen.findByTestId('orgchart-edit'));
    const file = new File(
      ['name,title,manager_name\nNora Lee,VP Cloud,\nOmar Haddad,Director Data,Nora Lee\n'],
      'people.csv',
      { type: 'text/csv' },
    );
    await act(async () => {
      fireEvent.change(screen.getByTestId('orgchart-csv-input'), { target: { files: [file] } });
    });
    const prev = await screen.findByTestId('orgchart-csv-preview');
    expect(prev.textContent).toMatch(/2\s*to add/);
    const table = within(prev).getByTestId('orgchart-import-preview');
    const rows = within(table).getAllByRole('row');
    const nora = rows.find((row) => row.textContent?.includes('Nora Lee') && !row.textContent?.includes('Omar Haddad'));
    const omar = rows.find((row) => row.textContent?.includes('Omar Haddad'));
    expect(nora?.textContent).toMatch(/VP Cloud/);
    expect(nora?.textContent).toMatch(/Top of chart/);
    expect(omar?.textContent).toMatch(/Director Data/);
    expect(omar?.textContent).toMatch(/Nora Lee/);
    expect(omar?.textContent).not.toMatch(/Top of chart/);
    expect(srv.nodes.size).toBe(1);
  });
});
