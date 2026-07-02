import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import { QuickAddMenu } from '@/components/quickadd/QuickAddMenu';
import { useAppModules } from '@/hooks/useAppModules';
import { useIsAdmin } from '@/lib/auth';
import { useQuickAddStore } from '@/stores/quickAdd';
import type { AppModules, CrmCompany } from '@bidstack/shared';

// Minimal company fixtures — only the fields the palette actually reads. The
// rest of CrmCompany is exercised by the schema's own tests.
function company(overrides: Partial<CrmCompany>): CrmCompany {
  return {
    id: overrides.id ?? 'co_test',
    source: 'external_crm',
    name: overrides.name ?? 'Test Co',
    legalName: overrides.legalName ?? null,
    domain: overrides.domain ?? null,
    website: null,
    industry: overrides.industry ?? null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    confidence: 1,
    sourceAttribution: [],
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const COMPANIES: CrmCompany[] = [
  company({ id: 'co_aritzia', name: 'Aritzia', industry: 'Retail', domain: 'aritzia.com' }),
  company({ id: 'co_lulu', name: 'Lululemon', industry: 'Apparel', domain: 'lululemon.com' }),
  company({ id: 'co_canada-goose', name: 'Canada Goose', industry: 'Apparel' }),
];

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({ data: { companies: COMPANIES } }),
}));

// The palette also pulls contacts + tasks for cross-entity search; mock those
// with empty arrays so the assertions only see the account row.
vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [] } }),
}));
vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: [] } }),
}));

// CompanyLogo would otherwise try to render <img>, which is noisy in jsdom but
// not strictly broken — we stub it to keep the test focused on palette logic.
vi.mock('@/components/company/CompanyLogo', () => ({
  CompanyLogo: ({ name }: { name: string }) => <span data-testid="company-logo">{name}</span>,
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [] })),
}));

// Module flags gate whole nav sections (see navConfig.ts isNavItemVisible).
// Mocking the hook directly (rather than the generic `api` mock above) lets
// each test set exact flag combinations instead of guessing what the api
// stub would return.
vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: vi.fn(() => ({ data: undefined })),
}));

// /audit-log is permission-gated (RequireAdmin in AdminRoutes.tsx), not
// module-flag-gated — a separate axis from useAppModules above. Defaults to
// non-admin; individual tests override via vi.mocked(useIsAdmin).
vi.mock('@/lib/auth', () => ({
  useIsAdmin: vi.fn(() => false),
}));

// QuickAddMenu's create dialogs are real forms with their own data
// dependencies — stub them the same way CompanyLogo is stubbed above so the
// "Create" group tests only exercise the palette↔quick-add wiring, not the
// forms themselves.
vi.mock('@/components/opportunity/CreateOpportunityDialog', () => ({
  CreateOpportunityDialog: ({ open }: { open?: boolean }) =>
    open ? <div data-testid="dialog-opportunity" /> : null,
}));
vi.mock('@/components/task/CreateTaskDialog', () => ({
  CreateTaskDialog: ({ open }: { open?: boolean }) =>
    open ? <div data-testid="dialog-task" /> : null,
}));
vi.mock('@/components/contact/ContactDialog', () => ({
  ContactDialog: ({ open }: { open?: boolean }) =>
    open ? <div data-testid="dialog-contact" /> : null,
}));

function mockAppModules(overrides: Partial<AppModules>): void {
  vi.mocked(useAppModules).mockReturnValue({
    data: {
      agentStudioEnabled: false,
      appflowyEnabled: false,
      appflowyUrl: null,
      serumEnabled: false,
      ...overrides,
    },
  } as ReturnType<typeof useAppModules>);
}

function renderPalette(onOpenChange: (open: boolean) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <CommandPalette open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Renders the palette alongside QuickAddMenu — the "Create" group only
// proves anything end-to-end if the dialog it targets is actually mounted,
// exactly as it is in the real app shell (see App.tsx).
function renderPaletteWithQuickAdd(onOpenChange: (open: boolean) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <CommandPalette open={true} onOpenChange={onOpenChange} />
        <QuickAddMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  // vitest.config.ts runs with `globals: false`, so testing-library's
  // automatic afterEach-cleanup never registers — without this, each test's
  // rendered dialog stays mounted and later `getByText` queries see
  // duplicates from every previous test.
  cleanup();
  // Quick-add state is a module-level store, not React state — it survives
  // across tests unless reset explicitly.
  useQuickAddStore.setState({ menuOpen: false, pick: null });
  // useIsAdmin is a vi.fn() with a module-level default — tests that
  // override it via mockReturnValue(true) must not leak into the next test.
  vi.mocked(useIsAdmin).mockReturnValue(false);
});

