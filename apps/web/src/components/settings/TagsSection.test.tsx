import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useTags: vi.fn(),
  useCreateTag: vi.fn(),
  useUpdateTag: vi.fn(),
  useDeleteTag: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useTags', () => ({
  useTags: hookMocks.useTags,
  useCreateTag: hookMocks.useCreateTag,
  useUpdateTag: hookMocks.useUpdateTag,
  useDeleteTag: hookMocks.useDeleteTag,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { TagsSection } from './TagsSection';

describe('TagsSection loading state', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // WHY: the design system standardizes on the shared bs-shimmer skeleton for
  // content loading — a bare "Loading…" string here breaks the app-wide
  // "layout-matched skeleton" convention (PageSkeletons.tsx doc comment).
  it('renders shimmer rows instead of a raw "Loading…" string while tags load', () => {
    hookMocks.useTags.mockReturnValue({ data: undefined, isLoading: true });
    hookMocks.useCreateTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hookMocks.useUpdateTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hookMocks.useDeleteTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    const { container } = render(<TagsSection />);

    expect(screen.queryByText('Loading…')).toBeNull();
    expect(container.querySelectorAll('.bs-shimmer').length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
