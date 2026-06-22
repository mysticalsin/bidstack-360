import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type pino from 'pino';

import type { WorkflowDispatchJob } from '@bidstack/shared';

// Mock prisma BEFORE importing the unit under test. We assert the dispatch
// consumer (a) only selects org-matched workflows and (b) writes a WorkflowRun
// row per matched workflow — the behaviour that proves triggers actually fire.
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdateMany: vi.fn(),
  wfUpdateMany: vi.fn(),
  transaction: vi.fn(),
  buildEffects: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    workflow: { findMany: mocks.findMany, updateMany: mocks.wfUpdateMany },
    workflowRun: { create: mocks.runCreate, updateMany: mocks.runUpdateMany },
    $transaction: mocks.transaction,
  },
}));

// Stub the effects so the test doesn't pull the webhook-delivery / bullmq chain.
vi.mock('../services/workflow-effects.js', () => ({
  buildWorkflowEffects: mocks.buildEffects,
}));

import { processDispatchJob } from './workflow-dispatch.js';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => log,
} as unknown as pino.Logger;

// The dispatch consumer now takes the shared webhook-delivery queue (its only
// use is being handed to buildWorkflowEffects, which is stubbed here), so a bare
// object double is sufficient.
const webhookQueue = {} as never;

// orgId must satisfy the WorkflowDispatchJob zod schema (uuid). recordId is a
// plain string in the schema, so a readable label is fine there.
const ORG_ID = '8d07f22e-cf94-4247-9a4c-0f9323cdd288';

function jobOf(data: WorkflowDispatchJob): Job<WorkflowDispatchJob> {
  return { id: 'job-1', data } as Job<WorkflowDispatchJob>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runCreate.mockResolvedValue({ id: 'run-1' });
  // Finalization is org-scoped updateMany now; count === 1 = one row finalized.
  mocks.runUpdateMany.mockResolvedValue({ count: 1 });
  mocks.wfUpdateMany.mockResolvedValue({ count: 1 });
  // $transaction(cb) runs the callback with a tx that reuses the same mocks.
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      workflowRun: { updateMany: mocks.runUpdateMany },
      workflow: { updateMany: mocks.wfUpdateMany },
    }),
  );
  // A no-op effects double — the engine is unit-tested separately; here we only
  // care that the dispatch loop creates + finalizes a run.
  mocks.buildEffects.mockReturnValue({
    userBelongsToOrg: vi.fn(async () => true),
    oppBelongsToOrg: vi.fn(async () => true),
    createTask: vi.fn(async () => ({ taskId: 't1' })),
    createNotification: vi.fn(async () => {}),
    enqueueWebhook: vi.fn(async () => {}),
    updateRecordOwner: vi.fn(async () => 1),
    updateRecordField: vi.fn(async () => 1),
  });
});

describe('processDispatchJob', () => {
  it('runs a matched stage_changed workflow and writes a WorkflowRun row', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'wf-1',
        orgId: ORG_ID,
        active: true,
        triggerKind: 'stage_changed',
        triggerConfig: { stage: 'closed_won' },
        actions: [{ kind: 'create_task', config: { title: 'Celebrate' } }],
      },
    ]);

    await processDispatchJob(
      jobOf({
        orgId: ORG_ID,
        triggerKind: 'stage_changed',
        recordType: 'opportunity',
        recordId: 'opp-1',
        changes: { stage: 'closed_won' },
      }),
      webhookQueue,
      log,
    );

    // Query was org-scoped to the event org.
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: ORG_ID,
          active: true,
          deletedAt: null,
          triggerKind: 'stage_changed',
        }),
      }),
    );
    // A run row was created with the trigger record + finalized.
    expect(mocks.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: ORG_ID,
          workflowId: 'wf-1',
          status: 'running',
          triggerRecordType: 'opportunity',
          triggerRecordId: 'opp-1',
        }),
      }),
    );
    expect(mocks.runUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Org-scoped finalization — the run update must carry the org filter.
        where: { id: 'run-1', orgId: ORG_ID },
        data: expect.objectContaining({ status: 'succeeded' }),
      }),
    );
  });

  it('does nothing when the config stage does not match the event stage', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'wf-2',
        orgId: ORG_ID,
        active: true,
        triggerKind: 'stage_changed',
        triggerConfig: { stage: 's4_negotiation' }, // event is closed_won
        actions: [{ kind: 'create_task', config: {} }],
      },
    ]);

    await processDispatchJob(
      jobOf({
        orgId: ORG_ID,
        triggerKind: 'stage_changed',
        recordType: 'opportunity',
        recordId: 'opp-1',
        changes: { stage: 'closed_won' },
      }),
      webhookQueue,
      log,
    );

    // No run created — the matcher pruned the only candidate.
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });

  it('ignores a malformed job payload without creating a run', async () => {
    await processDispatchJob(
      // missing required fields — fails the zod safeParse
      { id: 'bad', data: { orgId: 'not-a-uuid' } } as unknown as Job<WorkflowDispatchJob>,
      webhookQueue,
      log,
    );
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });
});
