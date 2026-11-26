// The account spotlight card asks for project references as soon as it mounts.
// Until that read arrives, an empty card is not a settled list. A paused or
// idle read has no payload and isLoading is false, so the card says
// "No references yet". An in-flight read is the same unread list. That
// sentence is for a list that arrived empty. It is not an empty list, and
// hiding the Project references heading would say the section is missing.
// Under demo synthetic data the list is not empty.
import type { ComponentProps, ElementType, ReactNode } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpotlightRefsCard } from './SpotlightRefsCard';

type SpotlightItem = {
  id: string;
  title: string;
  businessSummary: string | null;
  status: 'draft' | 'manager_review' | 'validated' | 'dispatched';
};

const refsRead = vi.hoisted(() => ({
  data: undefined as { items: SpotlightItem[] } | undefined,
  isPending: false,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  error: null as Error | null,
  refetch: vi.fn(() => Promise.resolve()),
}));

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

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<HTMLElement, ComponentProps<'div'> & { children?: ReactNode }>(
      ({ children, ...props }, ref) => {
        const { animate, initial, transition, whileHover, whileTap, variants, ...domProps } =
          props as Record<string, unknown>;
        void animate;
        void initial;
        void transition;
        void whileHover;
        void whileTap;
        void variants;
        return React.createElement(tag, { ...domProps, ref }, children);
      },
    );
    Component.displayName = `Motion${String(tag)}`;
    return Component;
  };

  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => motionComponent(tag),
      },
    ),
    useReducedMotion: () => true,
  };
});

vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

vi.mock('@/hooks/useUiSound', () => ({ useUiSound: () => () => undefined }));

vi.mock('@/hooks/useProjectReferences', () => ({
  useProjectReferences: () => refsRead,
  useValidateProjectReference: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Synthetic demo project reference. No person, no mailbox. The row is what
// the card shows once the read arrives. It must not be treated as absent
// before that.
const DEMO_TITLE = 'Demo Harbor rollout';

const CHECKING = 'Checking project references. They have not arrived.';
const FAILED_TITLE = 'Could not load references';
const EMPTY = 'No references yet';
const EMPTY_MESSAGE =
  'Validated references arrive from Spotlight Ref once a consultant submits and a manager approves them.';

function demoReference(): SpotlightItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: DEMO_TITLE,
    businessSummary: null,
    status: 'validated',
  };
}

function setRead(next: Partial<typeof refsRead>) {
  refsRead.data = undefined;
  refsRead.isPending = false;
  refsRead.isLoading = false;
  refsRead.isFetching = false;
  refsRead.isPaused = false;
  refsRead.isError = false;
  refsRead.fetchStatus = 'idle';
  refsRead.error = null;
  Object.assign(refsRead, next);
}

function renderCard() {
  return render(<SpotlightRefsCard accountKey="demo-harbor" />);
}

function expectListNotSettled() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByText(DEMO_TITLE)).toBeNull();
  expect(screen.queryByLabelText('Loading')).toBeNull();
}

describe('SpotlightRefsCard read', () => {
  beforeEach(() => {
    refsRead.refetch.mockClear();
    setRead({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread project reference list empty', () => {
    // WHY: the demo list paints before the request starts. fetchStatus is
    // idle and isLoading is false, so "No references yet" looks like a list
    // that was read and found clear. The synthetic Demo Harbor rollout has
    // not been read. That is not an empty list and not a missing section.
    setRead({ isPending: false, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderCard();

    expect(screen.getByRole('heading', { name: 'Project references' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expectListNotSettled();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call a paused project reference list empty', () => {
    // WHY: a paused read (offline demo tab) has no project references in
    // hand. isLoading is false because the fetch is not running. The empty
    // sentence would say the account already has no references, including
    // Demo Harbor rollout.
    setRead({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderCard();

    expect(screen.getByRole('heading', { name: 'Project references' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expectListNotSettled();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call an in-flight project reference list empty', () => {
    // WHY: the first fetch is the same unread list. A skeleton in an empty
    // card is not a result, and "No references yet" is a list that arrived
    // empty. Hiding the heading would say the section is missing.
    setRead({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderCard();

    expect(screen.getByRole('heading', { name: 'Project references' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expectListNotSettled();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call a failed project reference read an empty list', () => {
    // WHY: a failed read is not a list that has no project references and
    // not a section that disappeared. The empty sentence would hide the
    // failure. Retry is the way back to the read.
    setRead({ isError: true, error: new Error('References unavailable') });
    renderCard();

    expect(screen.getByRole('heading', { name: 'Project references' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_TITLE)).toBeTruthy();
    expect(screen.getByText('References unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refsRead.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(DEMO_TITLE)).toBeNull();
  });

  it('keeps a settled empty project reference list empty', () => {
    // WHY: a read that arrived with no project references really has nothing
    // on the account. That sentence is the result, not a payload that has
    // not arrived.
    setRead({ data: { items: [] } });
    renderCard();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText(DEMO_TITLE)).toBeNull();
  });

  it('keeps a loaded synthetic project reference on the card', () => {
    // WHY: a payload that arrived, including one demo Demo Harbor rollout
    // row, is the list. The hold is only for a read that has not arrived.
    setRead({ data: { items: [demoReference()] } });
    renderCard();

    expect(screen.getByRole('heading', { name: 'Project references' })).toBeTruthy();
    expect(screen.getByText(DEMO_TITLE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded list when a later read fails', () => {
    // WHY: a refresh that fails does not erase project references already on
    // screen. The failure sentence is for a read that never arrived.
    setRead({
      data: { items: [demoReference()] },
      isError: true,
      isFetching: false,
      error: new Error('References unavailable'),
    });
    renderCard();

    expect(screen.getByText(DEMO_TITLE)).toBeTruthy();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText('References unavailable')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
