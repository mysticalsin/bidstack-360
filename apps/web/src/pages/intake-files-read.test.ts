import { describe, expect, it } from 'vitest';

import { intakeFilesPhase } from './intake-files-read';

describe('intakeFilesPhase', () => {
  it('treats an error as failed even when a stale payload is still in hand', () => {
    expect(intakeFilesPhase({ data: { items: [] }, isError: true, status: 'success' })).toBe('failed');
    expect(intakeFilesPhase({ data: { items: [{ id: 'file-1' }] }, isError: false, status: 'error' })).toBe('failed');
  });

  it('treats undefined data as unread when the read has not failed', () => {
    expect(intakeFilesPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
  });

  it('treats a settled null payload and a settled list as ready', () => {
    expect(intakeFilesPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(intakeFilesPhase({ data: { items: [] }, isError: false, status: 'success' })).toBe('ready');
  });
});
