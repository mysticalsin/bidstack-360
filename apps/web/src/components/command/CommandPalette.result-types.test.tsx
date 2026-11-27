// ⌘K shows the same workspace-search rows as /search. A proposal and a
// requirement landed in a group with no accessible name, and the row badge
// was the machine key (proposal, rfp_requirement).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import { api } from '@/lib/api';

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({ data: { companies: [] } }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [] } }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: [] } }),
}));

vi.mock('@/components/company/CompanyLogo', () => ({
  CompanyLogo: () => null,
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [] })),
}));

vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <CommandPalette open onOpenChange={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(api).mockImplementation(async () => ({ items: [] }));
});

describe('CommandPalette bid-record labels', () => {
  it('names a proposal and a requirement for a screen reader', async () => {
    // WHY: "zzgap" matches nothing in the nav list, so the only rows are the
    // workspace-search hits. Those groups had no aria-label, and the badge
    // printed rfp_requirement.
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (String(path).startsWith('/api/search')) {
        return {
          items: [
            {
              id: 'prop-1',
              type: 'proposal',
              title: 'Siemens ERP Technical Proposal',
              subtitle: 'review',
              url: '/proposals/prop-1',
              score: 9,
            },
            {
              id: 'req-1',
              type: 'rfp_requirement',
              title: 'Clause 4.2 response time',
              subtitle: 'MUST',
              url: '/opportunities/opp-1',
              score: 4,
            },
          ],
          pageContinues: false,
          continuedTypes: [],
          query: 'zzgap',
        };
      }
      return { items: [] };
    });

    renderPalette();
    fireEvent.change(screen.getByRole('combobox', { name: /search across the workspace/i }), {
      target: { value: 'zzgap' },
    });

    const proposal = await screen.findByRole('option', { name: /Siemens ERP Technical Proposal/ });
    const requirement = await screen.findByRole('option', { name: /Clause 4.2 response time/ });

    expect(proposal.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Proposals');
    expect(requirement.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Requirements');
    // The title already contains "Proposal". Strip it so the badge has to be
    // the short tag, not the machine key "proposal" or "rfp_requirement".
    const proposalBadge = (proposal.textContent ?? '').replace('Siemens ERP Technical Proposal', '');
    const requirementBadge = (requirement.textContent ?? '').replace('Clause 4.2 response time', '');
    expect(proposalBadge).toContain('prop');
    expect(proposalBadge.toLowerCase()).not.toContain('proposal');
    expect(requirementBadge).toContain('req');
    expect(requirementBadge).not.toContain('rfp_requirement');
  });
});
