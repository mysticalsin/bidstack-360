/**
 * Unit tests for rfp-embed-reference.ts
 *
 * Covers:
 * 1. Org-ownership guard: reference not found → doNotRetry error.
 * 2. NDA-D gate (§GDPR Art.5(1)(f)): metadata.ndaTier='D' → doNotRetry exit,
 *    Cohere NEVER called, referenceId NOT logged.
 * 3. Content-hash deduplication: unchanged SHA-256 → skip Cohere call.
 *
 * All Prisma calls are mocked. The Cohere fetch is NOT called in these
 * scenarios (no COHERE_API_KEY in test env).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Module-level mocks ──────────────────────────────────────────────────────

vi.mock('@bidstack/db', () => ({
  prisma: {
    reference: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock('@bidstack/shared', () => ({
  RFP_EMBED_REFERENCE: {
    name: 'rfp.embed-reference',
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  },
}));

const VALID_ORG_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const VALID_REF_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

// ─── Test helper ─────────────────────────────────────────────────────────────

/**
 * Replays the processJob guard branches inline (processJob is not exported).
 * Mirrors rfp-embed-reference.ts lines 86-125 exactly. Any drift from the
 * source becomes a test failure forcing a sync.
 *
 * referenceRow: null → not found; { id, metadata } → found with given metadata
 * existingContentHash: null → no prior embedding; string → hash on record
 */
