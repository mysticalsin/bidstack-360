// A paused or in-flight signing-entity read has no list yet. The section
// showed an empty catalog and offered Add brand. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useSigningEntities: vi.fn(),
  useCreateSigningEntity: vi.fn(),
  usePatchSigningEntity: vi.fn(),
}));

vi.mock('@/hooks/useSigningEntities', () => ({
  useSigningEntities: hookMocks.useSigningEntities,
  useCreateSigningEntity: hookMocks.useCreateSigningEntity,
  usePatchSigningEntity: hookMocks.usePatchSigningEntity,
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

import { SigningEntitiesSection } from './SigningEntitiesSection';

const CHECKING = 'Checking signing entities. The list has not arrived.';
const FAILED = 'Could not load signing entities';
const CAPTION = /Brands and Amaris branches/;
const ADD = 'Add brand or branch';

function entity(legalName: string | null) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'northwind',
    name: 'Northwind Advisory',
    legalName,
    brandFamily: 'other' as const,
    aliases: [] as string[],
    businessLines: [] as string[],
    sourceUrl: 'https://example.test/northwind',
    verificationStatus: 'unverified' as const,
  };
}

function list(items: ReturnType<typeof entity>[]) {
  return { items };
}

function renderEntities(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useSigningEntities.mockReturnValue(query);
  hookMocks.useCreateSigningEntity.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  hookMocks.usePatchSigningEntity.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  render(<SigningEntitiesSection />);
}

describe('SigningEntitiesSection read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused signing-entity read as an empty catalog', () => {
    // WHY: a paused first read has isLoading false and no list. An empty
    // catalog, and Add brand, say the read arrived. This one has not.
    renderEntities({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again in a moment.')).toBeNull();
    expect(screen.queryByText('Northwind Advisory')).toBeNull();
    expect(screen.queryByTestId('signing-entities-settings')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight signing-entity read as an empty catalog', () => {
    // WHY: a slow read also has no list, and isLoading can stay false.
    // The empty catalog must not stand in for a read that is still running.
    renderEntities({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again in a moment.')).toBeNull();
    expect(screen.queryByTestId('signing-entities-settings')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed signing-entity read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and the catalog must not open.
    renderEntities({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('entities down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('Try again in a moment.')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
    expect(screen.queryByTestId('signing-entities-settings')).toBeNull();
  });

  it('lets a failed read win over a stale signing entity', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Northwind Advisory on screen.
    renderEntities({
      data: list([entity('Northwind Advisory LLC')]),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('entities down'),
    });

    expect(screen.queryByText('Northwind Advisory')).toBeNull();
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByTestId('signing-entities-settings')).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale entity, and it must not look like an empty list.
    renderEntities({
      data: list([entity('Northwind Advisory LLC')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('entities down'),
    });

    expect(screen.queryByText('Northwind Advisory')).toBeNull();
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderEntities({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByTestId('signing-entities-settings')).toBeTruthy();
    expect(screen.getByText(CAPTION)).toBeTruthy();
    expect(screen.getByRole('button', { name: ADD })).toBeTruthy();
    expect(screen.queryByText('Northwind Advisory')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled list has no entities', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderEntities({
      data: list([]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByTestId('signing-entities-settings')).toBeTruthy();
    expect(screen.getByText(CAPTION)).toBeTruthy();
    expect(screen.getByRole('button', { name: ADD })).toBeTruthy();
    expect(screen.queryByText('Northwind Advisory')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded signing entity', () => {
    // WHY: a loaded payload stays. The unread line must not replace an entity
    // the read already returned.
    renderEntities({
      data: list([entity('Northwind Advisory LLC')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText('Northwind Advisory')).toBeTruthy();
    expect(screen.getByText(/Northwind Advisory LLC/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://example.test/northwind' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded signing entity with a blank legal name', () => {
    // WHY: a blank legal name is loaded data. Unread must not drop the entity,
    // and the row must not invent a legal name.
    renderEntities({
      data: list([entity(null)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(/Northwind Advisory/)).toBeTruthy();
    expect(screen.getByText(/No legal name/)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
