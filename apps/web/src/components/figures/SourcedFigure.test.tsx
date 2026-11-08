import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountFinancialsIntel, AccountKeyNumbers, KeyNumber } from '@bidstack/shared';

const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
const state: { kn: AccountKeyNumbers | null } = { kn: null };
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body });
    if (path.endsWith('/key-numbers')) return state.kn;
    return {};
  }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));
vi.mock('@/hooks/useFormatMoney', () => ({ useFormatMoney: () => ({ formatMoneyMicros: (m: number) => `EUR ${m / 1e6}` }) }));

import { FinancialsPanel } from '@/components/company-intel/IntelPanels';
import { KeyNumbersStrip } from '@/components/positioning/KeyNumbersStrip';

import { FigureActions, SourceChip } from './SourcedFigure';

const ID = '6f1c2a3b-4d5e-4f60-8a1b-2c3d4e5f6a7b';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const kn = (over: Partial<KeyNumber>): KeyNumber => ({
  id: 'x', group: 'company', label: 'X', value: null, unit: 'count', currency: null, delta: null, deltaUnit: null, goodWhen: 'up',
  series: [], sub: null, source: 'Src', period: 'Per', sourceUrl: null, anchor: null, missing: null, sample: false, ...over,
});

beforeEach(() => {
  calls.length = 0;
});
afterEach(cleanup);

describe('SourceChip', () => {
  it('links an http source and names label and year', () => {
    render(<SourceChip p={{ origin: 'wikidata', label: 'Wikidata', year: '2024', url: 'https://www.wikidata.org/wiki/Q1#P2123' }} testId="c" />);
    const chip = screen.getByTestId('c');
    expect(chip.tagName).toBe('A');
    expect(chip.textContent).toBe('Wikidata · 2024');
    expect(chip.getAttribute('rel')).toBe('noopener noreferrer');
    expect(chip.getAttribute('title')).toContain('https://www.wikidata.org/wiki/Q1#P2123');
  });

  it('marks a CRM figure as unverified in the chip text and the title', () => {
    render(<SourceChip p={{ origin: 'crm', label: 'CRM record', year: null, url: null, unverified: true }} testId="c" />);
    const chip = screen.getByTestId('c');
    expect(chip.textContent).toBe('CRM record · unverified');
    expect(chip.getAttribute('data-unverified')).toBe('true');
    expect(chip.getAttribute('title')).toContain('Not checked against a public source');
  });

  it('renders plain text for a missing or unsafe URL', () => {
    render(<SourceChip p={{ origin: 'manual_sourced', label: 'Annual report', year: null, url: 'javascript:alert(1)' }} testId="c" />);
    expect(screen.getByTestId('c').tagName).toBe('SPAN');
  });
});

