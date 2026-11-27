// The stage-pipeline mini treats a missing report the same as a settled
// empty list: both return nothing. A paused or in-flight read has no bars
// yet. Blank is not "the list has not arrived", and a failed read is not an
// empty pipeline. A list that arrived with no stages still says empty.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => {
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            whileHover: _whileHover,
            transition: _transition,
            ...domProps
          } = rest as Record<string, unknown>;
          return <div {...domProps}>{children}</div>;
        },
    },
  ),
}));

import { PipelineByStageMini } from './PipelineByStageMini';

const UNREAD = 'Checking pipeline by stage. The list has not arrived.';
const FAILED = 'Pipeline by stage did not load.';
const EMPTY = 'The pipeline list is empty.';
const HEADING = 'Pipeline by stage';
const STAGE = 's2 discovery';

const LOADED = {
  byStage: [{ stage: 's2_discovery', count: 3, valueSum: 1200 }],
};

function renderMini(
  report: { byStage: Array<{ stage: string; count: number; valueSum: number }> } | undefined,
  read: { isError?: boolean; status?: string; fetchStatus?: string } = {},
) {
  return render(
    <PipelineByStageMini
      report={report}
      reduced
      status={read.status}
      fetchStatus={read.fetchStatus}
      isError={read.isError}
    />,
  );
}

function expectNoSettledList() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(STAGE)).toBeNull();
  expect(screen.queryByText(/3 ·/)).toBeNull();
}

describe('PipelineByStageMini unread list', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not leave a paused pipeline read blank', async () => {
    // WHY: a paused first read has no payload. The mini returned null, the
    // same blank as a settled empty list, while the list has not arrived.
    renderMini(undefined, { isError: false, status: 'pending', fetchStatus: 'paused' });

    expect(await screen.findByText(UNREAD)).toBeTruthy();
    expect(screen.getByText(HEADING)).toBeTruthy();
    expectNoSettledList();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not leave an in-flight pipeline read blank', async () => {
    // WHY: a slow read also has no bars yet. Blank is not a pipeline that
    // arrived empty, and it is not a failed load.
    renderMini(undefined, { isError: false, status: 'pending', fetchStatus: 'fetching' });

    expect(await screen.findByText(UNREAD)).toBeTruthy();
    expect(screen.getByText(HEADING)).toBeTruthy();
    expectNoSettledList();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not leave a failed pipeline read blank or empty', async () => {
    // WHY: status error with isError still false used to return null. A
    // failed read did not load. It is not an empty list.
    renderMini(undefined, { isError: false, status: 'error' });

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.getByText(HEADING)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expectNoSettledList();
  });

  it('still says a settled list with no stages is empty', async () => {
    // WHY: a payload that arrived with no stages is empty. That sentence
    // stays, so a real empty list is not dressed up as a slow network.
    renderMini({ byStage: [] }, { isError: false, status: 'success' });

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(HEADING)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(STAGE)).toBeNull();
  });

  it('still shows a stage that has arrived', async () => {
    // WHY: a loaded stage stays on the card, including when a later refresh
    // reports an error. The unread and empty lines must not replace bars the
    // read already returned.
    renderMini(LOADED, { isError: true, status: 'error' });

    expect(await screen.findByText(STAGE)).toBeTruthy();
    expect(screen.getByText(HEADING)).toBeTruthy();
    expect(screen.getByText(/3 ·/)).toBeTruthy();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});
