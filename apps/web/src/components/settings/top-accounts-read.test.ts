import { describe, expect, it } from 'vitest';

import { topAccountsReadPhase } from './top-accounts-read';

describe('topAccountsReadPhase', () => {
  it('lets an error win over a missing payload and over a cached company', () => {
    expect(topAccountsReadPhase({ isError: true, data: undefined })).toBe('error');
    expect(topAccountsReadPhase({ status: 'error', isError: false, data: { items: [] } })).toBe(
      'error',
    );
  });

  it('treats undefined data as unread when the read has not failed', () => {
    expect(topAccountsReadPhase({ isError: false, status: 'pending', data: undefined })).toBe(
      'unread',
    );
  });

  it('treats a settled null and a settled list as ready', () => {
    expect(topAccountsReadPhase({ status: 'success', data: null })).toBe('ready');
    expect(topAccountsReadPhase({ status: 'success', data: { source: 'curated', items: [] } })).toBe(
      'ready',
    );
  });
});
