import { describe, expect, it } from 'vitest';

import { dustRunFromJob, hubspotRunFromJobs, syncRunId } from './runs.js';

const ORG = '00000000-0000-4000-8000-000000000001';

describe('syncRunId', () => {
  it('is the same for the same org, source and idempotency key', () => {
    expect(syncRunId(ORG, 'dust', 'key-123456')).toBe(syncRunId(ORG, 'dust', 'key-123456'));
  });

  it('never collides across sources or orgs', () => {
    const id = syncRunId(ORG, 'dust', 'key-123456');
    expect(syncRunId(ORG, 'hubspot', 'key-123456')).not.toBe(id);
    expect(syncRunId('00000000-0000-4000-8000-000000000002', 'dust', 'key-123456')).not.toBe(id);
  });

  // BullMQ rejects custom job ids that contain a colon.
  it('is a valid BullMQ custom job id', () => {
    expect(syncRunId(ORG, 'dust', 'a:b:c')).not.toContain(':');
    expect(syncRunId(ORG, 'dust', 'a:b:c')).toMatch(/^dust-/);
  });
});

describe('dustRunFromJob', () => {
  it('maps a waiting job to queued with no result yet', () => {
    expect(
      dustRunFromJob({ id: 'dust-1', state: 'waiting', progress: 0, timestamp: 1_000 }),
    ).toMatchObject({ runId: 'dust-1', source: 'dust', state: 'queued', result: null });
  });

  it('maps an active job to running', () => {
    expect(
      dustRunFromJob({ id: 'dust-1', state: 'active', progress: 40, timestamp: 1_000, processedOn: 2_000 }),
    ).toMatchObject({ state: 'running', progress: 40, startedAt: new Date(2_000).toISOString() });
  });

  it('maps the worker return value to new, updated, skipped and failed', () => {
    const run = dustRunFromJob({
      id: 'dust-1',
      state: 'completed',
      progress: 0,
      timestamp: 1_000,
      processedOn: 2_000,
      finishedOn: 3_000,
      returnvalue: { created: 3, updated: 2, skipped: 1, errors: 1 },
    });
    expect(run).toMatchObject({
      state: 'completed',
      progress: 100,
      finishedAt: new Date(3_000).toISOString(),
      result: { new: 3, updated: 2, skipped: 1, failed: 1 },
    });
  });

  it('carries the skip reason when the worker did not poll', () => {
    const run = dustRunFromJob({
      id: 'dust-1',
      state: 'completed',
      progress: 0,
      timestamp: 1_000,
      finishedOn: 3_000,
      returnvalue: { created: 0, updated: 0, skipped: 0, errors: 0, reason: 'not_configured' },
    });
    expect(run.reasons).toEqual(['not_configured']);
  });

  it('maps a failed job to failed with its reason', () => {
    const run = dustRunFromJob({
      id: 'dust-1',
      state: 'failed',
      progress: 0,
      timestamp: 1_000,
      finishedOn: 3_000,
      failedReason: 'Dust API 401',
    });
    expect(run).toMatchObject({ state: 'failed', reasons: ['Dust API 401'] });
  });
});

describe('hubspotRunFromJobs', () => {
  const base = {
    status: 'RUNNING' as const,
    totalRows: 10,
    processedRows: 0,
    errorRows: 0,
    startedAt: new Date(1_000),
    completedAt: null,
    errorSummary: [],
  };

  it('is running with progress across every entity job', () => {
    const run = hubspotRunFromJobs('hubspot-1', [
      { ...base, processedRows: 5 },
      { ...base, processedRows: 0 },
    ], 0);
    expect(run).toMatchObject({ state: 'running', progress: 25 });
  });

  it('completes when every job completes and splits new from updated', () => {
    const run = hubspotRunFromJobs(
      'hubspot-1',
      [
        { ...base, status: 'COMPLETE', processedRows: 8, errorRows: 2, completedAt: new Date(5_000), errorSummary: [{ row: 3, field: 'email', message: 'invalid email' }] },
      ],
      6,
    );
    expect(run).toMatchObject({
      state: 'completed',
      progress: 100,
      result: { new: 6, updated: 2, skipped: 0, failed: 2 },
      reasons: ['invalid email'],
      finishedAt: new Date(5_000).toISOString(),
    });
  });

  it('fails when any entity job failed', () => {
    const run = hubspotRunFromJobs('hubspot-1', [{ ...base, status: 'FAILED' }], 0);
    expect(run.state).toBe('failed');
  });

  it('is queued before the worker starts', () => {
    const run = hubspotRunFromJobs('hubspot-1', [{ ...base, status: 'PENDING', startedAt: null }], 0);
    expect(run.state).toBe('queued');
  });
});
