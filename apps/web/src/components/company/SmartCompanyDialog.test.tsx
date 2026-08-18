// Regression coverage for the create-company write gating: POST
// /api/crm/companies/:id/enrich is gated server-side behind companies:write,
// but the submit button was enabled/clickable for every role — a role
// without the permission could fill out the whole dialog only to 403 on
// submit. The submit must be disabled (with a hint) instead.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SmartCompanyDialog } from './SmartCompanyDialog';
import { useHasPermission } from '@/hooks/useCapabilities';

vi.mock('@/lib/api', () => ({ api: vi.fn().mockResolvedValue({}) }));

// Company create is gated server-side behind companies:write — default true
// so incidental rendering assertions aren't affected; the dedicated describe
// block below overrides per-test.
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SmartCompanyDialog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openDialogAndTypeName() {
  fireEvent.click(screen.getByRole('button', { name: /New account/i }));
  const input = await screen.findByLabelText(/Company or domain/i);
  fireEvent.change(input, { target: { value: 'Acme Corp' } });
}

describe('SmartCompanyDialog — companies:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('enables the create-company submit for a role with companies:write', async () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderDialog();
    await openDialogAndTypeName();

    const submit = screen.getByRole('button', { name: /Create enriched account/i });
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('disables the create-company submit with a hint for a role without companies:write', async () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderDialog();
    await openDialogAndTypeName();

    // The dialog itself still renders (read access is ungated) ...
    const submit = screen.getByRole('button', { name: /Create enriched account/i });
    // ... but the write affordance that would 403 on submit is disabled.
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(submit.getAttribute('title')).toMatch(/smartCompany\.readOnlyHint|write access/i);
  });
});
