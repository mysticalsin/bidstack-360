import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The API says enrichment is not configured. The cards must not invent a revenue.
const { AS_OF, ROLES } = vi.hoisted(() => {
  const AS_OF = '2026-10-30';
  const ROLES = Array.from({ length: 6 }, (_, i) => ({
    id: `r${i}`,
    source: 'fixture',
    title: `Sample role ${i}`,
    url: null,
    city: 'Oslo',
    country: 'NO',
    region: 'EMEA',
    function: 'data',
    seniority: 'senior',
    skills: [] as string[],
    postedAt: AS_OF,
  }));
  return { AS_OF, ROLES };
});
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string) => {
    if (path.includes('/hiring')) {
      return {
        companyId: 'acct-1',
        fetchedAt: AS_OF,
        postingsTotal: ROLES.length,
        postings: ROLES,
        hiring: {
          total: ROLES.length,
          byFunction: [{ key: 'data', count: ROLES.length }],
          bySeniority: [{ key: 'senior', count: ROLES.length }],
          byRegion: [{ key: 'EMEA', count: ROLES.length }],
          topSkills: [],
          clusters: [],
        },
      };
    }
    if (path.includes('/projects')) {
      return {
        companyId: 'acct-1',
        fetchedAt: AS_OF,
        projects: [
          {
            id: 'cloud',
            kind: 'cloud',
            name: 'Core platform move to cloud',
            rationale: 'Synthetic fixture for the card, not a fetched filing.',
            confidence: 'high',
            region: 'EMEA',
            postingCount: 1,
            seniorCount: 0,
            skills: [],
            evidence: [{ postingId: 'r0', title: 'Sample role 0', url: null, region: 'EMEA', seniority: 'senior', postedAt: AS_OF, source: 'fixture' }],
            method: 'rules',
          },
        ],
      };
    }
    return {
      companyId: 'acct-1',
      status: 'not_configured',
      stale: false,
      fetchedAt: null,
      expiresAt: null,
      annualRevenueUsd: null,
      revenueRange: null,
      employeeCount: null,
      employeeRange: null,
      headcountGrowth6m: null,
      headcountGrowth12m: null,
      headcountGrowth24m: null,
      industry: null,
      industries: [],
      locations: [],
      techStack: [],
      departmentHeadcount: null,
      openJobs: 0,
      provenance: {},
      providers: {},
    };
  }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

import { FirmographicsStrip } from './FirmographicsStrip';
import { HiringNowCard } from './HiringNowCard';
import { PotentialProjectsCard } from './PotentialProjectsCard';

function wrap(ui: ReactNode, path = '/accounts/acct-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);
}

describe('enrichment cards', () => {
  afterEach(cleanup);
  it('firmographics strip stays empty when enrichment is not configured', async () => {
    // WHY: a missing provider used to be replaced with an invented CAD revenue.
    wrap(<FirmographicsStrip companyId="acct-1" />);
    const strip = await screen.findByTestId('account-firmographics');
    for (const t of ['Revenue', 'Headcount', 'Industry', 'Locations']) expect(within(strip).getByText(t)).toBeTruthy();
    expect(strip.textContent).not.toMatch(/CAD/);
    expect(within(strip).queryByText('Sample')).toBeNull();
    expect(within(strip).getByText(/not configured/)).toBeTruthy();
    expect(within(strip).queryByTestId('enrichment-refresh')).toBeNull();
    expect(within(strip).queryByText(/London, United Kingdom/)).toBeNull();
  });
  it('hiring now drills into function / seniority / region breakdowns and postings', async () => {
    wrap(<HiringNowCard companyId="acct-1" />);
    const card = await screen.findByTestId('account-hiring-now');
    expect(card.querySelector('.en-big')?.textContent).toBe(String(ROLES.length));
    fireEvent.click(within(card).getByTestId('hiring-breakdown'));
    const drill = within(card).getByTestId('hiring-drill');
    fireEvent.click(within(drill).getByRole('tab', { name: 'Region' }));
    expect(within(drill).getByRole('tab', { name: 'Region' }).getAttribute('aria-selected')).toBe('true');
    expect(within(drill).getByRole('list', { name: 'Open roles by region' })).toBeTruthy();
    expect(drill.querySelectorAll('.en-list > li').length).toBe(6);
  });
  it('potential projects show confidence and expand to evidence postings; a hash deep link opens one', async () => {
    wrap(<PotentialProjectsCard companyId="acct-1" />, '/accounts/acct-1#enrichment-project-cloud');
    const card = await screen.findByTestId('account-potential-projects');
    expect(within(card).getAllByText(/confidence/).length).toBeGreaterThan(0);
    const btn = within(card).getByRole('button', { name: /Core platform move to cloud/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(card).getByText('Evidence postings')).toBeTruthy();
    fireEvent.click(btn);
    expect(within(card).queryByText('Evidence postings')).toBeNull();
  });
});
