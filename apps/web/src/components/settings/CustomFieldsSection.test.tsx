// WHY: Settings, Data configuration, Custom Fields is where an admin adds a
// field to the demo book. The list request had not settled, and the section
// still said "No custom fields" and still offered Add field. An empty book
// and a book that never loaded are different. Adding against the second one
// can mint a duplicate of a field the screen never showed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useCustomFieldDefinitions: vi.fn(),
  useCreateCustomFieldDefinition: vi.fn(),
  usePatchCustomFieldDefinition: vi.fn(),
  useDeleteCustomFieldDefinition: vi.fn(),
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
            variants: _variants,
            whileHover: _whileHover,
            whileTap: _whileTap,
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

vi.mock('@/hooks/useCustomFields', () => ({
  useCustomFieldDefinitions: hookMocks.useCustomFieldDefinitions,
  useCreateCustomFieldDefinition: hookMocks.useCreateCustomFieldDefinition,
  usePatchCustomFieldDefinition: hookMocks.usePatchCustomFieldDefinition,
  useDeleteCustomFieldDefinition: hookMocks.useDeleteCustomFieldDefinition,
}));

import { CustomFieldsSection } from './CustomFieldsSection';

function idleMutations() {
  hookMocks.useCreateCustomFieldDefinition.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  hookMocks.usePatchCustomFieldDefinition.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  hookMocks.useDeleteCustomFieldDefinition.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
}

describe('CustomFieldsSection unloaded list', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a custom-field load in progress an empty book', () => {
    idleMutations();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    const { container } = render(<CustomFieldsSection />);

    expect(screen.queryByText('No custom fields')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add field' })).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('does not offer Add field when the custom-field list failed to load', () => {
    const refetch = vi.fn();
    idleMutations();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<CustomFieldsSection />);

    expect(screen.queryByText('No custom fields')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add field' })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still says the book is empty once a loaded list has no active fields', () => {
    idleMutations();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: { items: [], pageContinues: false },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<CustomFieldsSection />);

    expect(screen.getByText('No custom fields')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Add field' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a field that the loaded list returned', () => {
    idleMutations();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: {
        items: [
          {
            id: 'field-sample-office',
            label: 'Sample office',
            fieldKey: 'sample_office',
            fieldType: 'text',
            active: true,
            required: false,
            orderIndex: 0,
            options: [],
          },
        ],
        pageContinues: false,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<CustomFieldsSection />);

    expect(screen.getByText('Sample office')).toBeTruthy();
    expect(screen.queryByText('No custom fields')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add field' })).toBeTruthy();
  });
});
