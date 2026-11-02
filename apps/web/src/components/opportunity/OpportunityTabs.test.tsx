import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

// DecisionUnitPanel (the default active tab) queries the API directly — stub
// it so the module under test never hits a real network call.
vi.mock('@/lib/api', () => ({
  api: vi.fn().mockResolvedValue({ items: [] }),
}));

// Isolate the finding under test (the trigger's disabled/enabled + documentId
// wiring) from SendForSignatureModal's own internals (template lookups,
// mutation wiring, etc. — covered by its own tests).
vi.mock('@/components/signatures/SendForSignatureModal', () => ({
  SendForSignatureModal: ({ open, documentId }: { open: boolean; documentId?: string }) =>
    open ? <div data-testid="signature-modal" data-document-id={documentId ?? ''} /> : null,
}));

import { api } from '@/lib/api';

import { OpportunityTabs } from './OpportunityTabs';

function renderPanel(documents: Array<{ id: string; name: string; kind: string; bytes: number | null }>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OpportunityTabs oppId="opp-1" customer="Acme" documents={documents} />
    </QueryClientProvider>,
  );
  // Radix Tabs activates on mousedown (not click) for pointer input.
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Documents' }));
}

describe('OpportunityTabs decision unit', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not tell an empty deal to sync a buying role from Dust', async () => {
    // Why: Dust is not connected here, and a job title is not a buying role.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OpportunityTabs oppId="opp-1" customer="Acme" documents={[]} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Link a contact to this opportunity/)).toBeTruthy();
    expect(screen.queryByText(/Dust/)).toBeNull();
  });
});

describe('OpportunityTabs tasks caption', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(api).mockReset();
    vi.mocked(api).mockResolvedValue({ items: [] });
  });

  it('does not describe a full task page as every task', async () => {
    // WHY: the Tasks tab counted a 50-row page as every follow-up on the deal.
    // nextCursor means the route already read one row past the page and dropped it.
    vi.mocked(api).mockImplementation((path: string) => {
      if (String(path).startsWith('/api/tasks')) {
        return Promise.resolve({
          items: Array.from({ length: 50 }, (_, index) => ({
            id: `task-${index}`,
            oppId: 'opp-1',
            title: `Follow-up ${index}`,
            dueDate: '2026-11-02',
            status: 'open',
            assignee: null,
            createdAt: '2026-11-01T00:00:00.000Z',
          })),
          nextCursor: 'task-49',
        });
      }
      return Promise.resolve({ items: [] });
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OpportunityTabs oppId="opp-1" customer="Acme" documents={[]} />
      </QueryClientProvider>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tasks' }));

    expect(await screen.findByText('50 in the latest 50, not every task')).toBeTruthy();
    expect(screen.queryByText('50 active')).toBeNull();
    expect(
      vi.mocked(api).mock.calls.some(
        (call) => String(call[0]).includes('oppId=opp-1') && String(call[0]).includes('limit=50'),
      ),
    ).toBe(true);
  });

  it('keeps the old task caption when the page does not continue', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (String(path).startsWith('/api/tasks')) {
        return Promise.resolve({
          items: [
            {
              id: 'task-1',
              oppId: 'opp-1',
              title: 'Send the draft',
              dueDate: '2026-11-02',
              status: 'open',
              assignee: null,
              createdAt: '2026-11-01T00:00:00.000Z',
            },
            {
              id: 'task-2',
              oppId: 'opp-1',
              title: 'Book the review',
              dueDate: '2026-11-03',
              status: 'open',
              assignee: null,
              createdAt: '2026-11-01T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: [] });
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OpportunityTabs oppId="opp-1" customer="Acme" documents={[]} />
      </QueryClientProvider>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tasks' }));

    expect(await screen.findByText('2 active')).toBeTruthy();
    expect(screen.queryByText(/not every task/i)).toBeNull();
  });
});

function callRow(id: string) {
  return {
    id,
    provider: 'ZOOM',
    status: 'COMPLETED',
    startedAt: '2026-11-01T15:00:00.000Z',
    scheduledAt: null,
    durationSec: 600,
    summary: null,
  };
}

describe('OpportunityTabs calls caption', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(api).mockReset();
    vi.mocked(api).mockResolvedValue({ items: [] });
  });

  it('does not describe a full call page as every call', async () => {
    // WHY: the Calls tab counted a 25-row page as every call on the deal.
    // nextCursor means the route already read one row past the page and dropped it.
    vi.mocked(api).mockImplementation((path: string) => {
      if (String(path).startsWith('/api/calls')) {
        return Promise.resolve({
          calls: Array.from({ length: 25 }, (_, index) => callRow(`call-${index}`)),
          nextCursor: 'call-24',
        });
      }
      return Promise.resolve({ items: [] });
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OpportunityTabs oppId="opp-1" customer="Acme" documents={[]} />
      </QueryClientProvider>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Calls' }));

    expect(await screen.findByText('25 in the latest 25, not every call')).toBeTruthy();
    expect(screen.queryByText('25 call')).toBeNull();
    expect(screen.queryByText('probe-call')).toBeNull();
    expect(
      vi.mocked(api).mock.calls.some(
        (call) =>
          String(call[0]).includes('/api/calls') &&
          String(call[0]).includes('entityId=opp-1') &&
          String(call[0]).includes('limit=25'),
      ),
    ).toBe(true);
  });

  it('keeps the old call caption when the page does not continue', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (String(path).startsWith('/api/calls')) {
        return Promise.resolve({
          calls: [callRow('call-1'), callRow('call-2')],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: [] });
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OpportunityTabs oppId="opp-1" customer="Acme" documents={[]} />
      </QueryClientProvider>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Calls' }));

    expect(await screen.findByText('2 call')).toBeTruthy();
    expect(screen.queryByText(/not every call/i)).toBeNull();
  });
});

describe('OpportunityTabs — DocumentsPanel send-for-signature trigger', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('disables the Send for Signature trigger and never opens the modal when no document exists', () => {
    // WHY this matters: SignatureRequestCreate needs a real Document id. With
    // no document uploaded there was previously a fallback to a template id
    // (wrong entity type) — the trigger must be disabled instead of opening a
    // modal that can only send a broken id.
    renderPanel([]);

    const trigger = screen.getByRole('button', { name: 'Send for Signature' });
    expect(trigger).toHaveProperty('disabled', true);
    expect(trigger.getAttribute('title')).toBe('Upload a document before sending it for signature');

    fireEvent.click(trigger);
    expect(screen.queryByTestId('signature-modal')).toBeNull();
  });

  it('enables the trigger and opens the modal with the first document id once a document exists', () => {
    renderPanel([{ id: 'doc-1', name: 'RFP.pdf', kind: 'RFP', bytes: 1024 }]);

    const trigger = screen.getByRole('button', { name: 'Send for Signature' });
    expect(trigger).toHaveProperty('disabled', false);

    fireEvent.click(trigger);
    const modal = screen.getByTestId('signature-modal');
    expect(modal.getAttribute('data-document-id')).toBe('doc-1');
  });
});
