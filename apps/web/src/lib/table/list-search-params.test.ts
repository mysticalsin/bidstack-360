// Pure (non-React) half of the URL-state foundation: the parser declaration,
// the API-input projection and the link serializer. The hook half — merge,
// history modes, back/forward — is in use-table-query.test.tsx.

import { describe, expect, it } from 'vitest';

import {
  ALL_SEGMENT,
  DEFAULT_PAGE_SIZE,
  createListSearchParams,
  type ListSearchValues,
} from '@/lib/table/list-search-params';

type ProposalKey = 'status' | 'owner' | 'dueWindow';

const proposals = createListSearchParams<'status', 'owner' | 'dueWindow'>({
  tabId: 'status',
  facetIds: ['owner', 'dueWindow'],
  facetDefaults: { dueWindow: 'any' },
  defaultSort: 'dueAt',
  defaultDir: 'desc',
  pageSize: 50,
});

const values = (overrides: Partial<ListSearchValues<ProposalKey>> = {}) =>
  ({
    q: '',
    sort: 'dueAt',
    dir: 'desc',
    page: 1,
    pageSize: 50,
    expand: [],
    status: ALL_SEGMENT,
    owner: ALL_SEGMENT,
    dueWindow: 'any',
    ...overrides,
  }) as ListSearchValues<ProposalKey>;

describe('createListSearchParams — declaration', () => {
  it('resolves defaults and orders keys tab-first', () => {
    expect(proposals.config).toMatchObject({
      defaultSort: 'dueAt',
      defaultDir: 'desc',
      pageSize: 50,
      defaultTab: ALL_SEGMENT,
    });
    expect(proposals.keys).toEqual(['status', 'owner', 'dueWindow']);
    expect(proposals.segmentDefaults).toEqual({
      status: ALL_SEGMENT,
      owner: ALL_SEGMENT,
      dueWindow: 'any',
    });
  });

  it('falls back to the house defaults when nothing is declared', () => {
    const bare = createListSearchParams();
    expect(bare.config).toMatchObject({
      defaultSort: '',
      defaultDir: 'asc',
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(bare.keys).toEqual([]);
    expect(bare.parsers.pageSize.defaultValue).toBe(DEFAULT_PAGE_SIZE);
  });

  it('carries each declared default onto its parser', () => {
    expect(proposals.parsers.sort.defaultValue).toBe('dueAt');
    expect(proposals.parsers.dir.defaultValue).toBe('desc');
    expect(proposals.parsers.page.defaultValue).toBe(1);
    expect(proposals.parsers.status.defaultValue).toBe(ALL_SEGMENT);
    expect(proposals.parsers.dueWindow.defaultValue).toBe('any');
    expect(proposals.parsers.expand.defaultValue).toEqual([]);
  });

  it('refuses a facet that squats a reserved key', () => {
    expect(() => createListSearchParams<never, 'page'>({ facetIds: ['page'] })).toThrow(
      /reserved URL key/,
    );
    // `hide` belongs to DataTable's column menu, not to a surface.
    expect(() => createListSearchParams<never, 'hide'>({ facetIds: ['hide'] })).toThrow(
      /reserved URL key/,
    );
  });

  it('refuses the same key declared twice', () => {
    expect(() =>
      createListSearchParams<'status', 'status'>({ tabId: 'status', facetIds: ['status'] }),
    ).toThrow(/duplicate/);
  });
});

describe('createListSearchParams — toInput', () => {
  it('projects every declared segment, defaults included', () => {
    expect(proposals.toInput(values())).toEqual({
      q: '',
      sort: 'dueAt',
      dir: 'desc',
      page: 1,
      pageSize: 50,
      status: ALL_SEGMENT,
      owner: ALL_SEGMENT,
      dueWindow: 'any',
    });
  });

  it('never forwards expansion state to the API', () => {
    expect(proposals.toInput(values({ expand: ['row-1'] }))).not.toHaveProperty('expand');
  });

  it('trims the search term and clamps hand-edited pagination', () => {
    const input = proposals.toInput(values({ q: '  acme  ', page: 0, pageSize: -1 }));
    expect(input.q).toBe('acme');
    expect(input.page).toBe(1);
    expect(input.pageSize).toBe(50);
  });
});

describe('createListSearchParams — serialize', () => {
  it('omits defaults so a link carries only what differs', () => {
    expect(proposals.serialize({ status: ALL_SEGMENT, page: 1, dir: 'desc' })).toBe('');
  });

  it('writes the non-default values a deep link needs', () => {
    const query = new URLSearchParams(proposals.serialize({ status: 'won', page: 3, q: 'acme' }));
    expect(query.get('status')).toBe('won');
    expect(query.get('page')).toBe('3');
    expect(query.get('q')).toBe('acme');
    expect(query.has('owner')).toBe(false);
    expect(query.has('dir')).toBe(false);
  });

  it('round-trips an array param through the same parser that reads it', () => {
    const query = new URLSearchParams(proposals.serialize({ expand: ['row-1', 'row-2'] }));
    expect(proposals.parsers.expand.parse(query.get('expand') as string)).toEqual([
      'row-1',
      'row-2',
    ]);
  });
});
