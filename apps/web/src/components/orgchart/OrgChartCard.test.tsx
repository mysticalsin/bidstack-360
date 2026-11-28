import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { NodeCov, OrgChart, OrgNode } from '@/lib/orgchart/types';

const state = vi.hoisted(() => ({
  chart: null as OrgChart | null,
  isLoading: false,
  error: null as Error | null,
  unmetSenior: new Set<string>(),
  live: true,
}));

vi.mock('@/hooks/useOrgChart', () => ({
  useOrgChart: () => ({
    chart: state.chart,
    covOf: (n: OrgNode): NodeCov => ({
      met: n.id === 'root',
      count: n.id === 'root' ? 2 : 0,
      lastMetAt: n.id === 'root' ? '2026-10-01T00:00:00Z' : null,
      meetings: [],
      challenges: [],
      owners: [],
      manual: null,
    }),
    unmetSenior: state.unmetSenior,
    live: state.live,
    isLoading: state.isLoading,
    error: state.error,
  }),
}));

import { OrgChartCard } from './OrgChartCard';

const person = (id: string, parentId: string | null, name: string, title: string): OrgNode => ({
  id, parentId, name, title, photoUrl: null, seniority: id === 'root' ? 'c_level' : 'director', region: null,
  contactId: null, email: null, ownerName: null, source: 'manual',
});

function chart(nodes: OrgNode[], rootId: string | null): OrgChart {
  return { companyId: 'co', rootId, version: 1, updatedAt: '2026-11-01T00:00:00Z', updatedBy: null, sample: false, nodes };
}

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OrgChartCard companyId="co" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.chart = null;
  state.isLoading = false;
  state.error = null;
  state.live = true;
  state.unmetSenior = new Set();
});

describe('OrgChartCard', () => {
  // WHY: a row of faces does not say who reports to whom. The preview has to
  // be a tree: the top role, then a connected level of direct reports.
  it('draws the top role above connected direct reports', () => {
    state.chart = chart([
      person('root', null, 'Ana Silva', 'Chief Executive Officer'),
      person('a', 'root', 'Bruno Costa', 'Director of Operations'),
      person('b', 'root', 'Hana Park', 'Director of Supply'),
    ], 'root');

    renderCard();

    const tree = screen.getByRole('list', { name: /Top of the chart: Ana Silva and 2 direct reports/ });
    const reports = within(tree).getByRole('list');
    expect(within(reports).getByText('Bruno Costa')).toBeTruthy();
    expect(within(reports).getByText('Director of Operations')).toBeTruthy();
    expect(within(reports).getByText('Hana Park')).toBeTruthy();
    expect(tree.querySelectorAll('ul').length).toBe(1);
  });

  // WHY: a level with dozens of reports must not blow out the account card.
  // The preview keeps a cap and names the rest.
  it('caps a wide level and names how many reports are off the preview', () => {
    const nodes = [person('root', null, 'Ana Silva', 'Chief Executive Officer')];
    for (let i = 0; i < 10; i += 1) nodes.push(person(`r${i}`, 'root', `Report ${i}`, 'Director'));
    state.chart = chart(nodes, 'root');

    renderCard();

    expect(screen.getByText('Report 0')).toBeTruthy();
    expect(screen.queryByText('Report 8')).toBeNull();
    expect(screen.getByText('+2').getAttribute('title')).toMatch(/2 more direct reports/);
    expect(screen.getByTestId('account-orgchart-card').querySelector('.oc-card-scroll')).toBeTruthy();
  });

  it('shows an empty state when nobody is on the chart', () => {
    state.chart = chart([], null);
    renderCard();
    expect(screen.getByTestId('orgchart-empty').textContent).toMatch(/No people on this chart yet/);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows a loading tree instead of a blank card', () => {
    state.isLoading = true;
    state.chart = null;
    renderCard();
    const status = screen.getByTestId('orgchart-loading');
    expect(status.textContent).toMatch(/Loading/);
    expect(status.querySelectorAll('.oc-skel').length).toBeGreaterThan(1);
  });
});
