// Regression: every write action on this page (create/toggle/run/delete) is
// gated server-side behind workflows:write, but rendered unconditionally
// enabled — a user without the permission saw a fully-editable board that
// 403'd on every click. Mirrors TerritoriesPage.test.tsx's gating pattern.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowsPage } from './WorkflowsPage';
import { useWorkflows } from '@/hooks/useWorkflows';
import type { Workflow } from '@bidstack/shared';

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

vi.mock('@/hooks/useWorkflows', () => ({
  useWorkflows: vi.fn(),
  useCreateWorkflow: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateWorkflow: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteWorkflow: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRunWorkflow: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const WORKFLOW: Workflow = {
  id: 'w-1',
  orgId: 'org-1',
  name: 'Notify on stage change',
  description: null,
  active: true,
  triggerKind: 'stage_changed',
  triggerConfig: {},
  actions: [
    {
      id: 'a-1',
      workflowId: 'w-1',
      kind: 'create_notification',
      config: {},
      sortOrder: 0,
      createdAt: new Date().toISOString(),
    },
  ],
  runCount: 3,
  lastRunAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowsPage />
    </QueryClientProvider>,
  );
}

describe('WorkflowsPage — workflows:write gating', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    vi.mocked(useWorkflows).mockReturnValue({
      data: { items: [WORKFLOW] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useWorkflows>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the New workflow button and enables card actions for a user with workflows:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: 'New workflow' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole('checkbox', { name: /^(Active|Paused)$/ }) as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole('button', {
          name: 'Delete workflow: Notify on stage change',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('hides the New workflow button and disables card actions for a user without workflows:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // The list still renders (read access is ungated) ...
    expect(screen.getByText('Notify on stage change')).toBeTruthy();
    // ... but every write affordance is gone or disabled, not a silent 403 trap.
    expect(screen.queryByRole('button', { name: 'New workflow' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: /^(Active|Paused)$/ }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Delete workflow: Notify on stage change',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('hides the New workflow empty-state action for a user without workflows:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);
    vi.mocked(useWorkflows).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useWorkflows>);

    renderPage();

    expect(screen.getByText('No workflows yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New workflow' })).toBeNull();
  });
});
