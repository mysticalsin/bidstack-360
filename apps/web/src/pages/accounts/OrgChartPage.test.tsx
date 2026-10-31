import type * as ApiModule from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: vi.fn() };
});
const perm = vi.hoisted(() => ({ write: true }));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn((k: string) => (k === 'orgchart:write' ? perm.write : true)) }));
vi.mock('@/lib/auth', () => ({ useUser: () => ({ user: { fullName: 'Jane Smith' } }) }));

import { ApiError, api } from '@/lib/api';

import OrgChartPage from './OrgChartPage';

const CI = 'c0000000-0000-4000-8000-000000000001';
const att = (id: string, name: string, title: string, seniority: string, internal = false) => ({
  id, name, email: null, title, seniority, region: 'CA', businessUnit: null, isInternal: internal, contactId: internal ? null : `k-${id}`, reportsToContactId: null,
});
const meeting = {
  id: 'm1', companyId: CI, companyName: 'CI Financial', title: 'Cloud cost review with the CIO', heldAt: '2026-10-25T10:00:00Z',
  visibility: 'org', sources: ['manual'], attendeeCount: 3, topSeniority: 'c_level', challenges: ['Cloud cost overruns'], nextSteps: [],
  summary: '', transcript: null, similarProjects: [], opportunities: [], createdAt: '2026-10-25T12:00:00Z', sourceLinks: [],
  attendees: [att('1', 'Michael Johnson', 'Chief Information Officer', 'c_level'), att('2', 'Sarah Patel', 'IT Security Manager', 'manager'), att('3', 'Jane Smith', '', 'unknown', true)],
};

beforeAll(() => {
  // React Flow measures nodes; happy-dom has no layout.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
beforeEach(() => {
  localStorage.clear();
  perm.write = true;
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith(`/api/companies/${CI}`)) return { id: CI, name: 'CI Financial' } as never;
    if (path.startsWith('/api/meeting-intel?')) return { items: [{ id: 'm1', heldAt: meeting.heldAt }], nextCursor: null } as never;
    if (path.startsWith('/api/meeting-intel/m1')) return meeting as never;
    if (path.startsWith('/api/contacts')) return { items: [{ id: 'k-9', name: 'Nora Lee', role: 'VP Cloud Platforms', email: null, companyId: CI, customer: 'CI Financial' }] } as never;
    throw new ApiError(`no route ${path}`, 404, {});
  });
});
afterEach(cleanup);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/accounts/${CI}/org-chart`]}>
        <Routes><Route path="/accounts/:accountId/org-chart" element={<OrgChartPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const node = async (name: string) => (await screen.findAllByTestId('orgchart-node')).find((n) => n.dataset.name === name)!;

describe('OrgChartPage', () => {
  it('builds a labelled Sample with real met people and shows their meetings, challenges and owner', async () => {
    renderPage();
    expect(await screen.findByText('Sample')).toBeTruthy();
    const mj = await node('Michael Johnson');
    expect(mj.dataset.met).toBe('true');
    expect((await node('Alex Morgan')).dataset.dim).toBe('true'); // placeholder, not met
    fireEvent.click(mj);
    const panel = await screen.findByTestId('orgchart-panel');
    expect(within(panel).getByText('Cloud cost review with the CIO')).toBeTruthy();
    expect(within(panel).getByText('Cloud cost overruns')).toBeTruthy();
    expect(within(panel).getByText('Jane Smith')).toBeTruthy();
  });

  it('is read-only without orgchart:write', async () => {
    perm.write = false;
    renderPage();
    expect(await screen.findByTestId('orgchart-readonly')).toBeTruthy();
    expect(screen.queryByTestId('orgchart-edit')).toBeNull();
    fireEvent.click(await node('Michael Johnson'));
    expect(within(await screen.findByTestId('orgchart-panel')).queryByTestId('orgchart-add')).toBeNull();
  });

  it('search dims non-matches', async () => {
    renderPage();
    await node('Michael Johnson');
    fireEvent.change(screen.getByTestId('orgchart-search'), { target: { value: 'patel' } });
    expect((await node('Sarah Patel')).dataset.hit).toBe('true');
    expect((await node('Michael Johnson')).dataset.dim).toBe('true');
  });

  it('edit: add a report, re-parent via keyboard select, auto-fill, save; conflict toast when someone saved first', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('orgchart-edit'));
    fireEvent.click(await node('Sarah Patel'));
    const panel = await screen.findByTestId('orgchart-panel');
    fireEvent.change(within(panel).getByTestId('orgchart-reports-to'), { target: { value: (await screen.findAllByTestId('orgchart-node')).find((n) => n.dataset.name === 'Alex Morgan')!.closest<HTMLElement>('.react-flow__node')!.dataset.id } });
    expect(within(panel).getByText('Alex Morgan', { selector: 'dd' })).toBeTruthy();
    fireEvent.click(within(panel).getByTestId('orgchart-add'));
    expect(await node('New person')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId('orgchart-autofill')); });
    expect(await node('Nora Lee')).toBeTruthy();
    // Someone else saves first.
    localStorage.setItem(`polo:orgchart:v1:${CI}`, JSON.stringify({ companyId: CI, rootId: null, version: 3, updatedAt: '2026-10-31T21:00:00Z', updatedBy: 'Mark Thompson', sample: false, nodes: [] }));
    await act(async () => { fireEvent.click(screen.getByTestId('orgchart-save')); });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Mark Thompson/);
    await act(async () => { fireEvent.click(within(screen.getByRole('alert')).getByText('Overwrite with mine')); });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`polo:orgchart:v1:${CI}`)!).version).toBe(4));
  });

  it('keyboard: arrows move between people and Enter opens the panel', async () => {
    renderPage();
    const ceo = (await node('Alex Morgan')).closest<HTMLElement>('.react-flow__node')!;
    ceo.focus();
    fireEvent.keyDown(ceo, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.querySelector('[data-testid="orgchart-node"]')).toBeTruthy());
    const first = document.activeElement as HTMLElement;
    expect(first).not.toBe(ceo);
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(await screen.findByTestId('orgchart-panel')).toBeTruthy();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(ceo));
  });
});
