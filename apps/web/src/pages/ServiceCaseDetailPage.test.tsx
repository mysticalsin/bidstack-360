// Regression test for the silent-failure bug: the status-transition buttons
// ('Mark open/resolved/closed/...') called update.mutate() with no onError,
// so a rejected PATCH (stale case, permission denial, 404) failed with zero
// feedback. Fix mirrors this same page's handleSaveNote(), which already
// passes an inline onError to the identical mutation.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceCaseDetailPage } from './ServiceCaseDetailPage';
import { toast } from '@/components/ui/Toast';
import { useServiceCase, useUpdateServiceCase } from '@/hooks/useServiceCases';
import type { ServiceCase } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'cs1' }),
}));

vi.mock('@/hooks/useServiceCases', () => ({
  useServiceCase: vi.fn(),
  useUpdateServiceCase: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
// Default to full access so the existing rendering/error-surfacing assertions
// below are unaffected; the gating tests flip this per-case.
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const CASE: ServiceCase = {
  id: 'cs1',
  orgId: 'o1',
  number: 'CASE-1',
  subject: 'Printer on fire',
  description: null,
  priority: 'high',
  status: 'open',
  accountId: null,
  contactId: null,
  ownerId: null,
  ownerName: null,
  source: 'email',
  satisfaction: null,
  resolvedAt: null,
  closedAt: null,
  slaDeadline: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServiceCaseDetailPage />
    </QueryClientProvider>,
  );
}

describe('ServiceCaseDetailPage — status transition error surfacing', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('toasts when a status-transition PATCH is rejected (e.g. stale/deleted case, 403)', () => {
    vi.mocked(useServiceCase).mockReturnValue({
      data: CASE,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useServiceCase>);

    const mutate = vi.fn(
      (_vars: unknown, opts?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => {
        opts?.onError?.(new Error('Case not found'));
      },
    );
    vi.mocked(useUpdateServiceCase).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateServiceCase>);

    renderPage();

    // 'open' status transitions to waiting_customer / waiting_internal / escalated / resolved.
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));

    expect(mutate).toHaveBeenCalledWith(
      { id: 'cs1', body: { status: 'resolved' } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(toast.error).toHaveBeenCalledWith('Could not update case status');
  });
});

// Regression: status transitions and 'Save note' PATCH through service-cases
// routes, gated server-side behind service-desk:write — the buttons rendered
// enabled for everyone and only failed after the click (403), instead of
// reflecting the viewer's real access up front.
describe('ServiceCaseDetailPage — service-desk:write gating', () => {
  beforeEach(() => {
    vi.mocked(useServiceCase).mockReturnValue({
      data: CASE,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useServiceCase>);
    vi.mocked(useUpdateServiceCase).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateServiceCase>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('enables status-transition and Save note buttons for a user with service-desk:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect((screen.getByRole('button', { name: 'Mark resolved' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    // Save note is disabled regardless — the note field is empty.
    expect((screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('disables status-transition and Save note buttons for a user without service-desk:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    const markResolved = screen.getByRole('button', { name: /^Mark resolved/ }) as HTMLButtonElement;
    expect(markResolved.disabled).toBe(true);
    const saveNote = screen.getByRole('button', { name: /^Save note/ }) as HTMLButtonElement;
    expect(saveNote.disabled).toBe(true);
    expect(markResolved.getAttribute('title')).toBe(
      'You need service desk write access to update this case.',
    );
    // `title` is mouse-only — the accessible name itself must carry the
    // reason so screen-reader/keyboard users get it too.
    expect(markResolved.getAttribute('aria-label')).toBe(
      'Mark resolved — You need service desk write access to update this case.',
    );
    expect(saveNote.getAttribute('aria-label')).toBe(
      'Save note — You need service desk write access to update this case.',
    );
  });
});
