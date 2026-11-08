import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConsultingPartnerCard, ConsultingPartnersSummary, PartnerEvidence } from '@bidstack/shared';

const none = (dimension: ConsultingPartnerCard['scorecard'][number]['dimension']) => ({ dimension, status: 'no_evidence' as const, us: null, partner: null, evidenceCount: 0, evidenceIds: [] });

const kpmg: ConsultingPartnerCard = {
  firmKey: 'kpmg', name: 'KPMG', monogram: 'KP', website: 'https://kpmg.com', relationships: ['advisory', 'audit'], domains: ['digital', 'data'],
  firstSeen: '2025-03-01T00:00:00Z', lastSeen: '2026-10-20T00:00:00Z', strength: { level: 'strong', score: 3.4, evidenceCount: 5 },
  publicCount: 3, internalCount: 2, record: { wins: 3, losses: 1, firstYear: 2025, lastYear: 2025 },
  scorecard: [
    { dimension: 'quality', status: 'scored', us: 100, partner: 0, evidenceCount: 2, evidenceIds: ['e1', 'e2'] },
    { dimension: 'price', status: 'scored', us: 33, partner: 67, evidenceCount: 3, evidenceIds: ['e3'] },
    { dimension: 'speed', status: 'scored', us: 60, partner: 40, evidenceCount: 1, evidenceIds: ['e4'] },
    none('domain'),
    { dimension: 'relationship', status: 'scored', us: 75, partner: 25, evidenceCount: 3, evidenceIds: ['p1'] },
  ],
  angles: [
    { text: 'KPMG at MAPFRE: advisory and audit in Digital, 3 public sources since 2025.', basis: 'observed', evidenceIds: ['p1'] },
    { text: '3 wins vs 1 loss against KPMG in 2025.', basis: 'observed', evidenceIds: ['e1'] },
  ],
  timeline: [
    { id: 'p1', date: '2026-10-20T00:00:00Z', origin: 'public', source: 'google_news', label: 'MAPFRE selects KPMG' },
    { id: 'e1', date: '2025-06-01T00:00:00Z', origin: 'internal', source: 'win_loss', label: 'Won vs KPMG' },
  ],
  sample: false,
};
const accenture: ConsultingPartnerCard = {
  ...kpmg, firmKey: 'accenture', name: 'Accenture', monogram: 'AC', relationships: ['implementation'], domains: ['it', 'cloud'],
  strength: { level: 'medium', score: 1.6, evidenceCount: 2 }, record: { wins: 0, losses: 0, firstYear: null, lastYear: null },
  scorecard: [none('quality'), none('price'), none('speed'), none('domain'), none('relationship')], angles: [],
};

const summary: ConsultingPartnersSummary = {
  companyId: 'c1', partners: [kpmg, accenture], sample: false,
  run: { status: 'partial', lastFetchedAt: '2026-11-05T10:00:00Z', result: { new: 4, updated: 0, skipped: 2, failed: 1 }, detail: 'api.gdeltproject.org answered 429' },
};

const ev: PartnerEvidence = {
  id: 'p1', firmKey: 'kpmg', firmName: 'KPMG', origin: 'public', source: 'google_news', sourceLabel: 'Google News', method: 'keyword_match', inferred: false,
  url: 'javascript:alert(1)', recordType: null, recordId: null, recordHref: null, title: 'MAPFRE selects KPMG', excerpt: 'MAPFRE selects KPMG for finance advisory.',
  date: '2026-10-20T00:00:00Z', fetchedAt: '2026-11-05T10:00:00Z', relationship: 'advisory', domains: [], context: null, sentiment: null, remarks: [], outcome: null, sample: false,
};

