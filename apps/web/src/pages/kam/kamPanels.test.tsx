import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KamHandoffCard } from './kamPanels';
import type { KamHandoffDetail, KamHandoffExportResult, KamHandoffPayload } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  handoffs: [] as KamHandoffDetail[],
  exportMutate: vi.fn(),
  confirmMutate: vi.fn(),
  exportPending: false,
  confirmPending: false,
}));

vi.mock('@/hooks/useUiSound', () => ({
  useUiSound: () => vi.fn(),
}));

vi.mock('@/hooks/useKam', () => ({
  useKamHandoffs: () => ({
    data: { items: hookMocks.handoffs },
    isLoading: false,
    isError: false,
  }),
  useExportKamHandoff: () => ({
    mutate: hookMocks.exportMutate,
    isPending: hookMocks.exportPending,
  }),
  useConfirmKamHandoff: () => ({
    mutate: hookMocks.confirmMutate,
    isPending: hookMocks.confirmPending,
  }),
  useApproveDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useKamAccountKpi: () => ({ data: null, isLoading: false, isError: false }),
  useKamAccountTodos: () => ({ data: null, isLoading: false, isError: false }),
  useKamDrafts: () => ({ data: null, isLoading: false, isError: false }),
  useKamInitiatives: () => ({ data: null, isLoading: false, isError: false }),
  useRejectDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useTransitionInitiative: () => ({ mutate: vi.fn(), isPending: false }),
}));

const draftHandoff: KamHandoffDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  initiativeId: '33333333-3333-4333-8333-333333333333',
  opportunityId: '44444444-4444-4444-8444-444444444444',
  status: 'draft',
  targetSystem: 'abc_om',
  externalRef: null,
  exportedAt: null,
  createdAt: '2026-06-29T07:00:00.000Z',
};

const exportedHandoff: KamHandoffDetail = {
  ...draftHandoff,
  status: 'exported',
  exportedAt: '2026-06-29T07:05:00.000Z',
};

const payload: KamHandoffPayload = {
  schemaVersion: 1,
  source: 'bidstack_kam',
  handoffId: draftHandoff.id,
  exportedAt: '2026-06-29T07:05:00.000Z',
  account: {
    companyId: draftHandoff.companyId,
    name: 'Mantu',
    country: 'FR',
  },
  initiative: {
    id: draftHandoff.initiativeId,
    title: 'Modernize ABC handoff',
    description: null,
    ownerId: null,
  },
  opportunity: {
    id: draftHandoff.opportunityId!,
    code: 'OP-2026-001',
    valueMicros: 750_000_000,
    currency: 'EUR',
  },
};

describe('KamHandoffCard', () => {
  beforeEach(() => {
    hookMocks.handoffs = [];
    hookMocks.exportMutate.mockReset();
    hookMocks.confirmMutate.mockReset();
    hookMocks.exportPending = false;
    hookMocks.confirmPending = false;
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:handoff'),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exports an ABC OM JSON payload and keeps a visible preview', () => {
    hookMocks.handoffs = [draftHandoff];

    render(<KamHandoffCard companyId={draftHandoff.companyId} />);
    fireEvent.click(screen.getByRole('button', { name: /export json/i }));

    expect(hookMocks.exportMutate).toHaveBeenCalledWith(
      draftHandoff.id,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const options = hookMocks.exportMutate.mock.calls[0]?.[1] as {
      onSuccess: (result: KamHandoffExportResult) => void;
    };
    act(() => options.onSuccess({ handoff: exportedHandoff, payload }));

    expect(screen.getByText(/"source": "bidstack_kam"/)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:handoff');
  });

  it('requires the ABC OM reference before confirming an exported handoff', () => {
    hookMocks.handoffs = [exportedHandoff];

    render(<KamHandoffCard companyId={exportedHandoff.companyId} />);

    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('ABC OM reference'), {
      target: { value: 'ABC-OM-12345' },
    });
    fireEvent.click(confirm);

    expect(hookMocks.confirmMutate).toHaveBeenCalledWith({
      id: exportedHandoff.id,
      body: { externalRef: 'ABC-OM-12345' },
    });
  });
});
