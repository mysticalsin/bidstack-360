// A paused or in-flight factor read has no score yet. The panel rendered
// nothing, or only a skeleton, which looks off. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const scoreMocks = vi.hoisted(() => ({
  useLeadScore: vi.fn(),
  useOppScore: vi.fn(),
}));

vi.mock('@/hooks/usePredictiveScore', () => ({
  useLeadScore: scoreMocks.useLeadScore,
  useOppScore: scoreMocks.useOppScore,
}));

import { ScoreFactorsPanel } from './ScoreFactorsPanel';

const CHECKING = 'Checking the score factors. The factors have not arrived.';
const FAILED = 'Could not load the score factors.';

interface Factor {
  feature: string;
  contribution: number;
}

interface LeadPayload {
  score: number;
  factors: Factor[];
  modelVersion: string;
  scoredAt: string;
}

interface OppPayload {
  winProbability: number;
  predictedCloseDate: string | null;
  factors: Factor[];
  recommendation: string;
  modelVersion: string;
  scoredAt: string;
}

interface QuerySnap {
  data?: LeadPayload | OppPayload | null;
  isLoading: boolean;
  isError: boolean;
  status?: string;
}

const PENDING: QuerySnap = {
  data: undefined,
  isLoading: false,
  isError: false,
  status: 'pending',
};

const BUDGET: Factor = { feature: 'bant_budget', contribution: 0.2 };

function leadPayload(score: number, factors: Factor[] = [BUDGET]): LeadPayload {
  return {
    score,
    factors,
    modelVersion: '4',
    scoredAt: '2026-01-01T00:00:00.000Z',
  };
}

function oppPayload(winProbability: number, recommendation = 'Push the demo'): OppPayload {
  return {
    winProbability,
    predictedCloseDate: null,
    factors: [BUDGET],
    recommendation,
    modelVersion: '4',
    scoredAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPanel(
  entityType: 'lead' | 'opportunity',
  active: QuerySnap,
) {
  scoreMocks.useLeadScore.mockReturnValue(entityType === 'lead' ? active : PENDING);
  scoreMocks.useOppScore.mockReturnValue(entityType === 'opportunity' ? active : PENDING);
  return render(<ScoreFactorsPanel entityType={entityType} entityId="demo-1" />);
}

function expectUnread() {
  expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  expect(screen.queryByText('ML Score Analysis')).toBeNull();
  expect(screen.queryByLabelText('Loading score factors')).toBeNull();
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
}

describe('ScoreFactorsPanel read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused factor read as off', () => {
    // WHY: a paused first read has isLoading false and no payload. An absent
    // panel looks off. The factors have not arrived.
    renderPanel('lead', { data: undefined, isLoading: false, isError: false, status: 'pending' });

    expectUnread();
    expect(screen.queryByText('Budget')).toBeNull();
  });

  it('does not treat an in-flight factor read as off', () => {
    // WHY: a slow read also has no payload. A skeleton with no status is not
    // a settled score, and it is not a failed load.
    renderPanel('lead', { data: undefined, isLoading: true, isError: false, status: 'pending' });

    expectUnread();
  });

  it('keeps a failed factor read on the error', () => {
    // WHY: a failed read is not evidence that the record has no factors. The
    // error stays, and a missing panel does not stand in for the read.
    renderPanel('lead', { data: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('ML Score Analysis')).toBeNull();
    expect(screen.queryByLabelText('Loading score factors')).toBeNull();
  });

  it('lets a failed read win over a stale score', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing 81 from a score that is no longer the read.
    renderPanel('lead', {
      data: leadPayload(81),
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText('ML Score Analysis')).toBeNull();
    expect(screen.queryByText(/Lead Score:\s*81/)).toBeNull();
    expect(screen.queryByText('Budget')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled read has no score', () => {
    // WHY: a read that arrived without a score stays empty. A slow network
    // must not be dressed up as an empty score, and this one must.
    renderPanel('lead', { data: null, isLoading: false, isError: false, status: 'success' });

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText('ML Score Analysis')).toBeNull();
  });

  it('still shows the panel when the lead score has arrived', () => {
    // WHY: a loaded score stays. The unread line must not replace a number
    // the read already returned.
    renderPanel('lead', {
      data: leadPayload(64),
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('ML Score Analysis')).toBeTruthy();
    expect(screen.getByText(/Lead Score:\s*64/)).toBeTruthy();
    expect(screen.getAllByText('Budget').length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a settled lead score of zero', () => {
    // WHY: zero is a loaded score. Unread must not look like zero, and a
    // real zero must not look unread or off.
    renderPanel('lead', {
      data: leadPayload(0, []),
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('ML Score Analysis')).toBeTruthy();
    expect(screen.getByText(/Lead Score:\s*0/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat a paused opportunity factor read as off', () => {
    // WHY: the opportunity read is a separate query. A pause on that query
    // is still unread, even when the lead query is idle.
    renderPanel('opportunity', {
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
    });

    expectUnread();
    expect(screen.queryByText(/Win Probability/)).toBeNull();
  });

  it('lets a failed opportunity read win over a stale score', () => {
    // WHY: error wins for the opportunity query too. A stale recommendation
    // must not stay on screen after the read fails.
    renderPanel('opportunity', {
      data: oppPayload(42, 'Push the demo'),
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText('Push the demo')).toBeNull();
    expect(screen.queryByText(/Win Probability:\s*42/)).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the panel when the opportunity score has arrived', () => {
    // WHY: a loaded opportunity score stays. The checking line must not
    // replace a probability the read already returned.
    renderPanel('opportunity', {
      data: oppPayload(42, 'Push the demo'),
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('ML Score Analysis')).toBeTruthy();
    expect(screen.getByText(/Win Probability:\s*42/)).toBeTruthy();
    expect(screen.getByText('Push the demo')).toBeTruthy();
    expect(screen.getAllByText('Budget').length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
