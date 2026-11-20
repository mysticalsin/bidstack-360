import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgreementSource, RelationshipMap, WhitespaceFlag } from '@bidstack/shared';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn(), getAuthToken: vi.fn(async () => 'tok') };
});
const perms = vi.hoisted(() => ({ allow: true }));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => perms.allow) }));

import { SourcesPanel } from '@/components/agreements/SourcesPanel';
import { api } from '@/lib/api';

import WhitespacePage from './WhitespacePage';

const PFIZER = 'c0000000-0000-4000-8000-0000000000bb';
const MSA = 'a0000000-0000-4000-8000-0000000000bb';
const OWNER = 'b0000000-0000-4000-8000-000000000001';

const flag = (over: Partial<WhitespaceFlag> = {}): WhitespaceFlag => ({
  id: `${MSA}:it,engineering`,
  msaId: MSA,
  msaTitle: 'HEMA global master services agreement',
  companyId: PFIZER,
  companyName: 'Pfizer',
  signingEntity: { id: 'e0000000-0000-4000-8000-000000000001', slug: 'hema', name: 'HEMA', brandFamily: 'mantu', businessLines: ['pharma'], verificationStatus: 'verified' },
  global: true,
  countries: ['US', 'GB', 'FR'],
  lines: ['it', 'engineering'],
  headline: 'Global MSA via HEMA, no IT or Engineering business yet',
  score: 92,
  factors: [
    { key: 'scope', label: 'Scope allows other services', points: 25, max: 25, detail: 'Scope covers any services ordered under a SOW', citations: [{ kind: 'clause', label: 'Scope of services', clause: 'Clause 2.1', page: 3, excerpt: 'any professional services' }] },
    { key: 'coverage', label: 'Country coverage', points: 15, max: 15, detail: 'Global MSA', citations: [{ kind: 'countries', label: 'US, GB, FR' }] },
  ],
  scopeAllowsOtherServices: true,
  scopeNeedsAmendment: false,
  expiryDate: '2027-03-31T00:00:00.000Z',
  evidenceHash: 'abc123',
  state: 'new',
  owner: { id: OWNER, name: 'Alex Owner' },
  decisions: [],
  ...over,
});

const map: RelationshipMap = {
  companyId: PFIZER,
  companies: [
    { id: PFIZER, name: 'Pfizer', relation: 'self', country: 'US' },
    { id: 'c0000000-0000-4000-8000-0000000000bc', name: 'Pfizer Ltd (UK)', relation: 'affiliate', country: 'GB' },
  ],
  entities: [{ id: 'e0000000-0000-4000-8000-000000000001', slug: 'hema', name: 'HEMA', lines: ['pharma'], msaIds: [MSA] }],
  people: [{ owner: { id: OWNER, name: 'Alex Owner' }, entities: ['hema'], lines: ['digital'], lastActivityAt: '2026-10-20T00:00:00.000Z', totals: [{ currency: 'EUR', valueMicros: 250_000_000_000 }], counts: { msas: 1, opportunities: 0, projects: 1, contacts: 1, activities: 1 } }],
  rows: [
    { kind: 'msa', id: MSA, label: 'HEMA global MSA', companyId: PFIZER, companyName: 'Pfizer', entity: 'HEMA', line: 'health_economics', owner: { id: OWNER, name: 'Alex Owner' }, lastActivityAt: '2026-10-01T00:00:00.000Z', valueMicros: null, currency: null, country: 'US' },
    { kind: 'project', id: 'p1', label: 'Patient engagement', companyId: PFIZER, companyName: 'Pfizer', entity: null, line: 'digital', owner: null, lastActivityAt: '2026-09-01T00:00:00.000Z', valueMicros: 250_000_000_000, currency: 'EUR', country: 'US' },
    { kind: 'revenue', id: 'r1', label: 'Digital run', companyId: PFIZER, companyName: 'Pfizer', entity: null, line: 'digital', owner: null, lastActivityAt: '2026-08-01T00:00:00.000Z', valueMicros: 100_000_000_000, currency: 'USD', country: 'US' },
    { kind: 'activity', id: 'a1', label: 'QBR', companyId: PFIZER, companyName: 'Pfizer', entity: null, line: 'health_economics', owner: { id: OWNER, name: 'Alex Owner' }, lastActivityAt: '2026-10-20T00:00:00.000Z', valueMicros: null, currency: null, country: null },
  ],
  lines: [{ line: 'digital', count: 1 }],
  countries: ['US', 'GB'],
};