describe('FigureActions', () => {
  it('empty state names what is missing and refreshes every public source', async () => {
    wrap(<FigureActions companyId={ID} companyName="Acme" fieldKey="annualRevenueMicros" label="Revenue" missing="No public revenue figure found yet" />);
    expect(screen.getByText('No public revenue figure found yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from public sources' }));
    await screen.findByRole('status');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST /api/companies/${ID}/intel/refresh`,
      `POST /api/companies/${ID}/intel/refresh`,
      `POST /api/crm/companies/${ID}/enrich`,
    ]);
    expect(calls.map((c) => c.body)).toEqual([{ source: 'registry' }, { source: 'financials' }, { name: 'Acme' }]);
  });

  it('Add manually saves revenue in micros with its source', async () => {
    wrap(<FigureActions companyId={ID} companyName="Acme" fieldKey="annualRevenueMicros" label="Revenue" missing="Missing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Revenue manually' }));
    const form = screen.getByTestId('sf-form-annualRevenueMicros');
    fireEvent.change(within(form).getByLabelText('Revenue'), { target: { value: '1,250,000' } });
    fireEvent.change(within(form).getByLabelText('Source URL'), { target: { value: 'https://acme.example/report-2025.pdf' } });
    fireEvent.change(within(form).getByLabelText('Source label'), { target: { value: 'Annual report 2025' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe(`/api/crm/companies/${ID}/field-overrides`);
    expect(put.body).toEqual({ fieldKey: 'annualRevenueMicros', value: 1_250_000_000_000, currency: 'EUR', sourceUrl: 'https://acme.example/report-2025.pdf', sourceLabel: 'Annual report 2025' });
  });

  it('saves revenue in the chosen currency, and offers the currencies the account page needs', async () => {
    wrap(<FigureActions companyId={ID} companyName="Acme" fieldKey="annualRevenueMicros" label="Revenue" missing="Missing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Revenue manually' }));
    const form = screen.getByTestId('sf-form-annualRevenueMicros');
    const select = within(form).getByLabelText('Currency') as HTMLSelectElement;
    const codes = Array.from(select.options).map((o) => o.value);
    for (const c of ['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'NOK', 'SEK', 'DKK', 'BRL']) expect(codes).toContain(c);
    expect(select.value).toBe('EUR');
    fireEvent.change(select, { target: { value: 'CAD' } });
    fireEvent.change(within(form).getByLabelText('Revenue'), { target: { value: '1.2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ fieldKey: 'annualRevenueMicros', value: 1_200_000, currency: 'CAD' });
  });

  it('has no currency select on a headcount form and sends no currency', async () => {
    wrap(<FigureActions companyId={ID} companyName="Acme" fieldKey="employeeCount" label="Employees" />);
    fireEvent.click(screen.getByTestId('sf-edit-employeeCount'));
    const form = screen.getByTestId('sf-form-employeeCount');
    expect(within(form).queryByLabelText('Currency')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Employees'), { target: { value: '420' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ fieldKey: 'employeeCount', value: 420 });
  });

  it('rejects a non-http source and Escape returns focus to Edit', async () => {
    wrap(<FigureActions companyId={ID} companyName="Acme" fieldKey="employeeCount" label="Employees" />);
    const edit = screen.getByTestId('sf-edit-employeeCount');
    fireEvent.click(edit);
    const form = screen.getByTestId('sf-form-employeeCount');
    fireEvent.change(within(form).getByLabelText('Employees'), { target: { value: '420' } });
    fireEvent.change(within(form).getByLabelText('Source URL'), { target: { value: 'ftp://x.example' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toContain('http or https');
    expect(calls).toHaveLength(0);
    fireEvent.keyDown(within(form).getByLabelText('Employees'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('sf-edit-employeeCount')));
  });
});

describe('KeyNumbersStrip with sourced figures', () => {
  it('shows the source chip under a value and actions instead of No data', async () => {
    state.kn = {
      companyId: ID,
      companyName: 'Acme',
      computedAt: '2026-11-08T00:00:00Z',
      items: [
        kn({ id: 'revenue', label: 'Revenue', unit: 'money', currency: 'USD', value: 2.1e9, source: 'Wikidata', editKey: 'annualRevenueMicros', provenance: { origin: 'wikidata', label: 'Wikidata', year: '2024', url: 'https://www.wikidata.org/wiki/Q1#P2123' } }),
        kn({ id: 'employees', label: 'Employees', editKey: 'employeeCount', missing: 'No headcount on record or in public sources' }),
      ],
    };
    wrap(<KeyNumbersStrip companyId={ID} />);
    const rev = await screen.findByTestId('kn-revenue');
    expect(within(rev).getByTestId('kn-chip-revenue').textContent).toBe('Wikidata · 2024');
    expect(within(rev).getByRole('button', { name: 'Edit Revenue' })).toBeTruthy();
    const emp = screen.getByTestId('kn-employees');
    expect(emp.textContent).not.toContain('No data');
    expect(within(emp).getByText('No headcount on record or in public sources')).toBeTruthy();
    expect(within(emp).getByRole('button', { name: 'Refresh from public sources' })).toBeTruthy();
    expect(within(emp).getByRole('button', { name: 'Add Employees manually' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it('shows a Wikidata headcount chip with year and entity link, and a CRM revenue as unverified', async () => {
    state.kn = {
      companyId: ID,
      companyName: 'Acme',
      computedAt: '2026-11-08T00:00:00Z',
      items: [
        kn({ id: 'revenue', label: 'Revenue', unit: 'money_micros', value: 1.2e15, source: 'CRM record', editKey: 'annualRevenueMicros', provenance: { origin: 'crm', label: 'CRM record', year: null, url: null, unverified: true } }),
        kn({ id: 'employees', label: 'Employees', value: 12000, source: 'Wikidata', period: 'Headcount, point in time 2024', sourceUrl: 'https://www.wikidata.org/wiki/Q1#P1128', editKey: 'employeeCount', provenance: { origin: 'wikidata', label: 'Wikidata', year: '2024', url: 'https://www.wikidata.org/wiki/Q1#P1128' } }),
      ],
    };
    wrap(<KeyNumbersStrip companyId={ID} />);
    const emp = await screen.findByTestId('kn-employees');
    const chip = within(emp).getByTestId('kn-chip-employees');
    expect(chip.textContent).toBe('Wikidata · 2024');
    expect(chip.getAttribute('href')).toBe('https://www.wikidata.org/wiki/Q1#P1128');
    expect(within(screen.getByTestId('kn-revenue')).getByTestId('kn-chip-revenue').textContent).toBe('CRM record · unverified');
  });

  it('never prints n/a: a missing tile has no period line and no empty tooltip', async () => {
    state.kn = {
      companyId: ID,
      companyName: 'Acme',
      computedAt: '2026-11-08T00:00:00Z',
      items: [
        kn({ id: 'revenue', label: 'Revenue', source: 'None', period: null, editKey: 'annualRevenueMicros', missing: 'No public revenue figure found yet' }),
        // An older cached response still carries the placeholder.
        kn({ id: 'open_jobs', label: 'Open jobs', source: 'None', period: 'n/a', missing: 'No job postings tracked yet' }),
        kn({ id: 'momentum', group: 'health', label: 'Momentum', source: 'Polo account pulse', period: null, missing: 'Not enough signals yet' }),
        kn({ id: 'margin', label: 'Margin', value: 18, unit: 'pct', source: 'ESEF', period: 'FY2025' }),
      ],
    };
    wrap(<KeyNumbersStrip companyId={ID} />);
    const rev = await screen.findByTestId('kn-revenue');
    expect(rev.querySelector('[role="tooltip"]')).toBeNull();
    expect(rev.hasAttribute('aria-describedby')).toBe(false);
    const jobs = screen.getByTestId('kn-open_jobs');
    expect(jobs.querySelector('[role="tooltip"]')).toBeNull();
    const mom = screen.getByTestId('kn-momentum').querySelector('[role="tooltip"]')!;
    expect(mom.textContent).toContain('Polo account pulse');
    expect(mom.textContent).not.toContain('Period');
    const margin = screen.getByTestId('kn-margin').querySelector('[role="tooltip"]')!;
    expect(margin.textContent).toContain('Period: FY2025');
    expect(document.body.textContent).not.toMatch(/n\/a/i);
  });
});

describe('FinancialsPanel registry', () => {
  const fin = (registry: AccountFinancialsIntel['registry']) => ({ companyId: ID, years: [], revenueFallback: null, registry, evidence: [], sample: false }) as unknown as AccountFinancialsIntel;

  it('shows each registry row with a source chip and Edit on the rows the user owns', () => {
    wrap(
      <FinancialsPanel
        company={{ id: ID, name: 'Acme' }}
        f={fin([
          { label: 'Registration number', value: '01234567', source: 'Companies House', sourceUrl: 'https://find-and-update.company-information.service.gov.uk/company/01234567', fetchedAt: '2026-10-01T00:00:00Z', fieldKey: 'registryId' },
          { label: 'LEI', value: '5493001KJTIIGC8Y1R12', source: 'GLEIF', sourceUrl: 'https://search.gleif.org/#/record/5493001KJTIIGC8Y1R12', fetchedAt: '2026-10-01T00:00:00Z' },
        ])}
      />,
    );
    const block = screen.getByTestId('intel-registry');
    expect(within(block).getByText('Companies House · 2026').tagName).toBe('A');
    expect(within(block).getByText('GLEIF · 2026')).toBeTruthy();
    expect(within(block).getAllByRole('button', { name: /^Edit / })).toHaveLength(1);
    expect(within(block).getByRole('button', { name: 'Add Jurisdiction manually' })).toBeTruthy();
  });

  it('an empty registry says what is missing and offers both actions', () => {
    wrap(<FinancialsPanel company={{ id: ID, name: 'Acme' }} f={fin([])} />);
    const block = screen.getByTestId('intel-registry-empty');
    expect(block.textContent).toContain('No registry record found yet');
    expect(within(block).getByRole('button', { name: 'Refresh from public sources' })).toBeTruthy();
    expect(within(block).getByRole('button', { name: 'Add Registration number manually' })).toBeTruthy();
  });

  it('without a company the panel renders as before', () => {
    render(<FinancialsPanel f={fin([])} />);
    expect(screen.queryByTestId('intel-registry-empty')).toBeNull();
  });
});
