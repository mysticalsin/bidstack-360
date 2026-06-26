import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queueAddMock,
  queueMock,
  redisOnMock,
  ioredisMock,
  checkSerumLoopRuntimePolicyMock,
} = vi.hoisted(() => {
  const queueAddMock = vi.fn();
  const redisOnMock = vi.fn();
  return {
    queueAddMock,
    queueMock: vi.fn(function QueueMock() {
      return { add: queueAddMock };
    }),
    redisOnMock,
    ioredisMock: vi.fn(function IORedisMock() {
      return { on: redisOnMock };
    }),
    checkSerumLoopRuntimePolicyMock: vi.fn(),
  };
});

vi.mock('bullmq', () => ({
  Queue: queueMock,
}));

vi.mock('ioredis', () => ({
  default: ioredisMock,
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { loops: 'orchestration' },
  checkSerumLoopRuntimePolicy: checkSerumLoopRuntimePolicyMock,
}));

const previousEnableQueueInTests = process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;

const job = {
  orgId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  rfpRequestId: 'req-001',
  documentVersionId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  opportunityId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  startedByUserId: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
};

describe('enqueueRfpOrchestrate SERUM loop guard', () => {
  beforeEach(() => {
    process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = 'true';
    queueAddMock.mockReset();
    queueMock.mockClear();
    redisOnMock.mockReset();
    ioredisMock.mockClear();
    checkSerumLoopRuntimePolicyMock.mockReset();
  });

  afterEach(() => {
    if (previousEnableQueueInTests === undefined) {
      delete process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;
    } else {
      process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = previousEnableQueueInTests;
    }
  });

  it('fails closed before BullMQ when the loop policy denies orchestration', async () => {
    const { enqueueRfpOrchestrate, RfpOrchestrateLoopPolicyError } = await import(
      './rfp-orchestrator.js'
    );
    checkSerumLoopRuntimePolicyMock.mockResolvedValue({
      allowed: false,
      reason: 'No active SERUM Loops policy is published.',
    });

    await expect(enqueueRfpOrchestrate(job)).rejects.toBeInstanceOf(
      RfpOrchestrateLoopPolicyError,
    );
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(checkSerumLoopRuntimePolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: job.orgId,
        configKey: 'orchestration',
        loopId: job.rfpRequestId,
        operation: 'rfp.orchestrate',
        retryCount: 0,
        hasDurableEvent: true,
        approvalGateReached: false,
      }),
    );
  });

  it('enqueues only after the active loop policy allows orchestration', async () => {
    const { enqueueRfpOrchestrate } = await import('./rfp-orchestrator.js');
    checkSerumLoopRuntimePolicyMock.mockResolvedValue({
      allowed: true,
      reason: 'Loop execution is allowed by the active SERUM policy.',
    });
    queueAddMock.mockResolvedValue({ id: 'job-1' });

    await expect(enqueueRfpOrchestrate(job)).resolves.toBe('job-1');
    expect(queueAddMock).toHaveBeenCalledWith(
      'rfp.orchestrate',
      job,
      expect.objectContaining({ jobId: `rfp-orch-${job.orgId}-${job.rfpRequestId}` }),
    );
  });
});
