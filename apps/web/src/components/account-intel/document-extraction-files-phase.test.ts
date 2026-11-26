import { describe, expect, it } from 'vitest';

import { documentExtractionFilesPhase } from './document-extraction-files-read';

describe('documentExtractionFilesPhase', () => {
  it('treats an error as failed even when a stale payload is still in hand', () => {
    expect(documentExtractionFilesPhase({ data: { items: [] }, isError: true, status: 'success' })).toBe(
      'failed',
    );
    expect(
      documentExtractionFilesPhase({
        data: { items: [{ id: 'file-61520' }] },
        isError: false,
        status: 'error',
      }),
    ).toBe('failed');
  });

  it('treats undefined data as unread when the read has not failed', () => {
    expect(documentExtractionFilesPhase({ data: undefined, isError: false, status: 'pending' })).toBe(
      'unread',
    );
  });

  it('treats a settled null payload and a settled list as ready', () => {
    expect(documentExtractionFilesPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(documentExtractionFilesPhase({ data: { items: [] }, isError: false, status: 'success' })).toBe(
      'ready',
    );
  });
});
