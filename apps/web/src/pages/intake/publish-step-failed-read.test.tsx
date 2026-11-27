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
}));

import { PublishStep } from './PublishStep';

function unreadIntel(state: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  data?: { solutions: unknown[]; products: unknown[] };
}) {
  hookMocks.useAccountIntel.mockReturnValue(state);
}

describe('PublishStep unread counts', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a count that has not arrived a live zero', () => {
    // The publish step opens before account intel returns. A zero live line
    // would tell the operator the publish wrote nothing.
    unreadIntel({ isPending: true, isError: false, isSuccess: false });

    render(<PublishStep accountId="acct-1" onBack={vi.fn()} onDone={vi.fn()} />);

    expect(screen.getByText('Checking the published counts.')).toBeTruthy();
    expect(screen.queryByText(/are now live/)).toBeNull();
    expect(screen.queryByText(/0 solutions/)).toBeNull();
  });

  it('does not call a failed read a live zero', () => {
    // A failed read has no saved counts. Zero live would look like an empty publish.
    unreadIntel({ isPending: false, isError: true, isSuccess: false });

    render(<PublishStep accountId="acct-1" onBack={vi.fn()} onDone={vi.fn()} />);

    expect(
      screen.getByText('Could not load the published counts. The saved counts have not arrived.'),
    ).toBeTruthy();
    expect(screen.queryByText(/are now live/)).toBeNull();
    expect(screen.queryByText(/0 solutions/)).toBeNull();
  });

  it('keeps a loaded empty publish at zero live', () => {
    unreadIntel({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { solutions: [], products: [] },
    });

    render(<PublishStep accountId="acct-1" onBack={vi.fn()} onDone={vi.fn()} />);

    expect(
      screen.getByText('0 solutions and 0 products are now live on the account cockpit.'),
    ).toBeTruthy();
  });

  it('keeps a loaded solution on the publish step', () => {
    unreadIntel({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { solutions: [{ id: 'sol-1' }], products: [] },
    });

    render(<PublishStep accountId="acct-1" onBack={vi.fn()} onDone={vi.fn()} />);

    expect(
      screen.getByText('1 solution and 0 products are now live on the account cockpit.'),
    ).toBeTruthy();
  });
});
