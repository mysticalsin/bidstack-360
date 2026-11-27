// The crew board merges a saved station map over the roster. Until that map
// arrives, and when the read fails with nothing saved, the lanes are not a
// settled arrangement. "Drop an agent here" and the default roles would say
// the layout is already known.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';

import { RfpCrewBoard } from './RfpCrewBoard';

const pipeline = vi.hoisted(() => ({
  stage: 'idle',
  bidWorkspaceId: 'ws-demo-1' as string | null,
}));

const layout = vi.hoisted(() => ({
  data: undefined as { layout: Record<string, string> } | undefined,
  isPending: true,
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock('@/stores/rfpPipeline', () => ({
  useRfpPipelineStore: (selector: (state: typeof pipeline) => unknown) => selector(pipeline),
}));

vi.mock('@/hooks/rfp/useRfpCrewLayout', () => ({
  useRfpCrewLayout: () => ({
    query: layout,
    save: { mutate: vi.fn() },
  }),
}));

const CHECKING = 'Checking the crew layout. It has not arrived.';
const FAILED = 'The crew layout has not arrived.';
const ANALYST = 'Requirements Analyst';

function setLayout(next: Partial<typeof layout>) {
  layout.data = undefined;
  layout.isPending = false;
  layout.isLoading = false;
  layout.isError = false;
  layout.error = null;
  Object.assign(layout, next);
}

describe('RfpCrewBoard layout read', () => {
  beforeEach(async () => {
    // The test runner boots i18n with empty bundles. Seed the crew copy so
    // the assertions read the same sentences the English locale ships.
    await i18n.changeLanguage('en');
    i18n.addResourceBundle(
      'en',
      'rfp',
      {
        crew: {
          title: 'Bid Crew',
          subtitle: 'Roster',
          dropHere: 'Drop an agent here',
          layoutChecking: 'Checking the crew layout. It has not arrived.',
          layoutFailed: 'The crew layout has not arrived.',
        },
      },
      true,
      true,
    );
    pipeline.stage = 'idle';
    pipeline.bidWorkspaceId = 'ws-demo-1';
    setLayout({ isPending: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread crew layout an empty lane', () => {
    // WHY: a paused read has no station map. isLoading is false, so the
    // board used to paint the default roster. An empty lane then says
    // "Drop an agent here" as if that station were already known.
    setLayout({ isPending: true, isLoading: false });
    render(<RfpCrewBoard />);

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(ANALYST)).toBeNull();
    expect(screen.queryByText('Drop an agent here')).toBeNull();
    expect(screen.queryByText('crew.dropHere')).toBeNull();
  });

  it('does not call an in-flight crew layout an empty lane', () => {
    // WHY: the first fetch is the same unread map. A skeleton of default
    // roles, or "Drop an agent here", is not a layout that has arrived.
    setLayout({ isPending: true, isLoading: true });
    render(<RfpCrewBoard />);

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(ANALYST)).toBeNull();
    expect(screen.queryByText('Drop an agent here')).toBeNull();
    expect(screen.queryByText('crew.dropHere')).toBeNull();
  });

  it('does not call a failed crew layout an empty lane', () => {
    // WHY: a failed crew-layout read is not a lane with nobody stationed.
    // The default roster would hide the failure.
    setLayout({ isError: true, error: new Error('Crew layout unavailable') });
    render(<RfpCrewBoard />);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('Crew layout unavailable')).toBeTruthy();
    expect(screen.queryByText(ANALYST)).toBeNull();
    expect(screen.queryByText('Drop an agent here')).toBeNull();
    expect(screen.queryByText('crew.dropHere')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a settled empty lane empty', () => {
    // WHY: a layout that arrived and moved the analyst off Extracting really
    // is an empty lane. That drop hint is the station, not a missing payload.
    setLayout({
      data: { layout: { requirements_analyst: 'oversight' } },
    });
    render(<RfpCrewBoard />);

    expect(screen.getByText('Drop an agent here')).toBeTruthy();
    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded agent on the board', () => {
    // WHY: a saved map that arrived, including an empty object that means
    // "no moves", still shows the roster. The hold is only for a map that
    // has not arrived.
    setLayout({ data: { layout: {} } });
    render(<RfpCrewBoard />);

    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded layout when a later read fails', () => {
    // WHY: a refresh that fails does not erase stations already on screen.
    // The failure sentence is for a read that never arrived.
    setLayout({
      data: { layout: {} },
      isError: true,
      error: new Error('Crew layout unavailable'),
    });
    render(<RfpCrewBoard />);

    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Crew layout unavailable')).toBeNull();
  });

  it('keeps the local roster when there is no workspace read', () => {
    // WHY: without a workspace id the layout query never starts. The roster
    // is the local board, not an unread server map.
    pipeline.bidWorkspaceId = null;
    setLayout({ isPending: true });
    render(<RfpCrewBoard />);

    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
