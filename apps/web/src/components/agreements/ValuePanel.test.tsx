import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MsaValueItem } from '@bidstack/shared';

const hook = vi.hoisted(() => ({
  useMsaValuePanel: vi.fn(),
}));

vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaValuePanel: hook.useMsaValuePanel,
}));

import { ValuePanel } from './ValuePanel';

const MSA = 'a0000000-0000-4000-8000-000000000101';
const CHECKING = 'Checking value opportunities. They have not arrived.';
const FAILED = 'Could not load value opportunities.';
const REFRESH_FAILED = 'Could not refresh value opportunities.';
const EMPTY = 'No extra value items on this MSA right now.';
const BANNED = /unavailable|not found|none|empty|[\u2014\u2013]/i;

function item(): MsaValueItem {
  return {
    id: 'uncovered:it',
    kind: 'uncovered_service',
    title: 'IT is not in the current scope',
    detail: 'The MSA scope does not mention IT.',
    citation: { page: 2, clause: 'Clause 3', excerpt: 'does not include information technology' },
    absence: false,
    approach: null,
  };
}

function read(over: {
  isLoading?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
  data?: { msaId: string; items: MsaValueItem[] } | undefined;
}) {
  hook.useMsaValuePanel.mockReturnValue({
    isLoading: false,
    isError: false,
    isSuccess: false,
    data: undefined,
    error: null,
    ...over,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('agreement value panel read', () => {
  it('does not call a paused read unavailable or empty', () => {
    // WHY: A paused read has isLoading false and no payload. "Unavailable"
    // and "No extra value items" are only true after the read settles.
    read({ isLoading: false, isError: false, isSuccess: false, data: undefined });

    render(<ValuePanel msaId={MSA} />);

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(BANNED);
  });

  it('does not call an in-flight read unavailable', () => {
    read({ isLoading: true, isError: false, isSuccess: false, data: undefined });

    render(<ValuePanel msaId={MSA} />);

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(/Loading value opportunities/)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('does not call a failed read an empty value list', () => {
    // WHY: A failed read is unknown. "No extra value items" would tell a
    // seller this MSA has nothing to bring up.
    read({ isLoading: false, isError: true, isSuccess: false, data: undefined });

    render(<ValuePanel msaId={MSA} />);

    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });

  it('keeps a loaded item when a refresh fails', () => {
    read({
      isLoading: false,
      isError: true,
      isSuccess: false,
      data: { msaId: MSA, items: [item()] },
    });

    render(<ValuePanel msaId={MSA} />);

    expect(screen.getByText('IT is not in the current scope')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(REFRESH_FAILED);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });

  it('keeps a settled empty panel on the empty sentence', () => {
    read({
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: { msaId: MSA, items: [] },
    });

    render(<ValuePanel msaId={MSA} />);

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a loaded value item, including its clause cite', () => {
    read({
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: { msaId: MSA, items: [item()] },
    });

    render(<ValuePanel msaId={MSA} />);

    expect(screen.getByTestId('msa-value-panel')).toBeTruthy();
    expect(screen.getByText('IT is not in the current scope')).toBeTruthy();
    expect(screen.getByText('Cite: Clause 3, page 2')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
