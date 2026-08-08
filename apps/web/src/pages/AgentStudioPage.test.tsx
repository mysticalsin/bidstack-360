import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStudioPage } from './AgentStudioPage';
import { api } from '@/lib/api';
import { useHasPermission } from '@/hooks/useCapabilities';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

// Run is gated server-side behind agents:write (apps/api/src/routes/crews.ts)
// — the run affordance must reflect that, not just show a button that always
// 403s once the RFP form is filled out.
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  confirm: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      if (!fallback) return key;
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      );
    },
  }),
}));

const apiMock = vi.mocked(api);

function renderAgentStudio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentStudioPage />
    </QueryClientProvider>,
  );
}

describe('AgentStudioPage', () => {
  beforeEach(() => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/crew-agents') {
        return {
          items: [
            {
              id: 'agent-1',
              agentKey: 'document_intelligence',
              role: 'Document Intelligence Engine',
              goal: 'Extract requirements',
              backstory: 'Reads RFP source material with citations.',
              isStandard: true,
            },
          ],
        };
      }
      if (path === '/api/v1/crews') {
        return {
          items: [
            {
              id: 'crew-1',
              name: 'RFP Response Crew',
              description: null,
              process: 'hierarchical',
              taskCount: 1,
            },
          ],
        };
      }
      if (path === '/api/v1/crews/crew-1/run') {
        return { runId: 'run-1' };
      }
      if (path === '/api/v1/crew-runs/run-1') {
        return { id: 'run-1', status: 'queued', finalOutput: null, results: null, error: null };
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('requires RFP text and explicit agent approval before starting a crew run', async () => {
    renderAgentStudio();

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    const runCrew = screen.getByRole('button', { name: 'Run crew' }) as HTMLButtonElement;
    expect(runCrew.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('RFP text'), {
      target: { value: 'Synthetic RFP for SERUM approval gate QA.' },
    });
    expect(runCrew.disabled).toBe(true);

    fireEvent.click(
      screen.getByLabelText(
        'I reviewed this run and approve the listed agents to process this input.',
      ),
    );
    expect(runCrew.disabled).toBe(false);

    fireEvent.click(runCrew);

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/crews/crew-1/run',
        expect.objectContaining({
          method: 'POST',
          body: {
            inputs: { rfp: 'Synthetic RFP for SERUM approval gate QA.' },
            approvalConfirmed: true,
          },
        }),
      );
    });
  });

  it('disables Run for a user without agents:write instead of letting them 403 after filling the form', async () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderAgentStudio();

    const runButton = (await screen.findByRole('button', {
      name: /^Run/,
    })) as HTMLButtonElement;

    expect(runButton.disabled).toBe(true);
    expect(runButton.title).toBe(
      'You need agent run access to run a crew. Ask an admin to grant it.',
    );
    // `title` is mouse-only — the disabled button stays in the tab order, so
    // the accessible name itself must carry the reason for screen-reader and
    // keyboard-only users.
    expect(runButton.getAttribute('aria-label')).toBe(
      'Run — You need agent run access to run a crew. Ask an admin to grant it.',
    );

    // Clicking a disabled button is a no-op — the run panel never mounts, so
    // there is no RFP form to fill out and no start-run request to 403 on.
    fireEvent.click(runButton);
    expect(screen.queryByLabelText('RFP text')).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith(
      '/api/v1/crews/crew-1/run',
      expect.anything(),
    );
  });
});
