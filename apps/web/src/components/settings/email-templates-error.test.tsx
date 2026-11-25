// Demo settings open the template list before any template is drawn. A failed
// read has no rows. That is not an empty list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useEmailTemplates: vi.fn(),
  useCreateEmailTemplate: vi.fn(),
  useUpdateEmailTemplate: vi.fn(),
  useDeleteEmailTemplate: vi.fn(),
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

vi.mock('@/hooks/useEmailTemplates', () => ({
  useEmailTemplates: hookMocks.useEmailTemplates,
  useCreateEmailTemplate: hookMocks.useCreateEmailTemplate,
  useUpdateEmailTemplate: hookMocks.useUpdateEmailTemplate,
  useDeleteEmailTemplate: hookMocks.useDeleteEmailTemplate,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { EmailTemplatesSection } from './EmailTemplatesSection';

function idleMutations() {
  hookMocks.useCreateEmailTemplate.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.useUpdateEmailTemplate.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.useDeleteEmailTemplate.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
}

describe('email templates when the read does not return rows', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a failed template read an empty list', () => {
    // WHY: demo settings can open the list before it returns. A failed read
    // has no rows. Saying "No templates yet" invites a new template on top of
    // a list the screen never showed.
    const refetch = vi.fn();
    idleMutations();
    hookMocks.useEmailTemplates.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<EmailTemplatesSection />);

    expect(screen.queryByText('No templates yet')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load email templates')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New template' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still says the list is empty once a loaded page has no templates', () => {
    idleMutations();
    hookMocks.useEmailTemplates.mockReturnValue({
      data: { items: [], pageContinues: false },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<EmailTemplatesSection />);

    expect(screen.getByText('No templates yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New template' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a template the loaded page returned', () => {
    idleMutations();
    hookMocks.useEmailTemplates.mockReturnValue({
      data: {
        items: [
          {
            id: 'tmpl-sample-follow-up',
            name: 'Sample follow-up',
            subject: 'Hello from the sample book',
            bodyHtml: '<p>Hi</p>',
            category: null,
          },
        ],
        pageContinues: false,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<EmailTemplatesSection />);

    expect(screen.getByText('Sample follow-up')).toBeTruthy();
    expect(screen.queryByText('No templates yet')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
