// WHY: GET /migrations/:id and the HubSpot sync-now run return stored
// error text. A driver or provider message must not leave the API.

import { describe, expect, it } from 'vitest';

import { hubspotRunFromJobs } from '../services/sync-now/runs.js';
import { serializeJob } from './migrations.helpers.js';

const RAW =
  'PostgresError { code: "42P01", message: "relation secret_table does not exist" } chunk at /apps/worker/src/queues/migration.ts:1015';
const PROVIDER =
  'HubSpot API 500 {"token":"ya29.SECRETVALUE","email":"buyer@secret.example"}';

function jobRow(errorSummary: unknown) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: '00000000-0000-4000-8000-000000000010',
    orgId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    source: 'HUBSPOT_OAUTH',
    status: 'FAILED',
    totalRows: 1,
    processedRows: 0,
    errorRows: 1,
    startedAt: now,
    completedAt: now,
    errorSummary,
    meta: {},
    undoableUntil: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('migration error text on the way out', () => {
  it('maps raw errorSummary on a job response to a safe code', () => {
    const job = serializeJob(
      jobRow([
        { row: 4, field: null, message: RAW },
        { row: 0, field: null, message: 'chunk failed permanently: Process 4242 deadlock detected' },
        { row: 2, field: 'name', message: 'company.name is required' },
        { row: 0, field: null, message: 'enqueue_failed' },
      ]),
    );
    const text = JSON.stringify(job.errorSummary);
    expect(text).not.toContain('secret_table');
    expect(text).not.toContain('42P01');
    expect(text).not.toContain('migration.ts');
    expect(text).not.toContain('4242');
    expect(text).not.toContain('deadlock');
    expect(job.errorSummary.map((row) => row.message)).toEqual([
      'import_failed',
      'chunk failed permanently: import_failed',
      'company.name is required',
      'enqueue_failed',
    ]);
  });

  it('maps raw HubSpot sync-now reasons to a safe message', () => {
    const run = hubspotRunFromJobs(
      'hubspot-1',
      [
        {
          status: 'FAILED',
          totalRows: 1,
          processedRows: 0,
          errorRows: 1,
          startedAt: new Date(1_000),
          completedAt: new Date(2_000),
          errorSummary: [{ row: 1, field: 'email', message: PROVIDER }],
        },
      ],
      0,
    );
    const text = JSON.stringify(run);
    expect(text).not.toContain('ya29.SECRETVALUE');
    expect(text).not.toContain('buyer@secret.example');
    expect(run.reasons).toEqual(['The import could not be completed.']);
  });
});
