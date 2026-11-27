// A paused or in-flight technology stack read has no payload yet. The wall
// said no technology was detected. That read has not arrived, and an empty
// wall is not a settled miss.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    refetch: vi.fn(),
  },
}));

vi.mock('@/hooks/useCompanyTechnicalStack', () => ({
  useCompanyTechnicalStack: () => hookMocks.query,
  useSaveCompanyTechnicalStack: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

import { CompanyTechStackSection } from './CompanyTechStackSection';

const CHECKING = 'Checking the technology stack. The stack has not arrived.';
const FAILED = 'Could not load technology stack';
const EMPTY = 'No technology detected yet';

function renderWall() {
  return render(<CompanyTechStackSection companyId="acct-1" />);
}

function loaded(label: string) {
  return {
    effectiveStack: [
      {
        label,
        items: [
          {
            name: 'Azure',
            source: 'manual',
            confidence: 0,
            evidence: { record: '', url: null, observedAt: null },
          },
        ],
      },
    ],
  };
}

describe('CompanyTechStackSection technology stack read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused stack read as empty', () => {
    // WHY: a paused first read has isLoading false and no payload. An empty
    // wall is a settled miss. This read has not arrived.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: false,
      status: 'pending',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText('Azure')).toBeNull();
    expect(screen.queryByTestId('tech-stack-wall')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight stack read as empty', () => {
    // WHY: a slow read also has no payload. An empty wall is not a settled
    // miss, and a skeleton is not the status that the stack has not arrived.
    hookMocks.query = {
      data: undefined,
      isLoading: true,
      isError: false,
      status: 'pending',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText('Azure')).toBeNull();
    expect(screen.queryByTestId('tech-stack-wall')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed stack read on the error', () => {
    // WHY: a failed read is not evidence that the account has no technology.
    // The error stays, and an empty wall does not stand in for the read.
    hookMocks.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByTestId('tech-stack-wall')).toBeNull();
  });

  it('lets a failed read win over a stale technology', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Azure on screen from a stack that is no longer the read.
    hookMocks.query = {
      data: loaded('Cloud'),
      isLoading: false,
      isError: true,
      status: 'error',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Azure')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByTestId('tech-stack-wall')).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: a status of error is a failed read even if isError has not flipped.
    // Undefined is not required for that failure, and a stale technology must
    // not stay.
    hookMocks.query = {
      data: loaded('Cloud'),
      isLoading: false,
      isError: false,
      status: 'error',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Azure')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled read has a null payload', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and the wall stays empty.
    hookMocks.query = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Azure')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled read has no technologies', () => {
    // WHY: a settled empty stack is an honest miss. Unread must not look like
    // that miss, and a real miss must stay.
    hookMocks.query = {
      data: { effectiveStack: [] },
      isLoading: false,
      isError: false,
      status: 'success',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByTestId('tech-stack-wall')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded technology, including a blank category and a zero confidence', () => {
    // WHY: a loaded stack stays. A blank category label is a real field. A
    // confidence of zero is a real score. Unread must not replace either.
    hookMocks.query = {
      data: loaded(''),
      isLoading: false,
      isError: false,
      status: 'success',
      refetch: vi.fn(),
    };
    renderWall();

    expect(screen.getByTestId('tech-stack-wall')).toBeTruthy();
    expect(screen.getByText('Azure')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(document.querySelector('h4')?.textContent).toBe('');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
