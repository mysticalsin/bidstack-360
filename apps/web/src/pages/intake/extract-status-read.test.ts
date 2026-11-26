import { describe, expect, it } from 'vitest';

import { extractStatusPhase } from './extract-status-read';

describe('extractStatusPhase', () => {
  it('treats an error as failed even when a stale payload is still in hand', () => {
    expect(
      extractStatusPhase({ data: { extractions: [] }, isError: true, status: 'success' }),
    ).toBe('failed');
    expect(
      extractStatusPhase({
        data: { extractions: [{ documentId: '11111111-1111-4111-8111-111111111111' }] },
        isError: false,
        status: 'error',
      }),
    ).toBe('failed');
  });

  it('treats undefined data as unread when the read has not failed', () => {
    expect(extractStatusPhase({ data: undefined, isError: false, status: 'pending' })).toBe(
      'unread',
    );
  });

  it('treats a settled null payload and a settled list as ready', () => {
    expect(extractStatusPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(
      extractStatusPhase({ data: { extractions: [] }, isError: false, status: 'success' }),
    ).toBe('ready');
  });
});
