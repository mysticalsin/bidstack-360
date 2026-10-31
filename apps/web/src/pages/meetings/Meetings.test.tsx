import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn() };
});
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

import { WhoWeMetCard } from '@/components/meetings/WhoWeMetCard';
import { MeetingSourcesSection } from '@/components/settings/MeetingSourcesSection';
import { ApiError, api } from '@/lib/api';

import MeetingDetailPage from './MeetingDetailPage';
import MeetingFlagsPage from './MeetingFlagsPage';

const CI = 'c0000000-0000-4000-8000-000000000001';
const att = (id: string, name: string, seniority: string, region: string, extra: object = {}) => ({
  id, name, email: null, title: `${name} title`, seniority, region, businessUnit: null, isInternal: false, contactId: `k-${id}`, reportsToContactId: null, ...extra,
});
const meeting = {
  id: 'm1', companyId: CI, companyName: 'CI Financial', title: 'Cloud cost review with the CIO', heldAt: '2026-10-25T10:00:00Z',
  visibility: 'org', sources: ['manual'], attendeeCount: 2, topSeniority: 'c_level', challenges: ['Cloud cost overruns'], nextSteps: ['Send TCO model'],
  summary: 'CIO wants to cut cloud spend.', transcript: null, similarProjects: [], opportunities: ['FinOps review'], createdAt: '2026-10-25T12:00:00Z',
  attendees: [att('1', 'Michael Johnson', 'c_level', 'CA'), att('2', 'Sarah Patel', 'director', 'CA', { reportsToContactId: 'k-1' }), att('3', 'Jane Smith', 'unknown', 'CA', { isInternal: true, contactId: null })],
  sourceLinks: [{ source: 'manual', externalId: null, url: null, ingestedAt: '2026-10-25T12:00:00Z' }],
};
const flag = (id: string, status = 'open') => ({
  id, meetingId: 'm1', parentCompanyId: 'p', parentCompanyName: 'CI Financial group', companyName: 'CI Financial Europe', companyRestricted: false,
  ownedCompanyId: CI, ownedCompanyName: 'CI Financial', reason: `Reason ${id}`, talkingPoints: [`Ask about ${id}`], status, createdAt: '2026-10-31T10:00:00Z',
});

function routeApi(handlers: Record<string, (init?: { method?: string; body?: unknown }) => unknown>) {
  vi.mocked(api).mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const hit = Object.entries(handlers).find(([k]) => key.startsWith(k));
    if (!hit) throw new ApiError(`no route ${key}`, 404, {});
    return hit[1](init) as never;
  });
}

function renderAt(path: string, ui?: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/meetings/flags" element={<MeetingFlagsPage />} />
          <Route path="/meeting-intel/flags/:flagId" element={<MeetingFlagsPage />} />
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.mocked(api).mockReset(); });

describe('WhoWeMetCard', () => {
  it('shows the coverage map with gaps and drills into the people behind a cell', async () => {
    routeApi({
      [`GET /api/meeting-intel/accounts/${CI}/coverage`]: () => ({
        groupId: CI, regions: ['CA', 'GB'], seniorities: ['c_level', 'vp', 'director', 'manager'], windowDays: 365,
        cells: [{ region: 'CA', seniority: 'c_level', meetings: 1, people: 1, lastMetAt: '2026-10-25T10:00:00Z' }, { region: 'CA', seniority: 'director', meetings: 1, people: 1, lastMetAt: '2026-10-25T10:00:00Z' }],
        gaps: [{ region: 'GB', seniority: 'c_level' }],
      }),
      [`GET /api/meeting-intel/accounts/${CI}/challenges`]: () => ({ items: [{ challenge: 'Cloud cost overruns', mentions: 2, regions: ['CA'], lastMentionedAt: '2026-10-25T10:00:00Z', meetingIds: ['m1'] }] }),
      'GET /api/meeting-intel/m1': () => meeting,
      'GET /api/meeting-intel?': () => ({ items: [meeting], nextCursor: null }),
    });
    renderAt('/accounts/x', <WhoWeMetCard companyId={CI} companyName="CI Financial" />);
    const card = await screen.findByTestId('account-who-we-met');
    const gap = await within(card).findByRole('button', { name: 'GB, C-level: gap, nobody met' });
    expect(gap.textContent).toBe('Gap');
    expect(within(card).getByText('Cloud cost overruns')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /^CA, C-level: 1 person/ }));
    const drill = await within(card).findByTestId('people-drill');
    await within(drill).findByText('Michael Johnson');
    expect(within(drill).queryByText('Sarah Patel')).toBeNull();
    expect(within(drill).queryByText('Jane Smith')).toBeNull();
  });

  it('hides itself without meetings:read (403)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('forbidden', 403, {}));
    renderAt('/accounts/x', <WhoWeMetCard companyId={CI} companyName="CI Financial" />);
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('account-who-we-met')).toBeNull());
  });
});

