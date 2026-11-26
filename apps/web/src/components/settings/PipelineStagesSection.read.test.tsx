// A paused or failed pipeline-stage read has no list yet. The settings
// section used the same "No pipeline stages" line as a settled empty list,
// and it promised the API would create the default pipeline. That list has
// not arrived, so empty and default are not findings.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { usePipelineStages } from '@/hooks/usePipelineStages';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(),
  usePatchPipelineStage: () => ({
    isPending: false,
    variables: undefined,
    mutateAsync: vi.fn(),
  }),
}));

import { usePipelineStages as usePipelineStagesMock } from '@/hooks/usePipelineStages';
import { PipelineStagesSection } from './PipelineStagesSection';

const CHECKING = 'Checking pipeline stages. The list has not arrived.';
const EMPTY = 'No pipeline stages';
const DEFAULT_PIPELINE =
  'The API will create the default pipeline for this workspace on refresh.';
const FAILED = 'Could not load pipeline stages';
const STAGE_NAME = 'S1 Lead';

type StagesQuery = ReturnType<typeof usePipelineStages>;

function stagesQuery(partial: Partial<StagesQuery>): StagesQuery {
  return {
    refetch: vi.fn(),
    error: null,
    ...partial,
  } as StagesQuery;
}

function renderSection(stages: StagesQuery) {
  vi.mocked(usePipelineStagesMock).mockReturnValue(stages);
  return render(<PipelineStagesSection />);
}

function expectNoSettledEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(DEFAULT_PIPELINE)).toBeNull();
  expect(screen.queryByDisplayValue(STAGE_NAME)).toBeNull();
}

const LOADED_STAGE = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 's1_lead',
  name: STAGE_NAME,
  orderIndex: 0,
  probability: 10,
  forecastCategory: 'pipeline',
  isWon: false,
  isLost: false,
  color: '#3b82f6',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PipelineStagesSection unread list', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(usePipelineStagesMock).mockReset();
  });

  it('does not call a paused pipeline stage read an empty default list', async () => {
    // WHY: a paused first read has isLoading false and no payload. The
    // section said No pipeline stages and that the API would create the
    // default pipeline, while the list has not arrived.
    renderSection(
      stagesQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight pipeline stage read an empty default list', async () => {
    // WHY: a slow read showed only a skeleton. A list that has not arrived
    // is not a workspace with no stages and no default pipeline.
    renderSection(
      stagesQuery({
        data: undefined,
        isError: false,
        isLoading: true,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a failed pipeline stage read an empty default list', async () => {
    // WHY: a failed read is not evidence that the workspace has no stages.
    // status error with isError still false used to fall through to the
    // empty default copy. The error stays, and the list does not say empty.
    renderSection(
      stagesQuery({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('offline'),
      }),
    );

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(DEFAULT_PIPELINE)).toBeNull();
    expect(screen.queryByDisplayValue(STAGE_NAME)).toBeNull();
  });

  it('still shows a settled list that has no pipeline stages', async () => {
    // WHY: a list that arrived with no stages is empty. That sentence stays,
    // including the default-pipeline note, so a real empty catalog is not
    // dressed up as a slow network.
    renderSection(
      stagesQuery({
        data: { items: [], pageContinues: false },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(DEFAULT_PIPELINE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a stage that has arrived', async () => {
    // WHY: a loaded stage stays on the list. The unread line must not
    // replace a stage the read already returned.
    renderSection(
      stagesQuery({
        data: { items: [LOADED_STAGE], pageContinues: false },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByDisplayValue(STAGE_NAME)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(DEFAULT_PIPELINE)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
