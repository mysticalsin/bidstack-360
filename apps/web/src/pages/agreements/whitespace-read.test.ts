import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';

import { whitespaceReadKind } from './whitespace-read';

const missing = new ApiError(
  'Route GET:/api/v1/msa/whitespace not found',
  404,
  { message: 'Route GET:/api/v1/msa/whitespace not found' },
);
const down = new ApiError('unavailable', 503, { message: 'unavailable' });

describe('whitespaceReadKind', () => {
  it('keeps a failed refresh distinct from an empty HEMA book', () => {
    expect(whitespaceReadKind({
      isLoading: false,
      isError: true,
      error: down,
      hasPayload: true,
      itemCount: 1,
    })).toBe('refresh-failed');
  });

  it('treats a missing agreements route as the sample preview, even if a list was already here', () => {
    expect(whitespaceReadKind({
      isLoading: false,
      isError: true,
      error: missing,
      hasPayload: false,
      itemCount: 0,
    })).toBe('sample-missing');
    expect(whitespaceReadKind({
      isLoading: false,
      isError: true,
      error: missing,
      hasPayload: true,
      itemCount: 1,
    })).toBe('sample-missing');
  });

  it('treats a real failure with no payload as a load failure that can be retried', () => {
    expect(whitespaceReadKind({
      isLoading: false,
      isError: true,
      error: down,
      hasPayload: false,
      itemCount: 0,
    })).toBe('load-failed');
    expect(whitespaceReadKind({
      isLoading: false,
      isError: true,
      error: new ApiError('Agreement not found', 404, { message: 'Agreement not found' }),
      hasPayload: false,
      itemCount: 0,
    })).toBe('load-failed');
  });

  it('treats a settled zero as empty and a settled flag as ready', () => {
    expect(whitespaceReadKind({
      isLoading: false,
      isError: false,
      error: null,
      hasPayload: true,
      itemCount: 0,
    })).toBe('empty');
    expect(whitespaceReadKind({
      isLoading: false,
      isError: false,
      error: null,
      hasPayload: true,
      itemCount: 2,
    })).toBe('ready');
  });

  it('stays on loading until the first payload arrives', () => {
    expect(whitespaceReadKind({
      isLoading: true,
      isError: false,
      error: null,
      hasPayload: false,
      itemCount: 0,
    })).toBe('loading');
  });
});
