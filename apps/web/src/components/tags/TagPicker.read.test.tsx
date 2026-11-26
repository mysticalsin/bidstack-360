// A paused or in-flight tag list has no payload yet. The picker showed only
// the Tag button, which is the settled empty list. That read has not arrived.
// A failed read did the same, so a failure looked like a record with no tags.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface TagRow {
  id: string;
  name: string;
  color: string;
}

interface EntityTags {
  entityType: 'lead';
  entityId: string;
  tags: TagRow[];
}

const hookMocks = vi.hoisted(() => ({
  entityTags: {
    data: undefined as EntityTags | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useTags', () => ({
  useEntityTags: () => hookMocks.entityTags,
  useTags: () => ({ data: { items: [], pageContinues: false }, isError: false, status: 'success' }),
  useApplyTags: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTags: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTagSuggestions: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TagPicker } from './TagPicker';

const CHECKING = 'Checking tags. The list has not arrived.';
const FAILED = 'Could not load tags.';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';

const PRIORITY: TagRow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Priority',
  color: '#A78BFA',
};

function settle(data: EntityTags | undefined, extra: Partial<typeof hookMocks.entityTags> = {}) {
  hookMocks.entityTags = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    ...extra,
  };
}

function renderPicker() {
  return render(<TagPicker entityType="lead" entityId={ENTITY_ID} />);
}

function expectNotSettledEmpty() {
  expect(screen.queryByRole('button', { name: 'Tag' })).toBeNull();
  expect(screen.queryByText('Priority')).toBeNull();
}

describe('TagPicker entity tag list', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused tag read as an empty list', async () => {
    // WHY: a paused first read has isLoading false and no payload. The Tag
    // button alone is the settled empty list. The tags have not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderPicker();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNotSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not treat an in-flight tag read as an empty list', async () => {
    // WHY: a slow read also has no payload. The add button is not a settled
    // empty list.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderPicker();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNotSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a failed tag read on the error', async () => {
    // WHY: a failed read is not evidence that the record has no tags. The
    // error stays, and the add button does not stand in for an empty list.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderPicker();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNotSettledEmpty();
  });

  it('lets a failed read win over a stale tag', async () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Priority from a payload that is no longer the read.
    settle(
      { entityType: 'lead', entityId: ENTITY_ID, tags: [PRIORITY] },
      { isError: true, status: 'error', fetchStatus: 'idle' },
    );
    renderPicker();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Priority')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tag' })).toBeNull();
  });

  it('stays on the add button when a settled list has no tags', () => {
    // WHY: a list that arrived empty stays empty. A slow network must not
    // be dressed up as that outcome, and this one must.
    settle({ entityType: 'lead', entityId: ENTITY_ID, tags: [] });
    renderPicker();

    expect(screen.getByRole('button', { name: 'Tag' })).toBeTruthy();
    expect(screen.queryByText('Priority')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a tag when the list has arrived', async () => {
    // WHY: a loaded tag stays. The unread line must not replace a tag the
    // read already returned.
    settle({ entityType: 'lead', entityId: ENTITY_ID, tags: [PRIORITY] });
    renderPicker();

    expect(await screen.findByText('Priority')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tag' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
