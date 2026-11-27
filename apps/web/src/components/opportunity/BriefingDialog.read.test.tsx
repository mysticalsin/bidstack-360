import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Ask Dust opens the brief before POST /api/opportunities/:id/brief returns.
// A paused or in-flight read has no payload and isPending false. That must
// not look like a missing dialog, an empty brief, or a failed load.
const CHECKING = 'Checking the brief. It has not arrived.';
const FAILED = 'Could not load the brief.';
const EMPTY = 'No brief text was returned.';
const STALE = 'Northwind will renew the platform next quarter.';

const brief = vi.hoisted(() => ({
  current: {
    data: undefined as { brief: string; model: string; tokens: number } | null | undefined,
    isPending: false,
    isError: false,
    status: 'idle' as string,
    error: undefined as Error | undefined,
    mutate: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? _key;
      if (!vars) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: React.ElementType) => {
    const Component = React.forwardRef<HTMLElement, { children?: React.ReactNode }>(
      ({ children, ...props }, ref) => {
        const { animate, initial, layout, transition, variants, whileHover, whileTap, ...domProps } =
          props as Record<string, unknown>;
        void animate;
        void initial;
        void layout;
        void transition;
        void variants;
        void whileHover;
        void whileTap;
        return React.createElement(tag, { ...domProps, ref }, children);
      },
    );
    Component.displayName = `Motion${String(tag)}`;
    return Component;
  };
  return {
    motion: new Proxy({}, { get: (_target, tag: string) => motionComponent(tag) }),
    useReducedMotion: () => true,
  };
});

vi.mock('@/hooks/useOpportunityBrief', () => ({
  useOpportunityBrief: () => brief.current,
}));

import { BriefingDialog } from './BriefingDialog';

function unread(status: string, isPending = false) {
  brief.current = {
    data: undefined,
    isPending,
    isError: false,
    status,
    error: undefined,
    mutate: vi.fn(),
    reset: vi.fn(),
  };
}

function renderDialog() {
  return render(
    <BriefingDialog
      opportunityId="8d1c2d4f-09de-4c14-8f98-731e01bc36c9"
      opportunityLabel="Northwind renewal"
      open
      onOpenChange={vi.fn()}
    />,
  );
}

describe('opportunity brief read', () => {
  afterEach(() => {
    cleanup();
    unread('idle');
  });

  it('does not treat a paused brief as a missing dialog', () => {
    unread('idle');
    renderDialog();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Brief: Northwind renewal' })).toBeTruthy();
  });

  it('does not treat an in-flight brief as a missing dialog when isPending is false', () => {
    unread('pending', false);
    renderDialog();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('does not treat an in-flight brief as only a skeleton', () => {
    unread('pending', true);
    renderDialog();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a failed brief on the error when isError is true', () => {
    brief.current = {
      data: undefined,
      isPending: false,
      isError: true,
      status: 'error',
      error: new Error('offline'),
      mutate: vi.fn(),
      reset: vi.fn(),
    };
    renderDialog();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('drops a stale brief when the status is error and isError is still false', () => {
    brief.current = {
      data: { brief: STALE, model: 'stub', tokens: 12 },
      isPending: false,
      isError: false,
      status: 'error',
      error: undefined,
      mutate: vi.fn(),
      reset: vi.fn(),
    };
    renderDialog();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('treats a settled null payload as an empty brief', () => {
    brief.current = {
      data: null,
      isPending: false,
      isError: false,
      status: 'success',
      error: undefined,
      mutate: vi.fn(),
      reset: vi.fn(),
    };
    renderDialog();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('still shows a brief that arrived', () => {
    brief.current = {
      data: { brief: STALE, model: 'stub', tokens: 12 },
      isPending: false,
      isError: false,
      status: 'success',
      error: undefined,
      mutate: vi.fn(),
      reset: vi.fn(),
    };
    renderDialog();
    expect(screen.getByText(STALE)).toBeTruthy();
    expect(screen.getByText('Model stub · 12 tokens')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a brief when the text is blank', () => {
    brief.current = {
      data: { brief: '', model: 'stub', tokens: 0 },
      isPending: false,
      isError: false,
      status: 'success',
      error: undefined,
      mutate: vi.fn(),
      reset: vi.fn(),
    };
    renderDialog();
    expect(screen.getByLabelText('Brief content')).toBeTruthy();
    expect(screen.getByText('Model stub · 0 tokens')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
