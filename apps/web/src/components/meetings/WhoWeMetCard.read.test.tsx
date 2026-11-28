// A meeting list or challenge rollup that has not settled is not an account
// with nothing on file. "No meetings recorded" sends someone to connect a
// source. "No challenges captured yet" says the conversations were empty.
// Those sentences wait for a successful read. A later failure keeps the
// coverage and the challenges already on screen.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { WhoWeMetCard } from './WhoWeMetCard';

const reads = vi.hoisted(() => ({
  coverage: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  challenges: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  meetings: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));

vi.mock('@/hooks/useMeetingIntel', () => ({
  useCoverage: () => reads.coverage,
  useChallenges: () => reads.challenges,
  useMeetingList: () => reads.meetings,
}));

vi.mock('./LogMeetingDialog', () => ({
  LogMeetingDialog: () => null,
}));

const CI = 'c0000000-0000-4000-8000-000000000001';

function idle() {
  return {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  };
}

function coverageWithPeople() {
  return {
    groupId: CI,
    regions: ['CA'],
    seniorities: ['c_level'],
    windowDays: 365,
    cells: [
      {
        region: 'CA',
        seniority: 'c_level',
        meetings: 1,
        people: 1,
        lastMetAt: '2026-10-25T10:00:00Z',
      },
    ],
    gaps: [],
  };
}

function emptyCoverage() {
  return {
    groupId: CI,
    regions: [],
    seniorities: [],
    windowDays: 365,
    cells: [],
    gaps: [],
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <WhoWeMetCard companyId={CI} companyName="CI Financial" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  reads.coverage = idle();
  reads.challenges = idle();
  reads.meetings = idle();
});

describe('who we met before the reads settle', () => {
  it('does not say the account has no meetings while the meeting list is still loading', () => {
    // WHY: coverage can settle with nobody counted before the meeting list
    // returns. The empty sentence tells the reader to connect Métis. On the
    // demo book the meetings are already there.
    reads.coverage = { ...idle(), data: emptyCoverage() };
    reads.meetings = { ...idle(), isLoading: true };
    renderCard();

    expect(screen.queryByText(/No meetings recorded for this account yet/)).toBeNull();
    expect(screen.queryByText(/connect Métis or ABC/)).toBeNull();
    expect(screen.getByText('Loading meetings')).toBeTruthy();
  });

  it('says the meeting list failed instead of an empty account', () => {
    // WHY: a failed list is not "no meetings". Retry repeats that read.
    const refetch = vi.fn();
    reads.coverage = { ...idle(), data: emptyCoverage() };
    reads.meetings = { ...idle(), isError: true, refetch };
    renderCard();

    expect(screen.queryByText(/No meetings recorded for this account yet/)).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load meetings");
    const retry = within(alert).getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('mi-retry');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('says there are no meetings only after the list succeeds empty', () => {
    // WHY: empty is a real result. The connect hint belongs to that case.
    reads.coverage = { ...idle(), data: emptyCoverage() };
    reads.meetings = { ...idle(), data: { items: [], nextCursor: null } };
    reads.challenges = { ...idle(), data: { items: [] } };
    renderCard();

    expect(screen.getByText(/No meetings recorded for this account yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Loading meetings')).toBeNull();
  });

  it('does not say no challenges were captured while that read is still loading', () => {
    // WHY: the rollup sits beside a coverage map that already has people.
    // An empty challenge sentence makes those meetings look like they raised nothing.
    reads.coverage = { ...idle(), data: coverageWithPeople() };
    reads.meetings = {
      ...idle(),
      data: {
        items: [
          {
            id: 'm1',
            title: 'Cloud cost review',
            heldAt: '2026-10-25T10:00:00Z',
            companyName: 'CI Financial',
            topSeniority: 'c_level',
          },
        ],
        nextCursor: null,
      },
    };
    reads.challenges = { ...idle(), isLoading: true };
    renderCard();

    expect(screen.queryByText('No challenges captured yet.')).toBeNull();
    expect(screen.getByText('Loading challenges')).toBeTruthy();
    expect(screen.getByText('Cloud cost review')).toBeTruthy();
  });

  it('says the challenge read failed and retries that read', () => {
    const refetch = vi.fn();
    reads.coverage = { ...idle(), data: coverageWithPeople() };
    reads.meetings = {
      ...idle(),
      data: {
        items: [
          {
            id: 'm1',
            title: 'Cloud cost review',
            heldAt: '2026-10-25T10:00:00Z',
            companyName: 'CI Financial',
            topSeniority: 'c_level',
          },
        ],
        nextCursor: null,
      },
    };
    reads.challenges = { ...idle(), isError: true, refetch };
    renderCard();

    expect(screen.queryByText('No challenges captured yet.')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load challenges");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('says there are no challenges only after that read succeeds empty', () => {
    reads.coverage = { ...idle(), data: coverageWithPeople() };
    reads.meetings = {
      ...idle(),
      data: {
        items: [
          {
            id: 'm1',
            title: 'Cloud cost review',
            heldAt: '2026-10-25T10:00:00Z',
            companyName: 'CI Financial',
            topSeniority: 'c_level',
          },
        ],
        nextCursor: null,
      },
    };
    reads.challenges = { ...idle(), data: { items: [] } };
    renderCard();

    expect(screen.getByText('No challenges captured yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the coverage map and the challenges when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty account. The map and the
    // challenge already on screen stay.
    reads.coverage = { ...idle(), data: coverageWithPeople(), isError: true };
    reads.meetings = {
      ...idle(),
      isError: true,
      data: {
        items: [
          {
            id: 'm1',
            title: 'Cloud cost review',
            heldAt: '2026-10-25T10:00:00Z',
            companyName: 'CI Financial',
            topSeniority: 'c_level',
          },
        ],
        nextCursor: null,
      },
    };
    reads.challenges = {
      ...idle(),
      isError: true,
      data: {
        items: [
          {
            challenge: 'Cloud cost overruns',
            mentions: 2,
            regions: ['CA'],
            lastMentionedAt: '2026-10-25T10:00:00Z',
            meetingIds: ['m1'],
          },
        ],
      },
    };
    renderCard();

    expect(screen.queryByText(/Couldn't load meeting coverage/)).toBeNull();
    expect(screen.queryByText(/Couldn't load meetings/)).toBeNull();
    expect(screen.queryByText(/Couldn't load challenges/)).toBeNull();
    expect(screen.getByRole('button', { name: /CA, C-level: 1 person/ })).toBeTruthy();
    expect(screen.getByText('Cloud cost overruns')).toBeTruthy();
    expect(screen.getByText('Cloud cost review')).toBeTruthy();
  });
});
