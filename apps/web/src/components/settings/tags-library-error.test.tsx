// Demo settings open the tag library before any tag is drawn. A failed read
// has no rows. That is not an empty library, and it is not a count of zero.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
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

vi.mock('framer-motion', () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            whileHover: _whileHover,
            whileTap: _whileTap,
            variants: _variants,
            layout: _layout,
            layoutId: _layoutId,
            ...dom
          } = rest;
          return createElement(tag, dom, children);
        },
    },
  );
  return { motion, useReducedMotion: () => true };
});

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

function idleMutations() {
  hookMocks.useCreateTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.useUpdateTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.useDeleteTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
}

describe('tag library when the read does not return rows', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a failed tag read an empty library', () => {
    // WHY: demo settings can open the library before the list returns. A
    // failed read has no rows. Saying "No tags yet" and counting 0 invites a
    // new tag on top of a library the screen never showed.
    const refetch = vi.fn();
    idleMutations();
    hookMocks.useTags.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<TagsSection />);

    expect(screen.queryByText('No tags yet')).toBeNull();
    expect(screen.queryByText('(0)')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load the tag library')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still says the library is empty once a loaded list has no tags', () => {
    idleMutations();
    hookMocks.useTags.mockReturnValue({
      data: { items: [], pageContinues: false },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<TagsSection />);

    expect(screen.getByText('No tags yet')).toBeTruthy();
    expect(screen.getByText('(0)')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a tag the loaded list returned', () => {
    idleMutations();
    hookMocks.useTags.mockReturnValue({
      data: {
        items: [
          {
            id: 'tag-sample-office',
            name: 'Sample office',
            color: '#2563eb',
            usageCount: 1,
          },
        ],
        pageContinues: false,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<TagsSection />);

    expect(screen.getByText('Sample office')).toBeTruthy();
    expect(screen.queryByText('No tags yet')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
