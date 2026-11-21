import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The API status is not_configured in every case. Sample figures are legal
// only when the server-resolved data mode is demo.
const resolved = vi.hoisted(() => ({ dataMode: 'demo' as 'demo' | 'real' }));

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  api: vi.fn(async () => ({ companyId: 'acct-1', status: 'not_configured', stale: false, providers: {}, provenance: {} })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: true }),
}));
vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloMe: () => ({
    data: { dataMode: resolved.dataMode },
    isLoading: false,
    isFetched: true,
    isError: false,
  }),
}));

import { mockEnrichment } from '@/lib/enrichment/mock';

import { FirmographicsStrip } from './FirmographicsStrip';
import { HiringNowCard } from './HiringNowCard';
import { PotentialProjectsCard } from './PotentialProjectsCard';

function wrap(ui: ReactNode, path = '/accounts/acct-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);
}

describe('enrichment cards', () => {
  beforeEach(() => {
    resolved.dataMode = 'demo';
  });
  afterEach(cleanup);
  it('firmographics strip shows four facts, each with source and date, labelled Sample', async () => {
    wrap(<FirmographicsStrip companyId="acct-1" />);
    const strip = await screen.findByTestId('account-firmographics');
    for (const t of ['Revenue', 'Headcount', 'Industry', 'Locations']) expect(within(strip).getByText(t)).toBeTruthy();
    expect(strip.querySelectorAll('.en-src time').length).toBe(4);
    expect(within(strip).getByText('Sample')).toBeTruthy();
    expect(within(strip).getByText(/not configured/)).toBeTruthy();
    // No provider: nothing to refresh.
    expect(within(strip).queryByTestId('enrichment-refresh')).toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: /more/ }));
    expect(within(strip).getByText(/London, United Kingdom/)).toBeTruthy();
  });
  it('hiring now drills into function / seniority / region breakdowns and postings', async () => {
    wrap(<HiringNowCard companyId="acct-1" />);
    const card = await screen.findByTestId('account-hiring-now');
    const total = mockEnrichment('acct-1').hiring.total;
    expect(within(card).getByText(String(total))).toBeTruthy();
    fireEvent.click(within(card).getByTestId('hiring-breakdown'));
    const drill = within(card).getByTestId('hiring-drill');
    fireEvent.click(within(drill).getByRole('tab', { name: 'Region' }));
    expect(within(drill).getByRole('tab', { name: 'Region' }).getAttribute('aria-selected')).toBe('true');
    expect(within(drill).getByRole('list', { name: 'Open roles by region' })).toBeTruthy();
    expect(drill.querySelectorAll('.en-list > li').length).toBe(6);
  });
  it('potential projects show confidence and expand to evidence postings; a hash deep link opens one', async () => {
    const e = mockEnrichment('acct-1');
    const p = e.projects[0]!;
    wrap(<PotentialProjectsCard companyId="acct-1" />, `/accounts/acct-1#enrichment-project-${p.id}`);
    const card = await screen.findByTestId('account-potential-projects');
    expect(within(card).getAllByText(/confidence ·/).length).toBe(e.projects.length);
    const btn = within(card).getByRole('button', { name: new RegExp(p.title) });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(card).getByText('Evidence postings')).toBeTruthy();
    fireEvent.click(btn);
    expect(within(card).queryByText('Evidence postings')).toBeNull();
  });

  it('real plus not_configured shows no sample', async () => {
    resolved.dataMode = 'real';
    wrap(
      <>
        <FirmographicsStrip companyId="acct-1" />
        <HiringNowCard companyId="acct-1" />
        <PotentialProjectsCard companyId="acct-1" />
      </>,
    );
    const strip = await screen.findByTestId('account-firmographics');
    expect(within(strip).queryByText('Sample')).toBeNull();
    expect(within(strip).getByText('Not connected')).toBeTruthy();
    expect(within(strip).queryByText('Toronto (HQ)')).toBeNull();
    expect(within(strip).queryByText('Asset & wealth management')).toBeNull();
    const hiring = await screen.findByTestId('account-hiring-now');
    expect(within(hiring).queryByText('Sample')).toBeNull();
    expect(within(hiring).getByText('No open roles found.')).toBeTruthy();
    expect(within(hiring).queryByText(String(mockEnrichment('acct-1').hiring.total))).toBeNull();
    const projects = await screen.findByTestId('account-potential-projects');
    expect(within(projects).queryByText('Sample')).toBeNull();
    expect(within(projects).getByText('No initiatives inferred from current hiring.')).toBeTruthy();
    expect(within(projects).queryByText(/confidence ·/)).toBeNull();
  });

  it('demo plus not_configured shows the labelled sample', async () => {
    resolved.dataMode = 'demo';
    wrap(<FirmographicsStrip companyId="acct-1" />);
    const strip = await screen.findByTestId('account-firmographics');
    expect(within(strip).getByText('Sample')).toBeTruthy();
    expect(within(strip).getByText(/not configured/)).toBeTruthy();
    expect(within(strip).getByText('Toronto (HQ)')).toBeTruthy();
    expect(within(strip).getByText('Asset & wealth management')).toBeTruthy();
    expect(within(strip).queryByText('Not connected')).toBeNull();
  });
});