const refresh = vi.fn();
const state: { data: ConsultingPartnersSummary | undefined; isLoading: boolean; canWrite: boolean } = { data: summary, isLoading: false, canWrite: true };
vi.mock('@/hooks/useConsultingPartners', () => ({
  useConsultingPartners: () => ({ data: state.data, isLoading: state.isLoading, isError: false }),
  usePartnerEvidence: (_c: string, _f: string, enabled: boolean) => ({ data: enabled ? { pages: [{ firmKey: 'kpmg', items: [ev], nextCursor: '1' }] } : undefined, isLoading: false, isError: false, hasNextPage: true, fetchNextPage: vi.fn(), isFetchingNextPage: false }),
  useRefreshConsultingPartners: () => ({ mutate: refresh, isPending: false, pollUntil: undefined }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => state.canWrite }));
vi.mock('@/components/charts/PolarCharts', () => ({ RadarChart: (p: { keys: string[]; 'aria-label': string }) => <div role="img" aria-label={p['aria-label']}>{p.keys.join(',')}</div> }));

import { ConsultingPartnersSection } from './ConsultingPartnersSection';

const view = () => render(<MemoryRouter><ConsultingPartnersSection companyId="c1" /></MemoryRouter>);

describe('ConsultingPartnersSection', () => {
  afterEach(() => {
    cleanup();
    refresh.mockReset();
    Object.assign(state, { data: summary, isLoading: false, canWrite: true });
  });

  it('renders a skeleton first while the summary loads', () => {
    Object.assign(state, { data: undefined, isLoading: true });
    view();
    expect(screen.getByTestId('partners-skeleton').getAttribute('aria-busy')).toBe('true');
  });

  it('shows partner tiles with monogram, relationship tags and domain chips', () => {
    view();
    const tile = screen.getByTestId('partner-kpmg');
    expect(tile.getAttribute('aria-selected')).toBe('true');
    expect(within(tile).getByText('KP')).toBeTruthy();
    expect(within(tile).getByText('Advisory')).toBeTruthy();
    expect(within(tile).getByText('Audit')).toBeTruthy();
    expect(within(tile).getByText('Digital')).toBeTruthy();
    expect(within(screen.getByTestId('partner-accenture')).getByText('Implementation')).toBeTruthy();
  });

  it('shows the score card with evidence counts and No evidence instead of a guess', async () => {
    view();
    expect(within(screen.getByTestId('score-quality')).getByText('100')).toBeTruthy();
    const domain = screen.getByTestId('score-domain');
    expect(domain.getAttribute('data-status')).toBe('no_evidence');
    expect(within(domain).getByText('No evidence')).toBeTruthy();
    expect(within(screen.getByTestId('score-price')).getByText('3')).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'Us vs KPMG radar' })).toBeTruthy();
  });

  it('lists cited angles and the record, and switches partner with the keyboard', () => {
    view();
    const angles = screen.getByTestId('partner-angles');
    expect(within(angles).getByText('3 wins vs 1 loss against KPMG in 2025.')).toBeTruthy();
    expect(screen.getByTestId('partner-timeline').querySelectorAll('li')).toHaveLength(2);
    fireEvent.keyDown(screen.getByTestId('partner-kpmg'), { key: 'ArrowRight' });
    expect(screen.getByTestId('partner-accenture').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('partner-radar')).toBeNull();
    expect(screen.getAllByText('No evidence').length).toBeGreaterThan(1);
  });

  it('opens paged evidence and never renders an unsafe link', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: /Evidence/ }));
    const list = screen.getByTestId('partner-evidence');
    expect(within(list).getByText('MAPFRE selects KPMG for finance advisory.')).toBeTruthy();
    expect(within(list).queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('shows run status with last fetched time and refreshes for writers only', () => {
    view();
    const run = screen.getByTestId('partners-run');
    expect(run.textContent).toMatch(/Partial/);
    expect(run.textContent).toMatch(/5 Nov 2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh consulting partners' }));
    expect(refresh).toHaveBeenCalled();
    cleanup();
    state.canWrite = false;
    view();
    expect(screen.queryByRole('button', { name: 'Refresh consulting partners' })).toBeNull();
  });

  it('shows the empty line and the Sample tag', () => {
    state.data = { ...summary, partners: [] };
    view();
    expect(screen.getByTestId('partners-empty').textContent).toBe('No consulting partners found');
    cleanup();
    state.data = { ...summary, sample: true };
    view();
    expect(screen.getByText('Sample')).toBeTruthy();
  });
});
