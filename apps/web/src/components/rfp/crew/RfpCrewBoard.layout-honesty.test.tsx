// The crew board merges a saved station map over the roster. Until that map
// arrives, the lanes are not a settled arrangement. A paused read has no
// payload and isLoading is false, so the board paints the default roles.
// An empty lane then says "Drop an agent here" only after the map arrives
// and leaves the lane empty. Hiding the board, or saying the crew is empty,
// is the same lie: the read has not happened.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';

import { RfpCrewBoard } from './RfpCrewBoard';

const pipeline = vi.hoisted(() => ({
  stage: 'extracting' as string,
  bidWorkspaceId: 'ws-demo-1' as string | null,
}));

const layout = vi.hoisted(() => ({
  data: undefined as { layout: Record<string, string> | null } | undefined,
  isPending: true,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
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
const FAILED = 'Could not read the crew layout.';
const ANALYST = 'Requirements Analyst';
const DRAG = /Drag an agent to re-assign its stage/;
const EMPTY_LIE = /empty crew|missing board|no agents|No crew/i;

function setLayout(next: Partial<typeof layout>) {
  layout.data = undefined;
  layout.isPending = false;
  layout.isLoading = false;
  layout.isFetching = false;
  layout.isPaused = false;
  layout.isError = false;
  layout.fetchStatus = 'idle';
  layout.error = null;
  Object.assign(layout, next);
}

function expectBoardPresent() {
  expect(screen.getByRole('heading', { name: 'Bid Crew' })).toBeTruthy();
}

function expectNotEmptyOrMissing() {
  expect(screen.queryByText('Drop an agent here')).toBeNull();
  expect(screen.queryByText('crew.dropHere')).toBeNull();
  expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  expect(screen.queryByText(ANALYST)).toBeNull();
  expect(screen.queryByText(DRAG)).toBeNull();
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
          subtitle:
            'Your role-based agents working this RFP, stage by stage. Drag an agent to re-assign its stage.',
          dropHere: 'Drop an agent here',
          layoutChecking: 'Checking the crew layout. It has not arrived.',
          layoutFailed: 'Could not read the crew layout.',
        },
      },
      true,
      true,
    );
    pipeline.stage = 'extracting';
    pipeline.bidWorkspaceId = 'ws-demo-1';
    setLayout({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread crew layout an empty crew', () => {
    // WHY: the demo board paints before the layout request starts. fetchStatus
    // is idle and isLoading is false, so the default roster looks like a crew
    // that was read and found waiting. That is not an empty lane and not a
    // missing board.
    setLayout({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    render(<RfpCrewBoard />);

    expectBoardPresent();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a paused crew layout an empty crew', () => {
    // WHY: a paused read (offline demo tab) has no station map. isLoading is
    // false because the fetch is not running. The default roles, or "Drop an
    // agent here", would say the stations are already known.
    setLayout({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    render(<RfpCrewBoard />);

    expectBoardPresent();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight crew layout an empty crew', () => {
    // WHY: the first fetch is the same unread map. A skeleton of default
    // roles, or "Drop an agent here", is not a layout that has arrived, and
    // removing the board would say it is missing.
    setLayout({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    render(<RfpCrewBoard />);

    expectBoardPresent();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a failed crew layout a missing board', () => {
    // WHY: a failed crew-layout read is not a lane with nobody stationed and
    // not a board that disappeared. The default roster would hide the failure.
    setLayout({ isError: true, error: new Error('Crew layout unavailable') });
    render(<RfpCrewBoard />);

    expectBoardPresent();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('Crew layout unavailable')).toBeTruthy();
    expectNotEmptyOrMissing();
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
    expect(screen.getByText(DRAG)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded agent on the board', () => {
    // WHY: a saved map that arrived, including an empty object or a null map
    // that means "no moves", still shows the roster. The hold is only for a
    // map that has not arrived. A null payload must not say the crew is empty.
    setLayout({ data: { layout: {} } });
    render(<RfpCrewBoard />);

    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.getByText(DRAG)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();

    cleanup();
    setLayout({ data: { layout: null } });
    render(<RfpCrewBoard />);

    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  });

  it('keeps a loaded layout when a later read fails', () => {
    // WHY: a refresh that fails does not erase stations already on screen.
    // The failure sentence is for a read that never arrived.
    setLayout({
      data: { layout: {} },
      isError: true,
      isFetching: false,
      error: new Error('Crew layout unavailable'),
    });
    render(<RfpCrewBoard />);

    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Crew layout unavailable')).toBeNull();
  });

  it('keeps the local roster when there is no workspace read', () => {
    // WHY: without a workspace id the layout query never starts. The roster
    // is the local board, not an unread server map and not a missing board.
    pipeline.bidWorkspaceId = null;
    setLayout({ isPending: true, isPaused: true, fetchStatus: 'paused' });
    render(<RfpCrewBoard />);

    expectBoardPresent();
    expect(screen.getByText(ANALYST)).toBeTruthy();
    expect(screen.getByText(DRAG)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
