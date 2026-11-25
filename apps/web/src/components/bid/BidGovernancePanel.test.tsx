// Regression coverage for the Amaris governance panel now that it lives on the
// opportunity record, not just the Bid/No-Bid calculator.
//
// WHY these cases: the panel used to open on its OWN defaults (5 FTE, medium)
// regardless of what was saved, so a C4 bid displayed as C2 and a "Save" click
// silently downgraded it. And it offered every gate to every class, which the
// API now rejects — a dropdown that lists options the server 409s on is a trap.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const capabilitiesMocks = vi.hoisted(() => ({
  useHasPermission: vi.fn(() => true),
  useHasAdminPermission: vi.fn(() => true),
  useCapabilities: vi.fn(() => ({ data: null })),
}));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const governanceMocks = vi.hoisted(() => ({
  gateItems: [] as Record<string, unknown>[],
  saveMutate: vi.fn(),
  recordMutate: vi.fn(),
}));
vi.mock('@/hooks/useBidGovernance', () => ({
  useGateDecisions: () => ({
    data: { items: governanceMocks.gateItems },
    isLoading: false,
    isError: false,
  }),
  useSaveClassification: () => ({ mutate: governanceMocks.saveMutate, isPending: false }),
  useRecordGate: () => ({ mutate: governanceMocks.recordMutate, isPending: false }),
}));

import { BidGovernancePanel } from './BidGovernancePanel';

function renderPanel(
  saved: {
    bidClass: string | null;
    fteEstimate: number | null;
    commitmentLevel: string | null;
  } | null,
  // null = the scratch calculator, with no deal selected. undefined keeps the
  // default deal id so existing cases stay bound to a record.
  opportunityId?: string | null,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const id = opportunityId === undefined ? 'opp-1' : opportunityId;
  render(
    <QueryClientProvider client={queryClient}>
      <BidGovernancePanel {...(id ? { opportunityId: id } : {})} saved={saved} />
    </QueryClientProvider>,
  );
}

function gateSelect(): HTMLSelectElement {
  return screen.getByLabelText('Gate') as HTMLSelectElement;
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.value);
}

