import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { mockEnrichment } from '@/lib/enrichment/mock';

import { FirmographicsStrip } from './FirmographicsStrip';
import { HiringNowCard } from './HiringNowCard';
import { PotentialProjectsCard } from './PotentialProjectsCard';

function wrap(ui: ReactNode, path = '/accounts/acct-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);
}

describe('enrichment cards', () => {
  afterEach(cleanup);
  it('firmographics strip shows four facts, each with source and date, labelled Sample', async () => {
    wrap(<FirmographicsStrip companyId="acct-1" />);
    const strip = await screen.findByTestId('account-firmographics');
    for (const t of ['Revenue', 'Headcount', 'Industry', 'Locations']) expect(within(strip).getByText(t)).toBeTruthy();
    expect(strip.querySelectorAll('.en-src time').length).toBe(4);
    expect(within(strip).getByText('Sample')).toBeTruthy();
    fireEvent.click(within(strip).getByRole('button', { name: /more/ }));
    expect(within(strip).getByText(/London, United Kingdom/)).toBeTruthy();
  });
  it('hiring now drills into function / seniority / region breakdowns and postings', async () => {
    wrap(<HiringNowCard companyId="acct-1" />);
    const card = await screen.findByTestId('account-hiring-now');
    const total = mockEnrichment('acct-1').hiring.roles.length;
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
});
