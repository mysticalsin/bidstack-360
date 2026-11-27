import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn(), getAuthToken: vi.fn(async () => 'tok') };
});
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

import { ApiError, api } from '@/lib/api';
import { sampleRows } from '@/lib/msa/sample';
import type { MsaSummaryRow } from '@/lib/msa/types';

import AgreementsPage from './AgreementsPage';

const SAMPLE_LEVERAGE_UNREAD = 'This Sample preview has not loaded MSA leverage flags.';
const PAGE_LEVERAGE_UNREAD = 'Under-leveraged MSAs past this page have not loaded.';

// WHY: Filtering the agreements library to Under-leveraged MSA uses the
// rows already loaded. Until the leverage read has arrived, that filter
// said "0 agreements match" and "No agreements match these filters."
// The Sample stand-in never ran the read. A page that continues has not
// loaded later agreements. A finished page with no flag is a real empty
// result. A loaded flag stays, and NW-61520 stays a reference, not euros.

const missing = () => new ApiError('Route GET:/api/v1/msa not found', 404, { message: 'Route GET:/api/v1/msa not found' });
const BANNED = /\b0\b|none|empty|no agreements|€|EUR|euros|[\u2014\u2013]/i;

function row(n: number, underLeveraged: boolean, reference = `REF-${n}`): MsaSummaryRow {
  const base = sampleRows(0)[0]!;
  return {
    ...base,
    id: `a0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    parentId: null,
    title: reference === 'NW-61520' ? 'HEMA master services agreement' : `Agreement ${n}`,
    reference,
    underLeveraged,
    childCount: 0,
  };
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AgreementsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(api).mockImplementation(async () => { throw missing(); }));
afterEach(() => { cleanup(); vi.mocked(api).mockReset(); });

describe('agreements leverage filter does not invent a zero', () => {
  it('does not call the Sample stand-in an empty under-leveraged book', async () => {
    renderAt('/agreements?leverage=1');
    expect(await screen.findByTestId('agreements-sample-banner')).toBeTruthy();
    const count = screen.getByTestId('agreements-count');
    expect(count.textContent).toBe(SAMPLE_LEVERAGE_UNREAD);
    expect(count.textContent).not.toMatch(BANNED);
    expect(screen.queryByText('No agreements match these filters.')).toBeNull();
  });

  it('does not call a cut-off page an empty under-leveraged book', async () => {
    const items = Array.from({ length: 101 }, (_, n) => row(n + 1, false));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/msa/sources') return { items: [] };
      return { items, nextCursor: null, total: items.length };
    });
    renderAt('/agreements?leverage=1');
    const count = await screen.findByTestId('agreements-count');
    expect(count.textContent).toBe(PAGE_LEVERAGE_UNREAD);
    expect(count.textContent).not.toMatch(BANNED);
    expect(screen.queryByText('No agreements match these filters.')).toBeNull();
    expect(screen.queryByTestId('agreements-sample-banner')).toBeNull();
  });

  it('keeps a finished page with no flag as a real empty result', async () => {
    const items = [row(1, false), row(2, false)];
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/msa/sources') return { items: [] };
      return { items, nextCursor: null, total: items.length };
    });
    renderAt('/agreements?leverage=1');
    const count = await screen.findByTestId('agreements-count');
    expect(count.textContent).toMatch(/^0 agreements match/);
    expect(screen.getByText('No agreements match these filters.')).toBeTruthy();
  });

  it('keeps a loaded under-leveraged agreement, and NW-61520 is not euros', async () => {
    const items = [row(61520, true, 'NW-61520')];
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/msa/sources') return { items: [] };
      return { items, nextCursor: null, total: items.length };
    });
    renderAt('/agreements?leverage=1');
    expect(await screen.findByText(/NW-61520/)).toBeTruthy();
    expect(screen.getByText('Under-leveraged')).toBeTruthy();
    expect(screen.getByTestId('agreements-count').textContent).toMatch(/^1 agreement match/);
    expect(document.body.textContent).not.toMatch(/€\s*61520|EUR\s*61520|61520\s*euros/i);
    expect(screen.queryByText('No agreements match these filters.')).toBeNull();
  });

  it('does not say zero while the agreements list has not arrived', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(api).mockImplementation(async (path: string) => {
      await gate;
      if (path === '/api/msa/sources') return { items: [] };
      return { items: [row(61520, true, 'NW-61520')], nextCursor: null, total: 1 };
    });
    renderAt('/agreements?leverage=1');
    expect(screen.queryByTestId('agreements-count')).toBeNull();
    expect(screen.queryByText('No agreements match these filters.')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/\b0 agreements\b|none|empty/i);
    release();
    expect(await screen.findByText(/NW-61520/)).toBeTruthy();
  });
});
