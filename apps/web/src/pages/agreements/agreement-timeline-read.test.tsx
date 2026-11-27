import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn(), getAuthToken: vi.fn(async () => 'tok') };
});
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

import { ApiError, api } from '@/lib/api';

import AgreementDetailPage from './AgreementDetailPage';

const MSA = 'a0000000-0000-4000-8000-000000000101';
const missing = () =>
  new ApiError('Route GET:/api/msa not found', 404, { message: 'Route GET:/api/msa not found' });

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/agreements/${MSA}`]}>
        <Routes>
          <Route path="/agreements/:id" element={<AgreementDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api).mockImplementation(async () => {
    throw missing();
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(api).mockReset();
});

describe('agreement timeline read', () => {
  it('does not call a failed timeline an empty activity list', async () => {
    // WHY: a 500 on the audit trail used to fall through the empty check
    // (`data ?? []`) and say "No activity yet." The events never arrived.
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (String(path).endsWith('/timeline')) {
        throw new ApiError('Timeline down', 500, { message: 'Timeline down' });
      }
      throw missing();
    });
    renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'Master services agreement' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/has not arrived/);
    expect(screen.queryByText('No activity yet.')).toBeNull();
  });

  it('still says there is no activity when the trail arrived empty', async () => {
    // WHY: a settled empty list is a real answer. Only a missing payload is unread.
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (String(path).endsWith('/timeline')) return { items: [] };
      throw missing();
    });
    renderDetail();
    expect(await screen.findByText('No activity yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the skeleton while the trail has not come back', async () => {
    // WHY: an in-flight read is not an empty trail. The empty sentence waits
    // until the payload arrives.
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (String(path).endsWith('/timeline')) return new Promise(() => undefined);
      throw missing();
    });
    renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'Master services agreement' })).toBeTruthy();
    expect(screen.queryByText('No activity yet.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
