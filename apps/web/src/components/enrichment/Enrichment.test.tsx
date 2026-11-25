import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// No provider configured locally: the API says so, and the cards show Sample data.
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  api: vi.fn(async () => ({ companyId: 'acct-1', status: 'not_configured', stale: false, providers: {}, provenance: {} })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { ApiError, api } from '@/lib/api';
import { mockEnrichment } from '@/lib/enrichment/mock';

import { FirmographicsStrip } from './FirmographicsStrip';
import { HiringNowCard } from './HiringNowCard';
import { PotentialProjectsCard } from './PotentialProjectsCard';

function wrap(ui: ReactNode, path = '/accounts/acct-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);
}

const sampleEnrichment = async () => ({
  companyId: 'acct-1',
  status: 'not_configured',
  stale: false,
  providers: {},
  provenance: {},
});

describe('enrichment cards', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(sampleEnrichment);
  });
  it('firmographics strip shows four facts, each with source and date, labelled Sample', async () => {
    wrap(<FirmographicsStrip companyId="acct-1" />);
    await screen.findByText('Revenue');
    const strip = screen.getByTestId('account-firmographics');
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
    const total = mockEnrichment('acct-1').hiring.total;
    await screen.findByText(String(total));
    const card = screen.getByTestId('account-hiring-now');
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
    await screen.findAllByText(/confidence ·/);
    const card = screen.getByTestId('account-potential-projects');
    expect(within(card).getAllByText(/confidence ·/).length).toBe(e.projects.length);
    const btn = within(card).getByRole('button', { name: new RegExp(p.title) });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(card).getByText('Evidence postings')).toBeTruthy();
    fireEvent.click(btn);
    expect(within(card).queryByText('Evidence postings')).toBeNull();
  });

  it('holds the three enrichment cards until the read settles', () => {
    vi.mocked(api).mockImplementation(() => new Promise(() => {}));
    wrap(<HiringNowCard companyId="acct-1" />);
    const hiring = screen.getByTestId('account-hiring-now');
    expect(hiring.getAttribute('aria-busy')).toBe('true');
    expect(within(hiring).getByText('Loading open roles')).toBeTruthy();
    expect(within(hiring).queryByText('No open roles found.')).toBeNull();
    cleanup();

    wrap(<PotentialProjectsCard companyId="acct-1" />);
    const projects = screen.getByTestId('account-potential-projects');
    expect(projects.getAttribute('aria-busy')).toBe('true');
    expect(within(projects).getByText('Loading potential projects')).toBeTruthy();
    expect(within(projects).queryByText('No initiatives inferred from current hiring.')).toBeNull();
    cleanup();

    wrap(<FirmographicsStrip companyId="acct-1" />);
    const facts = screen.getByTestId('account-firmographics');
    expect(facts.getAttribute('aria-busy')).toBe('true');
    expect(within(facts).getByText('Loading company facts')).toBeTruthy();
    expect(within(facts).queryByText('Revenue')).toBeNull();
  });

  it('shows a retry when the enrichment read fails instead of an empty account', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('missing', 404, {}));
    wrap(<HiringNowCard companyId="acct-1" />);
    expect(await screen.findByText("Couldn't load open roles")).toBeTruthy();
    const hiring = screen.getByTestId('account-hiring-now');
    expect(within(hiring).getByText('Please try again.')).toBeTruthy();
    expect(within(hiring).queryByText('No open roles found.')).toBeNull();
    expect(hiring.getAttribute('aria-busy')).toBeNull();
    const before = vi.mocked(api).mock.calls.length;
    fireEvent.click(within(hiring).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(before));
    cleanup();

    wrap(<PotentialProjectsCard companyId="acct-1" />);
    expect(await screen.findByText("Couldn't load potential projects")).toBeTruthy();
    expect(screen.queryByText('No initiatives inferred from current hiring.')).toBeNull();
    cleanup();

    wrap(<FirmographicsStrip companyId="acct-1" />);
    expect(await screen.findByText("Couldn't load company facts")).toBeTruthy();
    expect(screen.queryByText('Revenue')).toBeNull();
  });
});
