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
    expect(trigger.getAttribute('title')).toBe('Nothing is attached to this bid yet');
    expect(screen.queryByText(/upload an rfp/i)).toBeNull();

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

  it('calls the one demo proposal a single file, not a raw enum', () => {
    // WHY: seed attaches exactly one document, Test Contract.pdf, kind
    // "proposal", with no byte count. The header said "1 files" and the row
    // printed the enum. One file is "1 file". The kind is Proposal. The size
    // stays unknown because none was stored.
    renderPanel([
      {
        id: 'd0c00000-0000-0000-0000-000000000000',
        name: 'Test Contract.pdf',
        kind: 'proposal',
        bytes: null,
      },
    ]);

    expect(screen.getByText('1 file')).toBeTruthy();
    expect(screen.queryByText('1 files')).toBeNull();
    expect(screen.getAllByText('Proposal').length).toBeGreaterThan(0);
    expect(screen.queryByText('proposal')).toBeNull();
    expect(screen.getByText(/unknown size/)).toBeTruthy();
  });
});