describe('MeetingDetailPage', () => {
  it('shows what we learned, who was there with reports-to, and our side', async () => {
    routeApi({ 'GET /api/meeting-intel/m1': () => meeting });
    renderAt('/meetings/m1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Cloud cost review with the CIO' })).toBeTruthy();
    expect(screen.getByText('CIO wants to cut cloud spend.')).toBeTruthy();
    expect(screen.getByText('FinOps review')).toBeTruthy();
    const row = screen.getByText('Sarah Patel').closest('tr')!;
    expect(within(row).getByRole('link', { name: 'Michael Johnson' }).getAttribute('href')).toBe('/contacts/k-1');
    expect(screen.getByText(/From our side: Jane Smith/)).toBeTruthy();
  });

  it('renders a not-found state on 404', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('nf', 404, {}));
    renderAt('/meetings/zzz');
    expect(await screen.findByText(/not found|isn.t available|no longer/i)).toBeTruthy();
  });
});

describe('MeetingFlagsPage', () => {
  it('puts a deep-linked flag first and dismisses through the API', async () => {
    const calls: string[] = [];
    routeApi({
      'GET /api/meeting-intel/flags?status=': () => ({ items: [flag('f1'), flag('f2')] }),
      'POST /api/meeting-intel/flags/f2/dismiss': () => { calls.push('dismiss f2'); return undefined; },
    });
    renderAt('/meeting-intel/flags/f2');
    await screen.findByText('Reason f2');
    const cards = screen.getAllByTestId('meeting-flag');
    expect(cards[0]!.id).toBe('flag-f2');
    fireEvent.click(within(cards[0]!).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(calls).toEqual(['dismiss f2']));
    expect(within(cards[0]!).getByRole('link', { name: 'Open meeting at CI Financial Europe' }).getAttribute('href')).toBe('/meetings/m1?flag=f2');
  });

  it('a flag recipient opens the meeting through the flag; a restricted account stays redacted', async () => {
    const seen: string[] = [];
    routeApi({
      'GET /api/meeting-intel/flags/f1/meeting': () => { seen.push('flag'); return { ...meeting, visibility: 'account_team', access: 'flag', flagId: 'f1', companyRestricted: false }; },
      'GET /api/meeting-intel/flags/f9/meeting': () => ({
        ...meeting, visibility: 'account_team', access: 'flag', flagId: 'f9', companyRestricted: true, companyId: null,
        companyName: 'Restricted account', title: 'Meeting at a restricted account', summary: null, transcript: null,
        attendees: meeting.attendees.map((a) => ({ ...a, name: a.isInternal ? 'Colleague' : 'Restricted contact', contactId: null, reportsToContactId: null })),
      }),
    });
    renderAt('/meetings/m1?flag=f1');
    await screen.findByRole('heading', { name: 'Cloud cost review with the CIO' });
    expect(seen).toEqual(['flag']);
    expect(screen.getByTestId('meeting-flag-access')).toBeTruthy();
    expect(screen.getByText('CIO wants to cut cloud spend.')).toBeTruthy();
    // Read-only through a flag: no visibility toggle.
    expect(screen.queryByRole('button', { name: /Share with organisation|Limit to account team/ })).toBeNull();
    cleanup();
    renderAt('/meetings/m1?flag=f9');
    await screen.findByRole('heading', { name: 'Meeting at a restricted account' });
    expect(screen.getByText(/outside your access/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Restricted account' })).toBeNull();
    expect(screen.queryByText('Michael Johnson')).toBeNull();
  });
});

describe('MeetingSourcesSection', () => {
  it('needs consent, shows the Métis token once, and can trigger an ABC sync', async () => {
    const bodies: unknown[] = [];
    routeApi({
      'GET /api/meeting-intel/sources': () => ({ items: [
        { source: 'metis', scope: 'user', status: 'not_connected', shareSummary: false, shareTranscript: false, tokenPrefix: null, lastSyncAt: null, lastError: null, itemsReceived: 0, pending: 0, unmatched: 0 },
        { source: 'abc', scope: 'org', status: 'not_configured', shareSummary: true, shareTranscript: false, tokenPrefix: null, lastSyncAt: null, lastError: null, itemsReceived: 0, pending: 0, unmatched: 0 },
      ] }),
      'POST /api/meeting-intel/sources/metis/connect': (init) => { bodies.push(init?.body); return { token: 'pmi_test_only_token', tokenPrefix: 'pmi_test', shareSummary: true, shareTranscript: false }; },
      'POST /api/meeting-intel/sources/abc/sync': () => ({ connectionId: 'c', queued: true }),
    });
    renderAt('/settings', <MeetingSourcesSection />);
    const connect = await screen.findByRole('button', { name: 'Connect Métis' });
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: /full transcripts/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to share/ }));
    fireEvent.click(connect);
    const shown = await screen.findByTestId('metis-token');
    expect(within(shown).getByText('pmi_test_only_token')).toBeTruthy();
    expect(bodies).toEqual([{ shareSummary: true, shareTranscript: false }]);
    fireEvent.click(within(shown).getByRole('button', { name: 'I have saved it' }));
    await waitFor(() => expect(screen.queryByText('pmi_test_only_token')).toBeNull());
    fireEvent.click(screen.getByTestId('abc-sync'));
    expect(await screen.findByText(/Sync queued/)).toBeTruthy();
  });
});
