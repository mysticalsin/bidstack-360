import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useAccountIntel: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: hookMocks.useAccountIntel,
  useDeleteSolution: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewStep } from './ReviewStep';

function unreadIntel(state: {
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  data?: { solutions: unknown[]; products: unknown[] };
}) {
  hookMocks.useAccountIntel.mockReturnValue({ refetch: vi.fn(), ...state });
}

describe('ReviewStep unread extractions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a read that has not arrived an empty extract', () => {
    // The review step opens before account intel returns. An empty count
    // would tell the operator the extraction wrote nothing.
    unreadIntel({ isPending: true, isLoading: false, isError: false, isSuccess: false });

    render(<ReviewStep accountId="acct-1" onNext={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText('Checking the extracted data.')).toBeTruthy();
    expect(screen.queryByText(/No solutions extracted/)).toBeNull();
    expect(screen.queryByText(/Solutions \(0\)/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish →' })).toBeNull();
  });

  it('does not call a failed read an empty extract', () => {
    // A failed read has no saved extractions. Zero extracted would look like a finished empty review.
    unreadIntel({ isPending: false, isLoading: false, isError: true, isSuccess: false });

    render(<ReviewStep accountId="acct-1" onNext={vi.fn()} onBack={vi.fn()} />);

    expect(
      screen.getByText('Could not load the extracted data. The saved extractions have not arrived.'),
    ).toBeTruthy();
    expect(screen.queryByText(/No solutions extracted/)).toBeNull();
    expect(screen.queryByText(/Solutions \(0\)/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish →' })).toBeNull();
  });

  it('keeps a loaded empty review at zero extracted', () => {
    unreadIntel({
      isPending: false,
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: { solutions: [], products: [] },
    });

    render(<ReviewStep accountId="acct-1" onNext={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText('No solutions extracted.')).toBeTruthy();
    expect(screen.getByText('No products extracted.')).toBeTruthy();
    expect(screen.getByText('Solutions (0)')).toBeTruthy();
    expect(screen.getByText('Products (0)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish →' })).toBeTruthy();
  });

  it('keeps a loaded solution on the review step', () => {
    unreadIntel({
      isPending: false,
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: {
        solutions: [
          { id: 'sol-1', name: 'Atlas', description: 'Core platform', confidenceBps: 8000 },
        ],
        products: [],
      },
    });

    render(<ReviewStep accountId="acct-1" onNext={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText('Atlas')).toBeTruthy();
    expect(screen.getByText('Solutions (1)')).toBeTruthy();
    expect(screen.getByText('No products extracted.')).toBeTruthy();
  });
});