describe('CommandPalette — accounts section', () => {
  it('filters companies by name when the user types a substring', () => {
    renderPalette();

    const input = screen.getByRole('combobox', { name: /search across the workspace/i });
    fireEvent.change(input, { target: { value: 'ari' } });

    // The Aritzia row is the only listbox option after filtering by "ari".
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Aritzia');
    expect(options[0]?.textContent).toContain('Retail · aritzia.com');

    // Non-matching companies are filtered out — verifies the substring match
    // actually narrows the list rather than always rendering everything.
    expect(screen.queryByText('Lululemon')).toBeNull();
    expect(screen.queryByText('Canada Goose')).toBeNull();
  });
});

// A5 — the palette used to carry its own hand-maintained NAV_TARGETS list
// that had drifted from navConfig.ts: it unconditionally listed the
// flag-gated Agent Studio route (leaking it into search for orgs with the
// module off) while missing plain, always-visible routes like Key Account
// Mgmt (/kam) that had been added to the sidebar but never copied over.
// These tests pin the fix: targets come from NAV_SECTIONS at render time.
describe('CommandPalette — nav targets derived from NAV_SECTIONS', () => {
  it('does not show a nav item whose module flag is disabled', () => {
    mockAppModules({ agentStudioEnabled: false });
    renderPalette();

    expect(screen.queryByText('Go to Agent Studio')).toBeNull();
  });

  it('shows the flag-gated nav item once its module is enabled', () => {
    mockAppModules({ agentStudioEnabled: true });
    renderPalette();

    expect(screen.queryByText('Go to Agent Studio')).not.toBeNull();
  });

  it('shows a plain NAV_SECTIONS route that was never in the old hardcoded list', () => {
    mockAppModules({});
    renderPalette();

    // /kam ("Key Account Mgmt") has no featureKey — it is unconditionally
    // visible — and was NOT one of the ~30 hand-copied NAV_TARGETS entries,
    // so its presence proves the list is now generated, not hand-maintained.
    expect(screen.queryByText('Go to Key Account Mgmt')).not.toBeNull();
  });

  // Review finding: /audit-log is a PALETTE_ONLY_TARGETS entry (it has no
  // NAV_SECTIONS home), so isNavItemVisible/module flags never touch it —
  // but it IS wrapped in RequireAdmin at the router level and marked
  // `admin: true` in SettingsLayout's GROUPS, its only other entry point.
  // A non-admin must not see (or Enter-jump to) a route that exists only to
  // be bounced back to /dashboard on arrival — the leak is the search
  // result itself, independent of what happens after selection.
  it('does not show the admin-gated Audit log route for a non-admin user', () => {
    mockAppModules({});
    vi.mocked(useIsAdmin).mockReturnValue(false);
    renderPalette();

    expect(screen.queryByText('Go to Audit log')).toBeNull();
  });

  it('shows the Audit log route once the user is an admin', () => {
    mockAppModules({});
    vi.mocked(useIsAdmin).mockReturnValue(true);
    renderPalette();

    expect(screen.queryByText('Go to Audit log')).not.toBeNull();
  });
});

// A5 — "Create" action group: selecting an entity must close the palette
// and open the SAME dialog QuickAddMenu's `N` picker opens, not a
// re-implementation of the form.
describe('CommandPalette — Create action group', () => {
  it('opens the CreateTaskDialog and closes the palette when "New task" is selected', () => {
    mockAppModules({});
    const onOpenChange = vi.fn();
    renderPaletteWithQuickAdd(onOpenChange);

    fireEvent.click(screen.getByText('New task'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('dialog-task')).not.toBeNull();
    // The other quick-add dialogs must stay unmounted — proves this wired
    // the specific entity, not "open whatever was last picked".
    expect(screen.queryByTestId('dialog-opportunity')).toBeNull();
    expect(screen.queryByTestId('dialog-contact')).toBeNull();
  });

  it('opens the CreateOpportunityDialog when "New opportunity" is selected', () => {
    mockAppModules({});
    renderPaletteWithQuickAdd();

    fireEvent.click(screen.getByText('New opportunity'));

    expect(screen.queryByTestId('dialog-opportunity')).not.toBeNull();
  });

  // Review finding: the flat listbox had no role="group"/aria-label
  // distinguishing sections — a screen-reader user arrowing through the
  // list heard "New task, option" with no indication it belonged to a
  // "Create" group distinct from "Navigate"/"Accounts". Pin the fix.
  it('wraps the Create group rows in a role="group" with an accessible name', () => {
    mockAppModules({});
    renderPaletteWithQuickAdd();

    const option = screen.getByText('New task').closest('[role="option"]');
    const group = option?.closest('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('aria-label')).toBe('Create');
  });
});