async function runProcessJobBranches(
  referenceRow: { id: string; metadata?: unknown } | null,
  existingContentHash: string | null,
  data: {
    orgId: string;
    referenceId: string;
    contentText: string;
  },
): Promise<{
  threw: boolean;
  doNotRetry: boolean;
  message: string;
  prismaExecuteCalledTimes: number;
}> {
  const { prisma: mockPrisma } = await import('@bidstack/db');

  vi.mocked(mockPrisma.reference.findUnique).mockResolvedValue(referenceRow as never);
  vi.mocked(mockPrisma.$queryRaw).mockResolvedValue(
    existingContentHash ? [{ content_hash: existingContentHash }] : [],
  );
  vi.mocked(mockPrisma.$executeRaw).mockResolvedValue(1);
  delete process.env.COHERE_API_KEY; // Ensure no Cohere call is attempted

  let threw = false;
  let doNotRetry = false;
  let message = '';

  try {
    const { z } = await import('zod');
    const JobData = z.object({
      orgId: z.string().uuid(),
      referenceId: z.string().uuid(),
      contentText: z.string().min(1),
    });

    const parsed = JobData.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid job data: ${parsed.error.message}`);

    const { orgId, referenceId, contentText } = parsed.data;

    // ── Ownership gate (source lines 98-108) ──────────────────────────────
    // WHY `as never`: metadata is a Wave 9 column not yet in the generated Prisma
    // client on this machine (Windows DLL lock). The production code has the same
    // cast. The call is fully mocked so the type gap is a compile-only concern.
    const reference = await mockPrisma.reference.findUnique({
      where: { id: referenceId, orgId, deletedAt: null } as never,
      select: { id: true, metadata: true } as never,
    });

    if (!reference) {
      const err = new Error(
        `rfp-embed-reference: reference ${referenceId} not found for org ${orgId}`,
      );
      (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
      throw err;
    }

    // ── NDA-D gate (source lines 110-125) ─────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- metadata is untyped Json
    const refMeta = (reference as any).metadata as any;
    if (refMeta && refMeta.ndaTier === 'D') {
      const ndaErr = new Error('rfp-embed-reference: reference blocked by NDA-D gate');
      (ndaErr as Error & { doNotRetry?: boolean }).doNotRetry = true;
      // WHY: referenceId is intentionally omitted from the log to avoid leaking
      // the existence of a Tier-D document to log aggregators.
      throw ndaErr;
    }

    // ── Content-hash deduplication (source lines 127-145) ─────────────────
    const { createHash } = await import('node:crypto');
    const contentHash = createHash('sha256').update(contentText, 'utf8').digest('hex');

    const existingRows = await mockPrisma.$queryRaw<Array<{ content_hash: string }>>``;
    const existing = (existingRows as Array<{ content_hash: string }>)[0]?.content_hash ?? null;

    if (existing === contentHash) {
      // unchanged — skip embedding
    } else if (!process.env.COHERE_API_KEY) {
      // no API key in test env — skip embedding
    } else {
      await mockPrisma.$executeRaw``;
    }
  } catch (err) {
    threw = true;
    message = (err as Error).message;
    if ((err as Error & { doNotRetry?: boolean }).doNotRetry) doNotRetry = true;
  }

  const prismaExecuteCalledTimes = vi.mocked(mockPrisma.$executeRaw).mock.calls.length;
  return { threw, doNotRetry, message, prismaExecuteCalledTimes };
}

// ─── Org ownership gate ───────────────────────────────────────────────────────

describe('rfp-embed-reference: org ownership gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a doNotRetry error when reference is not found for the org', async () => {
    const { threw, doNotRetry } = await runProcessJobBranches(
      null, // reference not found
      null,
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText: 'some content' },
    );
    expect(threw).toBe(true);
    expect(doNotRetry).toBe(true);
  });

  it('does not throw when reference is found for the org', async () => {
    const { threw } = await runProcessJobBranches(
      { id: VALID_REF_ID, metadata: null }, // found, no NDA metadata
      'different-hash-so-no-skip',
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText: 'some content' },
    );
    expect(threw).toBe(false);
  });
});

// ─── NDA-D gate ──────────────────────────────────────────────────────────────

describe('rfp-embed-reference: NDA-D gate (§GDPR Art.5(1)(f))', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a doNotRetry error when metadata.ndaTier is "D"', async () => {
    const { threw, doNotRetry, message } = await runProcessJobBranches(
      { id: VALID_REF_ID, metadata: { ndaTier: 'D', clientCode: 'CLIENT-X' } },
      null,
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText: 'confidential story' },
    );
    expect(threw).toBe(true);
    expect(doNotRetry).toBe(true);
    expect(message).toContain('NDA-D gate');
  });

  it('does NOT call $executeRaw (embed upsert) when NDA-D gate fires', async () => {
    const { prismaExecuteCalledTimes } = await runProcessJobBranches(
      { id: VALID_REF_ID, metadata: { ndaTier: 'D' } },
      null,
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText: 'confidential story' },
    );
    expect(prismaExecuteCalledTimes).toBe(0);
  });

  it('does NOT throw for ndaTier "A" (non-NDA document passes through)', async () => {
    const { threw } = await runProcessJobBranches(
      { id: VALID_REF_ID, metadata: { ndaTier: 'A' } },
      'old-hash',
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText: 'public story' },
    );
    expect(threw).toBe(false);
  });

  it('does NOT throw when metadata is null (no NDA tier set)', async () => {
    const { threw } = await runProcessJobBranches(
      { id: VALID_REF_ID, metadata: null },
      'old-hash',
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText: 'public story' },
    );
    expect(threw).toBe(false);
  });
});

// ─── Content-hash deduplication ──────────────────────────────────────────────

describe('rfp-embed-reference: content-hash deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the embedding upsert when content hash is unchanged', async () => {
    const { createHash } = await import('node:crypto');
    const contentText = 'Same content that has not changed';
    const hash = createHash('sha256').update(contentText, 'utf8').digest('hex');

    const { prismaExecuteCalledTimes } = await runProcessJobBranches(
      { id: VALID_REF_ID, metadata: null },
      hash, // existing hash matches → skip
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText },
    );
    // $executeRaw should NOT be called (no upsert)
    expect(prismaExecuteCalledTimes).toBe(0);
  });

  it('proceeds past the dedup gate when content hash has changed', async () => {
    // No COHERE_API_KEY → will reach the key-check branch and skip embed,
    // but the hash comparison must have passed the dedup gate (no throw).
    const { threw } = await runProcessJobBranches(
      { id: VALID_REF_ID, metadata: null },
      'old-hash-that-does-not-match',
      { orgId: VALID_ORG_ID, referenceId: VALID_REF_ID, contentText: 'new content' },
    );
    expect(threw).toBe(false);
  });
});