describe('BidGovernancePanel', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    governanceMocks.gateItems = [];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens on the SAVED assessment, not its own defaults', () => {
    // 45 FTE x xhigh = C4. With the old defaults (5 FTE, medium) this rendered
    // C2 and offered to "Save C2" over a C4 bid.
    renderPanel({ bidClass: 'C4', fteEstimate: 45, commitmentLevel: 'xhigh' });
    expect((screen.getByLabelText('Team size (FTE)') as HTMLInputElement).value).toBe('45');
    expect(screen.getByRole('button', { name: 'X-High' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Save C4 to this opportunity')).toBeTruthy();
    expect(screen.queryByText(/^Unsaved/)).toBeNull();
  });

  it('warns when the draft has drifted from the class on record', () => {
    renderPanel({ bidClass: 'C4', fteEstimate: 45, commitmentLevel: 'xhigh' });
    fireEvent.change(screen.getByLabelText('Team size (FTE)'), { target: { value: '2' } });
    expect(
      screen.getByText('Unsaved — this opportunity is still recorded as C4'),
    ).toBeTruthy();
  });

  it('offers only the gates the saved class actually runs', () => {
    // C1 runs Go/No-Go then Bid/No-Bid. Strategy Validation is a C4 gate and
    // the API 409s it — it must not be selectable here.
    renderPanel({ bidClass: 'C1', fteEstimate: 3, commitmentLevel: 'low' });
    expect(optionValues(gateSelect())).toEqual(['go_no_go', 'bid_no_bid']);
  });

  it('offers the C4 gate set for a C4 bid', () => {
    renderPanel({ bidClass: 'C4', fteEstimate: 45, commitmentLevel: 'xhigh' });
    expect(optionValues(gateSelect())).toEqual([
      'go_no_go',
      'strategy_validation',
      'proposal_review',
      'pricing_bid_validation',
    ]);
  });

  it('constrains outcomes to the selected gate and re-picks a valid one on switch', () => {
    // A `{ go_no_go, approved }` pair is rejected by the API because it maps to
    // no standing-decision signal, so the UI must never be able to compose it.
    renderPanel({ bidClass: 'C4', fteEstimate: 45, commitmentLevel: 'xhigh' });
    const outcome = screen.getByLabelText('Outcome') as HTMLSelectElement;
    expect(optionValues(outcome)).toEqual(['go', 'no_go']);

    fireEvent.change(gateSelect(), { target: { value: 'strategy_validation' } });
    const after = screen.getByLabelText('Outcome') as HTMLSelectElement;
    expect(optionValues(after)).toEqual(['approved', 'rejected']);
    expect(after.value).toBe('approved');
  });

  it('sends the gate and outcome the user picked', () => {
    renderPanel({ bidClass: 'C1', fteEstimate: 3, commitmentLevel: 'low' });
    fireEvent.change(gateSelect(), { target: { value: 'bid_no_bid' } });
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'no_bid' } });
    fireEvent.click(screen.getByText('Record gate decision'));
    expect(governanceMocks.recordMutate).toHaveBeenCalledWith(
      { gate: 'bid_no_bid', outcome: 'no_bid' },
      expect.anything(),
    );
  });

  it('hides both write actions without opportunities:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);
    renderPanel({ bidClass: 'C1', fteEstimate: 3, commitmentLevel: 'low' });
    expect(screen.queryByLabelText('Gate')).toBeNull();
    expect(screen.queryByText(/^Save C/)).toBeNull();
    expect(screen.getByText('You do not have permission to change this')).toBeTruthy();
  });

  it('renders the governance record, labelling the system handoff row', () => {
    // bid_office_handoff is written by the stage-transition route, not a human.
    // It has no entry in the gate vocabulary, so it used to render as the raw
    // key with an unknown outcome.
    governanceMocks.gateItems = [
      {
        id: 'g1',
        opportunityId: 'opp-1',
        gate: 'bid_office_handoff',
        outcome: 'activated',
        bidClass: 'C1',
        decidedById: null,
        decidedByRole: 'Bid Office',
        justification: null,
        decidedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'g2',
        opportunityId: 'opp-1',
        gate: 'go_no_go',
        outcome: 'no_go',
        bidClass: 'C1',
        decidedById: null,
        decidedByRole: null,
        justification: 'Out of scope',
        decidedAt: '2026-08-02T00:00:00.000Z',
      },
    ];
    renderPanel({ bidClass: 'C1', fteEstimate: 3, commitmentLevel: 'low' });
    // Scoped to the record block: "No-Go" is also an option in the outcome
    // select, so an unscoped query matches two nodes.
    const history = within(screen.getByText('Governance record').parentElement!);
    expect(history.getByText('Presales → Bid Office handoff')).toBeTruthy();
    expect(history.getByText('No-Go')).toBeTruthy();
    expect(history.getByText('— Out of scope')).toBeTruthy();
  });

  it('shows an empty state when nothing has been signed off yet', () => {
    renderPanel({ bidClass: 'C1', fteEstimate: 3, commitmentLevel: 'low' });
    expect(screen.getByText('No gate decisions recorded yet.')).toBeTruthy();
  });

  it('does not invent a class on an unclassified demo bid', () => {
    // Siemens and the rest of the demo book store no bid class, no FTE, and
    // no commitment. The panel used to open on 5 FTE × medium and paint that
    // result as if it were the bid. A larger placeholder used to read as C3.
    // C3 stays off this screen. The scratch calculator (no deal selected)
    // is a different surface and is not this case.
    renderPanel({ bidClass: null, fteEstimate: null, commitmentLevel: null });

    expect(screen.getByText(/no class yet/i)).toBeTruthy();
    expect(screen.queryByText('C0')).toBeNull();
    expect(screen.queryByText('C1')).toBeNull();
    expect(screen.queryByText('C2')).toBeNull();
    expect(screen.queryByText('C3')).toBeNull();
    expect(screen.queryByText('C4')).toBeNull();
    expect(screen.queryByText(/^Save C/)).toBeNull();
    expect(screen.queryByLabelText('Gate')).toBeNull();
    expect((screen.getByLabelText('Team size (FTE)') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('previews a class only after team size and commitment are entered', () => {
    renderPanel({ bidClass: null, fteEstimate: null, commitmentLevel: null });
    fireEvent.change(screen.getByLabelText('Team size (FTE)'), { target: { value: '2' } });
    expect(screen.queryByText(/^Save C/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Low' }));
    // 2 FTE × low is a small bid. The preview must not be the deleted C3 placeholder.
    expect(screen.getByText('Save C1 to this opportunity')).toBeTruthy();
    expect(screen.queryByText('C3')).toBeNull();
    expect(screen.queryByLabelText('Gate')).toBeNull();
  });

  it('keeps the scratch calculator when no deal is selected', () => {
    renderPanel(null, null);
    expect(screen.getByText('C1')).toBeTruthy();
    expect(screen.queryByText('C3')).toBeNull();
    expect(screen.getByText(/Select an opportunity above/)).toBeTruthy();
  });
});