const second = flag({ id: 'x', msaId: 'a0000000-0000-4000-8000-000000000102', companyName: 'Northwind Pharma', companyId: 'c0000000-0000-4000-8000-000000000102', headline: 'MSA via HEMA, no Digital business yet', score: 48, lines: ['digital'], global: false });

function mockApi() {
  vi.mocked(api).mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path.startsWith('/api/msa/whitespace')) {
      return {
        items: [flag(), second],
        total: 2,
        byLine: [{ line: 'it', count: 1, topScore: 92 }, { line: 'engineering', count: 1, topScore: 92 }, { line: 'digital', count: 1, topScore: 48 }],
        facets: {
          entities: [{ id: 'e0000000-0000-4000-8000-000000000009', name: 'Amaris Consulting' }, { id: 'e0000000-0000-4000-8000-000000000001', name: 'HEMA' }],
          countries: ['DE', 'FR', 'GB', 'US'],
          lines: ['digital', 'engineering', 'it'],
          owners: [{ id: OWNER, name: 'Alex Owner' }, { id: 'b0000000-0000-4000-8000-000000000009', name: 'Sam Facet' }],
        },
      };
    }
    if (path.includes('/relationship-map')) return map;
    if (path.startsWith('/api/users')) return { items: [{ id: OWNER, name: 'Alex Owner', email: 'a@x.test', role: 'admin', createdAt: '' }], nextCursor: null };
    if (path.endsWith('/whitespace/accept') && opts?.method === 'POST') {
      const created = (opts as { body?: { createOpportunity?: boolean } }).body?.createOpportunity;
      return { flag: flag({ lines: ['engineering'] }), crossSellActionId: 'z', opportunityId: created ? 'd0000000-0000-4000-8000-000000000001' : null };
    }
    if (path.endsWith('/whitespace/dismiss') && opts?.method === 'POST') return { flag: flag({ state: 'dismissed' }), crossSellActionId: null, opportunityId: null };
    throw new Error(`unexpected ${path}`);
  });
}

