import { describe, expect, it } from 'vitest';

import { kpiSourcedPhase } from './kpi-sourced-read';

describe('kpiSourcedPhase', () => {
  it('treats an error as failed even when a stale payload is still in hand', () => {
    expect(kpiSourcedPhase({ data: { items: [] }, isError: true, status: 'success' })).toBe('failed');
    expect(kpiSourcedPhase({ data: { items: [{ id: 'revenue' }] }, isError: false, status: 'error' })).toBe(
      'failed',
    );
  });

  it('treats undefined data as unread when the read has not failed', () => {
    expect(kpiSourcedPhase({ data: undefined, isError: false, status: 'pending' })).toBe('unread');
  });

  it('treats a settled null payload and a settled list as ready', () => {
    expect(kpiSourcedPhase({ data: null, isError: false, status: 'success' })).toBe('ready');
    expect(kpiSourcedPhase({ data: { items: [] }, isError: false, status: 'success' })).toBe('ready');
  });
});
