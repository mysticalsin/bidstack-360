import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Linked contacts are a React Query read. A paused or in-flight read has no
// payload and isLoading false. That must not look like zero contacts or an
// empty book. A failed read must not keep a stale contact.
const CHECKING = 'Checking linked contacts. The list has not arrived.';
const FAILED = 'Could not load linked contacts.';
const EMPTY = 'No linked contacts';
const ZERO = '0 contacts';
const LINK = '+ Link contact';

const linked = vi.hoisted(() => ({
  current: {
    data: undefined as { items: Array<Record<string, unknown>>; contactsContinue?: boolean } | null | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'paused' as string,
    error: undefined as Error | undefined,
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
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<HTMLElement, ComponentProps<'div'> & { children?: ReactNode }>(
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

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    status: 'success',
  }),
}));

vi.mock('@/hooks/useOpportunityContacts', () => ({
  useOpportunityContacts: () => linked.current,
  useLinkContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkContact: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateContactRole: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ContactsPanel } from './ContactsPanel';

const OPP_ID = '8d1c2d4f-09de-4c14-8f98-731e01bc36c9';

function unread(fetchStatus: string) {
  linked.current = {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus,
    error: undefined,
  };
}

function contactRow(name: string, email: string | null) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    contactId: '22222222-2222-4222-8222-222222222222',
    role: 'champion',
    isPrimary: false,
    contact: { name, email },
  };
}

function renderPanel() {
  return render(<ContactsPanel oppId={OPP_ID} />);
}

describe('linked contacts read', () => {
  afterEach(() => {
    cleanup();
    unread('paused');
  });

  it('does not treat a paused linked-contact read as zero contacts', () => {
    unread('paused');
    renderPanel();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: LINK })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Linked contacts' })).toBeTruthy();
  });

  it('does not treat an in-flight linked-contact read as zero contacts', () => {
    unread('fetching');
    renderPanel();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed linked-contact read on the error when isError is true', () => {
    linked.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new Error('offline'),
    };
    renderPanel();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('drops a stale contact when the read status is error and isError is still false', () => {
    linked.current = {
      data: { items: [contactRow('Northwind', 'ada@northwind.example')] },
      isLoading: false,
      isError: false,
      status: 'error',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderPanel();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText('Northwind')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the book is empty when the list arrived with no contacts', () => {
    linked.current = {
      data: { items: [] },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderPanel();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.getByRole('button', { name: LINK })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a settled null payload as an empty book', () => {
    linked.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderPanel();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a contact that arrived', () => {
    linked.current = {
      data: { items: [contactRow('Northwind', 'ada@northwind.example')] },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderPanel();
    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.getByText('1 contact')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a contact when the email is blank', () => {
    linked.current = {
      data: { items: [contactRow('Northwind', null)] },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderPanel();
    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.getByText(/no email/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still names a continued page as the latest contacts, not the whole book', () => {
    linked.current = {
      data: { items: [contactRow('Northwind', 'ada@northwind.example')], contactsContinue: true },
      isLoading: false,
      isError: false,
      status: 'success',
      fetchStatus: 'idle',
      error: undefined,
    };
    renderPanel();
    expect(screen.getByText('1 in the latest 1, not every contact')).toBeTruthy();
    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