function renderPage(path = '/agreements/whitespace', qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/agreements/whitespace" element={<WhitespacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { perms.allow = true; mockApi(); });
afterEach(() => { cleanup(); vi.mocked(api).mockReset(); });

describe('WhitespacePage', () => {
  it('ranks flags with Pfizer via HEMA first', async () => {
    renderPage();
    const rows = await screen.findAllByTestId('whitespace-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Global MSA via HEMA, no IT or Engineering business yet')).toBeTruthy();
    expect(within(rows[0]!).getByLabelText('Score 92 of 100')).toBeTruthy();
    expect(vi.mocked(api).mock.calls.some(([p]) => p === '/api/msa/whitespace?state=new&limit=10')).toBe(true);
  });

  it('opens a row to factors, citations and who works with them', async () => {
    renderPage();
    const [row] = await screen.findAllByTestId('whitespace-row');
    fireEvent.click(within(row!).getByRole('button', { expanded: false }));
    const factors = within(row!).getByTestId('whitespace-factors');
    expect(within(factors).getByText('25/25')).toBeTruthy();
    expect(within(factors).getByText(/Clause 2\.1/)).toBeTruthy();
    const who = await within(row!).findByTestId('who-works-with-them');
    await waitFor(() => expect(within(who).getByText('Alex Owner')).toBeTruthy());
    const trs = within(who).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(trs[0]).toContain('HEMA');
    expect(trs[0]).toContain('Health economics');
    expect(trs[1]).toContain('Digital');
    expect(trs[1]).toMatch(/€250/);
    expect(within(who).getByTestId('who-works-with-them-family').textContent).toContain('Pfizer Ltd (UK)');
  });

  it('keeps each currency apart in the value column', async () => {
    renderPage();
    const [row] = await screen.findAllByTestId('whitespace-row');
    fireEvent.click(within(row!).getByRole('button', { expanded: false }));
    const who = await within(row!).findByTestId('who-works-with-them');
    await waitFor(() => expect(within(who).getByText('Alex Owner')).toBeTruthy());
    const digital = within(who).getAllByRole('row').find((r) => r.textContent?.includes('Digital'))!;
    expect(digital.textContent).toMatch(/€250/);
    expect(digital.textContent).toMatch(/US\$100|\$100/);
    expect(digital.textContent).not.toMatch(/350/);
  });

  it('does not credit account-wide activity to an entity row', async () => {
    renderPage();
    const [row] = await screen.findAllByTestId('whitespace-row');
    fireEvent.click(within(row!).getByRole('button', { expanded: false }));
    const who = await within(row!).findByTestId('who-works-with-them');
    await waitFor(() => expect(within(who).getByText('Alex Owner')).toBeTruthy());
    const hema = within(who).getAllByRole('row').find((r) => r.textContent?.includes('HEMA'))!;
    expect(hema.textContent).toContain('1 Oct 2026');
    expect(hema.textContent).not.toContain('20 Oct 2026');
  });

  it('accept posts the line, owner, due date and opportunity choice', async () => {
    renderPage();
    const [row] = await screen.findAllByTestId('whitespace-row');
    fireEvent.click(within(row!).getByRole('button', { expanded: false }));
    fireEvent.click(within(row!).getByTestId('whitespace-accept-open'));
    await waitFor(() => expect((within(row!).getByTestId('whitespace-owner') as HTMLSelectElement).value).toBe(OWNER));
    fireEvent.click(within(row!).getByTestId('whitespace-create-opp'));
    fireEvent.click(within(row!).getByTestId('whitespace-accept'));
    await waitFor(() => {
      const call = vi.mocked(api).mock.calls.find(([p]) => p === `/api/msa/${MSA}/whitespace/accept`);
      expect(call?.[1]).toMatchObject({ method: 'POST', body: { line: 'it', ownerId: OWNER, createOpportunity: true } });
      expect((call?.[1] as { body: { dueDate: string } }).body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('a new draft opportunity refreshes the opportunity lists', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderPage('/agreements/whitespace', qc);
    const [row] = await screen.findAllByTestId('whitespace-row');
    fireEvent.click(within(row!).getByRole('button', { expanded: false }));
    fireEvent.click(within(row!).getByTestId('whitespace-accept-open'));
    await waitFor(() => expect((within(row!).getByTestId('whitespace-owner') as HTMLSelectElement).value).toBe(OWNER));
    fireEvent.click(within(row!).getByTestId('whitespace-create-opp'));
    fireEvent.click(within(row!).getByTestId('whitespace-accept'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['opportunities'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['opportunity'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['msa', 'relationship-map'] });
  });

  it('builds filter options from every flag, not only the rows on screen', async () => {
    renderPage();
    await screen.findAllByTestId('whitespace-row');
    const texts = (el: HTMLElement) => [...el.querySelectorAll('option')].map((o) => o.textContent);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const all = selects.flatMap((sel) => texts(sel));
    expect(all).toContain('Amaris Consulting');
    expect(all).toContain('Sam Facet');
    expect(all).toContain('DE');
    expect(vi.mocked(api).mock.calls.some(([p]) => String(p).includes('state=all&limit=50'))).toBe(false);
  });

  it('dismiss needs a reason', async () => {
    renderPage();
    const [row] = await screen.findAllByTestId('whitespace-row');
    fireEvent.click(within(row!).getByRole('button', { expanded: false }));
    fireEvent.click(within(row!).getByTestId('whitespace-dismiss-open'));
    const submit = within(row!).getByTestId('whitespace-dismiss') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(row!).getByTestId('whitespace-line'), { target: { value: 'engineering' } });
    fireEvent.change(within(row!).getByTestId('whitespace-reason'), { target: { value: 'In house team' } });
    fireEvent.click(submit);
    await waitFor(() => {
      const call = vi.mocked(api).mock.calls.find(([p]) => p === `/api/msa/${MSA}/whitespace/dismiss`);
      expect(call?.[1]).toMatchObject({ method: 'POST', body: { line: 'engineering', reason: 'In house team' } });
    });
  });

  it('filters go to the URL and the query', async () => {
    renderPage('/agreements/whitespace?line=engineering&country=FR');
    await screen.findAllByTestId('whitespace-row');
    expect(vi.mocked(api).mock.calls.some(([p]) => p === '/api/msa/whitespace?line=engineering&country=FR&state=new&limit=10')).toBe(true);
  });

  it('read-only users see flags but no Accept or Dismiss', async () => {
    perms.allow = false;
    renderPage();
    const [row] = await screen.findAllByTestId('whitespace-row');
    fireEvent.click(within(row!).getByRole('button', { expanded: false }));
    expect(within(row!).queryByTestId('whitespace-accept-open')).toBeNull();
    expect(within(row!).queryByTestId('whitespace-dismiss-open')).toBeNull();
  });

  it('has no tagline or helper paragraph', async () => {
    const { container } = renderPage();
    await screen.findAllByTestId('whitespace-row');
    expect(container.querySelector('.agr-head p')).toBeNull();
    expect(container.querySelector('.agr-caption')).toBeNull();
  });
});

describe('SourcesPanel', () => {
  const source = (over: Partial<AgreementSource> = {}): AgreementSource => ({
    id: 'f0000000-0000-4000-8000-000000000001',
    kind: 'sharepoint',
    name: 'Legal library',
    enabled: true,
    config: {},
    connectionId: null,
    configured: true,
    lastSyncAt: '2026-11-06T10:00:00.000Z',
    lastRun: { runId: 'r1', sourceId: 'f0000000-0000-4000-8000-000000000001', state: 'completed', startedAt: '2026-11-06T10:00:00.000Z', finishedAt: '2026-11-06T10:01:00.000Z', result: { new: 3, updated: 1, skipped: 4, failed: 0 }, reasons: [] },
    ...over,
  });

  function renderSources(items: AgreementSource[]) {
    vi.mocked(api).mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/api/msa/sources') return { items };
      if (path.endsWith('/sync') && opts?.method === 'POST') return { ...items[0]!.lastRun, state: 'queued' };
      throw new Error(`unexpected ${path}`);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><SourcesPanel /></QueryClientProvider>);
  }

  it('shows last sync and result, and Sync now starts a run', async () => {
    renderSources([source(), source({ id: 'f0000000-0000-4000-8000-000000000002', kind: 'docusign', name: 'Signed MSAs', lastRun: null, lastSyncAt: null })]);
    const rows = await screen.findAllByTestId('agreement-source');
    expect(rows[0]!.textContent).toContain('3 new · 1 updated · 4 skipped');
    expect(rows[1]!.textContent).toContain('Never synced');
    fireEvent.click(within(rows[0]!).getByTestId('agreement-source-sync'));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([p, o]) => p === '/api/msa/sources/f0000000-0000-4000-8000-000000000001/sync' && (o as { method?: string })?.method === 'POST')).toBe(true));
  });

  it('a running source cannot be synced again', async () => {
    renderSources([source({ lastRun: { ...source().lastRun!, state: 'running', finishedAt: null, result: null } })]);
    const [row] = await screen.findAllByTestId('agreement-source');
    expect(row!.textContent).toContain('Syncing');
    expect((within(row!).getByTestId('agreement-source-sync') as HTMLButtonElement).disabled).toBe(true);
  });
});
