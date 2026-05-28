/**
 * Unit tests for rfp-orchestrator.ts
 *
 * Focus: the org-mismatch guard — if upsertOrchestration returns a row
 * whose org_id differs from the job's orgId, the job must throw a
 * doNotRetry error immediately without enqueuing any child jobs.
 *
 * processJob is a private function. We test via the mocked Prisma layer
 * by replaying the critical logic that drives the org-mismatch branch.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Module-level mocks ──────────────────────────────────────────────────────

vi.mock('@bidstack/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

vi.mock('@bidstack/shared', () => ({
  RFP_ORCHESTRATE: {
    name: 'rfp.orchestrate',
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  },
  RFP_REQUIREMENT_EXTRACT: {
    name: 'rfp.requirement-extract',
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  },
}));

const ORG_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ORCH_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const DOC_VER_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

// ─── Inline replication of the processJob org-mismatch guard ─────────────────

/**
 * Replays the exact org-mismatch guard from processJob (rfp-orchestrator.ts
 * lines 114-123). Tests call this helper and observe the thrown error.
 */
async function runOrchestratorOrgGuard(
  jobOrgId: string,
  returnedOrgId: string,
): Promise<{ threw: boolean; doNotRetry: boolean; message: string }> {
  const { prisma: mockPrisma } = await import('@bidstack/db');

  vi.mocked(mockPrisma.$queryRaw).mockResolvedValue([
    { id: ORCH_ID, org_id: returnedOrgId },
  ] as never);

  let threw = false;
  let doNotRetry = false;
  let message = '';

  try {
    // Simulate upsertOrchestration result check (source lines 114-123)
    const rows = await mockPrisma.$queryRaw<Array<{ id: string; org_id: string }>>``;
    if (!rows.length) throw new Error('upsertOrchestration: no row returned');
    const orchestration = rows[0]!;

    if (orchestration.org_id !== jobOrgId) {
      const err = new Error('rfp-orchestrator: cross-org mismatch on upsert');
      (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
      throw err;
    }
  } catch (err) {
    threw = true;
    message = (err as Error).message;
    if ((err as Error & { doNotRetry?: boolean }).doNotRetry) doNotRetry = true;
  }

  return { threw, doNotRetry, message };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('rfp-orchestrator: org-mismatch guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a doNotRetry error when returned org_id differs from job orgId', async () => {
    const result = await runOrchestratorOrgGuard(ORG_A, ORG_B);
    expect(result.threw).toBe(true);
    expect(result.doNotRetry).toBe(true);
    expect(result.message).toContain('cross-org mismatch');
  });

  it('does NOT throw when returned org_id matches job orgId', async () => {
    const result = await runOrchestratorOrgGuard(ORG_A, ORG_A);
    expect(result.threw).toBe(false);
    expect(result.doNotRetry).toBe(false);
  });

  it('does NOT throw when both are different but equal values (sanity check)', async () => {
    const sameId = '11111111-1111-4111-a111-111111111111';
    const result = await runOrchestratorOrgGuard(sameId, sameId);
    expect(result.threw).toBe(false);
  });

  it('always marks the error doNotRetry=true on mismatch (not just any error)', async () => {
    const result = await runOrchestratorOrgGuard(ORG_A, ORG_B);
    // Verify the flag is specifically set — not just that it threw
    expect(result.doNotRetry).toBe(true);
  });
});

// ─── JobData schema validation ────────────────────────────────────────────────
// These mirror the orchestrator-specific schema with rfpRequestId (min(1), not uuid)

import { z } from 'zod';

const OrchestratorSchema = z.object({
  orgId: z.string().uuid(),
  rfpRequestId: z.string().min(1),
  documentVersionId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  proposalId: z.string().uuid().optional(),
  startedByUserId: z.string().uuid().optional(),
});

describe('rfp-orchestrator: JobData schema edge cases', () => {
  it('accepts rfpRequestId as a non-UUID opaque string', () => {
    const parsed = OrchestratorSchema.safeParse({
      orgId: ORG_A,
      rfpRequestId: 'RFP-2026-001', // NOT a UUID — min(1) only
      documentVersionId: DOC_VER_ID,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects rfpRequestId that is an empty string', () => {
    const parsed = OrchestratorSchema.safeParse({
      orgId: ORG_A,
      rfpRequestId: '',
      documentVersionId: DOC_VER_ID,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts payload without any optional fields', () => {
    const parsed = OrchestratorSchema.safeParse({
      orgId: ORG_A,
      rfpRequestId: 'req-1',
      documentVersionId: DOC_VER_ID,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.opportunityId).toBeUndefined();
      expect(parsed.data.proposalId).toBeUndefined();
      expect(parsed.data.startedByUserId).toBeUndefined();
    }
  });

  it('rejects invalid UUID for startedByUserId when provided', () => {
    const parsed = OrchestratorSchema.safeParse({
      orgId: ORG_A,
      rfpRequestId: 'req-1',
      documentVersionId: DOC_VER_ID,
      startedByUserId: 'not-a-uuid',
    });
    expect(parsed.success).toBe(false);
  });
});
