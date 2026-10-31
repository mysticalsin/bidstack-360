import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn(), getAuthToken: vi.fn(async () => 'tok') };
});
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(() => ({ data: { items: [{ id: 'c0000000-0000-4000-8000-000000000001', name: 'CI Financial' }] } })),
}));

import { AgreementsSummaryCard } from '@/components/agreements/AgreementsSummaryCard';
import { ApiError, api } from '@/lib/api';
import { sampleDetail, sampleRows } from '@/lib/msa/sample';
import type { MsaDetail } from '@/lib/msa/types';

import AgreementDetailPage from './AgreementDetailPage';
import AgreementsPage from './AgreementsPage';
import { applyView, headline } from './view';

const missing = () => new ApiError('Route GET:/api/v1/msa not found', 404, { message: 'Route GET:/api/v1/msa not found' });
const CI = 'c0000000-0000-4000-8000-000000000001';
const MSA = 'a0000000-0000-4000-8000-000000000101';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function MsaRedirect() {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/agreements/${id ?? ''}${search}`} replace />;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/agreements" element={<AgreementsPage />} />
          <Route path="/agreements/:id" element={<AgreementDetailPage />} />
          <Route path="/msa/:id" element={<MsaRedirect />} />
          <Route path="/accounts/:id" element={<AgreementsSummaryCard companyId={CI} companyName="CI Financial" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(api).mockImplementation(async () => { throw missing(); }));
afterEach(() => { cleanup(); vi.mocked(api).mockReset(); });

describe('headline / applyView', () => {
  const rows = sampleRows();
  it('counts the four headline numbers', () => {
    expect(headline(rows)).toEqual({ active: 6, expiring: 4, notice: 1, open: 3 });
  });
  it('applies URL filters including the headline view', () => {
    expect(applyView(rows, new URLSearchParams('view=open')).map((r) => r.status).sort()).toEqual(['draft', 'in_negotiation', 'pending']);
    expect(applyView(rows, new URLSearchParams('view=notice')).map((r) => r.reference)).toEqual(['CIF-SOW-07']);
    expect(applyView(rows, new URLSearchParams(`companyId=${CI}`)).map((r) => r.reference)).toEqual(['CIF-NDA-2022', 'CIF-MSA-2023']);
    expect(applyView(rows, new URLSearchParams('q=sow')).map((r) => r.reference)).toEqual(['CIF-SOW-07', 'CIF-SOW-08']);
  });
});

describe('AgreementsPage', () => {
  it('shows Sample banner, headline numbers, strip and table; a number filters the table via the URL', async () => {
    renderAt('/agreements');
    expect(await screen.findByTestId('agreements-sample-banner')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Agreements' })).toBeTruthy();
    expect(within(screen.getByTestId('agreements-expiring-strip')).getAllByRole('link')).toHaveLength(4);
    expect(within(screen.getByTestId('agreements-table')).getAllByRole('row')).toHaveLength(1 + 6);
    fireEvent.click(screen.getByTestId('agreements-kpi-open'));
    expect(screen.getByTestId('where').textContent).toBe('/agreements?view=open');
    expect(screen.getByTestId('agreements-kpi-open').getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByTestId('agreements-table')).getAllByRole('row')).toHaveLength(1 + 3);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agreements' }), { target: { value: 'mahle' } });
    expect(screen.getByTestId('agreements-count').textContent).toMatch(/^1 agreement match/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByTestId('where').textContent).toBe('/agreements');
  });

  it('turns uploads off in Sample mode and says why', async () => {
    renderAt('/agreements');
    fireEvent.click(await screen.findByTestId('agreements-new'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Uploading is off in this Sample preview/)).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: 'Create agreement' }).hasAttribute('disabled')).toBe(true);
  });

  it('surfaces a real API error instead of Sample data', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Forbidden', 403, { message: 'Forbidden' }));
    renderAt('/agreements');
    expect(await screen.findByText("Couldn't load agreements")).toBeTruthy();
    expect(screen.queryByTestId('agreements-sample-banner')).toBeNull();
  });
});

describe('AgreementDetailPage', () => {
  it('renders key terms, versions, children and timeline', async () => {
    renderAt(`/agreements/${MSA}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Master services agreement' })).toBeTruthy();
    // The topbar owns the trail (Agreements / Detail); the page no longer repeats it.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    expect(screen.getByRole('link', { name: 'CI Financial' }).getAttribute('href')).toBe(`/accounts/${CI}`);
    expect(screen.getByText('Ontario, Canada')).toBeTruthy();
    expect(within(screen.getByTestId('agreement-versions')).getAllByRole('row')).toHaveLength(1 + 3);
    expect(within(screen.getByTestId('agreement-children')).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'SOW 7 — Legacy app retirement', 'SOW 8 — Security operations uplift', 'Amendment 2 — Rate card 2026',
    ]);
    expect(await screen.findByText('Last day to give notice')).toBeTruthy();
    expect(screen.getByTestId('agreement-viewer-sample')).toBeTruthy();
  });

  it('shows a not-found state for a missing record', async () => {
    renderAt('/agreements/a0000000-0000-4000-8000-000000000999');
    expect(await screen.findByText('Agreement not found')).toBeTruthy();
  });

  it('live mode: uploads a new version through upload-url → PUT → finalize', async () => {
    const detail = { ...(sampleDetail(MSA) as MsaDetail) };
    const calls: string[] = [];
    vi.mocked(api).mockImplementation(async (path: string) => {
      calls.push(path);
      if (path.endsWith('/timeline')) return { items: [] };
      if (path.endsWith('/upload-url')) return { uploadUrl: 'https://s3.example/k?sig', storageKey: 'k', headers: { 'Content-Type': 'application/pdf' }, maxBytes: 1 };
      if (path.endsWith('/versions')) return { id: 'v9', versionNo: 4, sha256: 'x' };
      return detail;
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt(`/agreements/${MSA}`);
    fireEvent.click(await screen.findByTestId('agreement-upload-version'));
    const dlg = await screen.findByRole('dialog');
    const input = dlg.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(within(dlg).getByRole('alert').textContent).toMatch(/PDF and Word/);
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'v4.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Upload version' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toEqual(expect.arrayContaining([`/api/msa/${MSA}/versions/upload-url`, `/api/msa/${MSA}/versions`]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('AgreementsSummaryCard', () => {
  it('links each number into the filtered library', async () => {
    renderAt(`/accounts/${CI}`);
    const card = await screen.findByTestId('account-agreements-card');
    await within(card).findByText('Master services agreement');
    expect(within(card).getByRole('link', { name: 'View all' }).getAttribute('href')).toBe(`/agreements?companyId=${CI}`);
    expect(within(card).getByRole('link', { name: /Active of 5/ }).getAttribute('href')).toBe(`/agreements?companyId=${CI}&view=active`);
    expect(within(card).getByRole('link', { name: '2 SOWs' }).getAttribute('href')).toBe(`/agreements?companyId=${CI}&kind=sow`);
    expect(within(card).getByText('Sample')).toBeTruthy();
  });
});

describe('live API wiring', () => {
  const liveDetail = () => ({ ...(sampleDetail(MSA) as MsaDetail) });

  it('searches inside documents and links a hit to that version', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/msa/search')) {
        return { items: [{ contractId: MSA, versionId: 'v2', versionNo: 2, title: 'Master services agreement', companyId: CI, kind: 'msa', status: 'active', rank: 0.5, snippet: 'the [[liability]] cap is' }] };
      }
      return { items: sampleRows(), nextCursor: null, total: sampleRows().length };
    });
    renderAt('/agreements?q=liability');
    const hits = await screen.findByTestId('agreements-doc-hits', {}, { timeout: 2000 });
    await waitFor(() => expect(hits.querySelector('mark')?.textContent).toBe('liability'));
    expect(hits.querySelector('a')?.getAttribute('href')).toBe(`/agreements/${MSA}?version=v2`);
    expect(vi.mocked(api).mock.calls.some(([p]) => String(p).startsWith('/api/msa/search?q=liability'))).toBe(true);
  });

  it('previews a PDF from a local blob, and falls back to Download when the file host blocks it', async () => {
    const detail = liveDetail();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.endsWith('/timeline')) return { items: [] };
      if (path.endsWith('/download-url')) return { url: 'http://files.example/dl?t=1', expiresAt: new Date(Date.now() + 120_000).toISOString(), fileName: 'f.pdf', sha256: 'x' };
      return detail;
    });
    const createUrl = vi.fn(() => 'blob:preview');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.4', { status: 200 })));
    renderAt(`/agreements/${MSA}`);
    fireEvent.click(await screen.findByRole('button', { name: /Preview/ }));
    const frame = await screen.findByTestId('agreement-viewer-frame');
    expect(frame.getAttribute('src')).toBe('blob:preview');
    expect(screen.getByTestId('agreement-download').getAttribute('href')).toBe('blob:preview');
    cleanup();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    renderAt(`/agreements/${MSA}`);
    fireEvent.click(await screen.findByRole('button', { name: /Preview/ }));
    await screen.findByTestId('agreement-viewer-fallback');
    expect(screen.getByTestId('agreement-download').getAttribute('href')).toBe('http://files.example/dl?t=1');
    vi.unstubAllGlobals();
  });

  it('sends reminder links (/msa/:id) to the agreement page', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => (path.endsWith('/timeline') ? { items: [] } : liveDetail()));
    renderAt(`/msa/${MSA}?reminder=notice&term=2027-01-13`);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/agreements/${MSA}?reminder=notice&term=2027-01-13`));
  });
});

