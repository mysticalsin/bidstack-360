import { describe, expect, it } from 'vitest';

import {
  DSR_EVENTS,
  DSR_STALE_RUNNING_MS,
  DSR_STATES,
  dsrClaimIsStale,
  dsrClaimWhere,
  dsrOwnedWhere,
  dsrStateFromStored,
  dsrTransition,
  type DsrEvent,
  type DsrState,
} from './data-subject.js';
import { isIllegalTransition } from './illegal-transition.js';

const LEGAL: Array<[DsrState, DsrEvent, { stale: boolean }, DsrState]> = [
  ['queued', 'claim', { stale: false }, 'running'],
  ['running', 'claim', { stale: true }, 'running'],
  ['running', 'complete', { stale: false }, 'done'],
  ['running', 'fail', { stale: false }, 'failed'],
];

describe('data subject transition table', () => {
  it('accepts every legal row', () => {
    for (const [from, event, guard, to] of LEGAL) {
      expect(dsrTransition(from, event, guard)).toBe(to);
    }
  });

  it('rejects the full illegal cross product when the claim is not stale', () => {
    const legal = new Set(LEGAL.filter((row) => !row[2].stale).map(([from, event]) => `${from}|${event}`));
    for (const from of DSR_STATES) {
      for (const event of DSR_EVENTS) {
        if (legal.has(`${from}|${event}`)) continue;
        expect(isIllegalTransition(dsrTransition(from, event))).toBe(true);
      }
    }
  });

  it('allows a stale running claim and denies a fresh one', () => {
    const now = new Date('2026-11-11T12:00:00.000Z');
    const fresh = new Date(now.getTime() - DSR_STALE_RUNNING_MS + 1_000);
    const stale = new Date(now.getTime() - DSR_STALE_RUNNING_MS - 1_000);
    expect(dsrClaimIsStale(stale, now)).toBe(true);
    expect(dsrClaimIsStale(fresh, now)).toBe(false);
    expect(dsrClaimIsStale(null, now)).toBe(false);
    expect(dsrTransition('running', 'claim', { stale: true })).toBe('running');
    expect(isIllegalTransition(dsrTransition('running', 'claim', { stale: false }))).toBe(true);
    const where = dsrClaimWhere('req-1', 'org-1', now);
    expect(where.orgId).toBe('org-1');
    expect(where.OR[1]?.startedAt.lt.toISOString()).toBe(
      new Date(now.getTime() - DSR_STALE_RUNNING_MS).toISOString(),
    );
  });

  it('binds a later write to the claim token and the org', () => {
    const startedAt = new Date('2026-11-11T12:00:00.000Z');
    expect(dsrOwnedWhere('req-1', 'org-1', startedAt, 'running')).toEqual({
      id: 'req-1',
      orgId: 'org-1',
      startedAt,
      status: 'running',
    });
    expect(dsrOwnedWhere('req-1', 'org-1', startedAt, 'done').status).toBe('done');
  });

  it('loads a known status as itself and an unknown status as failed without calling it known', () => {
    for (const state of DSR_STATES) {
      expect(dsrStateFromStored(state)).toEqual({ state, known: true });
    }
    expect(dsrStateFromStored('mystery')).toEqual({ state: 'failed', known: false });
    expect(dsrStateFromStored('').known).toBe(false);
  });
});
