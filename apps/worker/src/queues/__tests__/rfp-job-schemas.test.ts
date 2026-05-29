/**
 * Unit tests for BullMQ job data schemas across all RFP queue workers.
 *
 * Each worker uses z.object().safeParse() to validate incoming job data.
 * These tests verify the schemas reject invalid UUIDs, missing required fields,
 * and correctly accept optional fields with and without values.
 *
 * No Prisma, BullMQ workers, or external APIs are used here — the schemas
 * are extracted inline using the same z.object() definitions from the source
 * so we test the exact validator logic without spinning up worker processes.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ─── Schema replicas (must match source exactly) ────────────────────────────
// WHY replicas instead of importing: the schemas are not exported from each
// module. Replicating them here gives precise test boundaries and avoids
// pulling BullMQ/Prisma transitive imports into a pure schema test.

const OrchestratorJobData = z.object({
  orgId: z.string().uuid(),
  rfpRequestId: z.string().min(1),
  documentVersionId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  proposalId: z.string().uuid().optional(),
  startedByUserId: z.string().uuid().optional(),
});

const RequirementExtractJobData = z.object({
  orgId: z.string().uuid(),
  rfpRequestId: z.string().min(1),
  documentVersionId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  chunkIndex: z.number().int().min(0).default(0),
  totalChunks: z.number().int().min(1).default(1),
});

const StoryMatchJobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  requirementId: z.string().uuid(),
  topK: z.number().int().min(1).max(20).default(5),
});

const SectionDraftJobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  sectionId: z.string().uuid(),
  sectionTitle: z.string().min(1),
  requirementIds: z.array(z.string().uuid()).min(0),
});

const ComplianceFillJobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  matrixItemId: z.string().uuid(),
  requirementText: z.string().min(1),
  category: z.string().optional(),
});

const EmbedReferenceJobData = z.object({
  orgId: z.string().uuid(),
  referenceId: z.string().uuid(),
  contentText: z.string().min(1),
});

const EmbedRequirementJobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  requirementId: z.string().uuid(),
  contentText: z.string().min(1),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BAD_UUID = 'not-a-valid-uuid';

function passes<T extends z.ZodTypeAny>(schema: T, data: unknown): boolean {
  return schema.safeParse(data).success;
}

function fails<T extends z.ZodTypeAny>(schema: T, data: unknown): boolean {
  return !schema.safeParse(data).success;
}

// ─── rfp-orchestrator JobData ────────────────────────────────────────────────

describe('OrchestratorJobData schema', () => {
  const valid = {
    orgId: VALID_UUID,
    rfpRequestId: 'req-001',
    documentVersionId: VALID_UUID,
  };

  it('accepts a minimal valid payload', () => {
    expect(passes(OrchestratorJobData, valid)).toBe(true);
  });

  it('accepts all optional fields when present and valid', () => {
    expect(
      passes(OrchestratorJobData, {
        ...valid,
        opportunityId: VALID_UUID,
        proposalId: VALID_UUID,
        startedByUserId: VALID_UUID,
      }),
    ).toBe(true);
  });

  it('rejects an invalid orgId UUID', () => {
    expect(fails(OrchestratorJobData, { ...valid, orgId: BAD_UUID })).toBe(true);
  });

  it('rejects an invalid documentVersionId UUID', () => {
    expect(fails(OrchestratorJobData, { ...valid, documentVersionId: BAD_UUID })).toBe(true);
  });

  it('rejects an empty rfpRequestId (min 1)', () => {
    expect(fails(OrchestratorJobData, { ...valid, rfpRequestId: '' })).toBe(true);
  });

  it('rejects when orgId is missing', () => {
    const { orgId: _orgId, ...rest } = valid;
    expect(fails(OrchestratorJobData, rest)).toBe(true);
  });

  it('rejects an invalid opportunityId when provided', () => {
    expect(fails(OrchestratorJobData, { ...valid, opportunityId: BAD_UUID })).toBe(true);
  });

  it('accepts missing optional fields (opportunityId, proposalId, startedByUserId)', () => {
    expect(passes(OrchestratorJobData, valid)).toBe(true);
  });
});

// ─── rfp-requirement-extract JobData ────────────────────────────────────────

describe('RequirementExtractJobData schema', () => {
  const valid = {
    orgId: VALID_UUID,
    rfpRequestId: 'req-001',
    documentVersionId: VALID_UUID,
    orchestrationId: VALID_UUID,
  };

  it('accepts a valid payload with defaults applied', () => {
    const parsed = RequirementExtractJobData.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.chunkIndex).toBe(0);
      expect(parsed.data.totalChunks).toBe(1);
    }
  });

  it('accepts explicit chunkIndex and totalChunks', () => {
    expect(passes(RequirementExtractJobData, { ...valid, chunkIndex: 2, totalChunks: 5 })).toBe(
      true,
    );
  });

  it('rejects negative chunkIndex', () => {
    expect(fails(RequirementExtractJobData, { ...valid, chunkIndex: -1 })).toBe(true);
  });

  it('rejects totalChunks < 1', () => {
    expect(fails(RequirementExtractJobData, { ...valid, totalChunks: 0 })).toBe(true);
  });

  it('rejects an invalid orchestrationId UUID', () => {
    expect(fails(RequirementExtractJobData, { ...valid, orchestrationId: BAD_UUID })).toBe(true);
  });

  it('rejects a missing orchestrationId', () => {
    const { orchestrationId: _id, ...rest } = valid;
    expect(fails(RequirementExtractJobData, rest)).toBe(true);
  });
});

// ─── rfp-story-match JobData ─────────────────────────────────────────────────

describe('StoryMatchJobData schema', () => {
  const valid = {
    orgId: VALID_UUID,
    orchestrationId: VALID_UUID,
    requirementId: VALID_UUID,
  };

  it('applies default topK of 5', () => {
    const parsed = StoryMatchJobData.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.topK).toBe(5);
  });

  it('accepts topK within [1, 20]', () => {
    expect(passes(StoryMatchJobData, { ...valid, topK: 1 })).toBe(true);
    expect(passes(StoryMatchJobData, { ...valid, topK: 20 })).toBe(true);
  });

  it('rejects topK > 20', () => {
    expect(fails(StoryMatchJobData, { ...valid, topK: 21 })).toBe(true);
  });

  it('rejects topK < 1', () => {
    expect(fails(StoryMatchJobData, { ...valid, topK: 0 })).toBe(true);
  });

  it('rejects a non-integer topK', () => {
    expect(fails(StoryMatchJobData, { ...valid, topK: 2.5 })).toBe(true);
  });

  it('rejects an invalid requirementId UUID', () => {
    expect(fails(StoryMatchJobData, { ...valid, requirementId: 'bad-id' })).toBe(true);
  });

  it('rejects a missing requirementId', () => {
    const { requirementId: _id, ...rest } = valid;
    expect(fails(StoryMatchJobData, rest)).toBe(true);
  });
});

// ─── rfp-section-draft JobData ───────────────────────────────────────────────

describe('SectionDraftJobData schema', () => {
  const valid = {
    orgId: VALID_UUID,
    orchestrationId: VALID_UUID,
    proposalId: VALID_UUID,
    sectionId: VALID_UUID,
    sectionTitle: 'Executive Summary',
    requirementIds: [],
  };

  it('accepts a valid payload with empty requirementIds', () => {
    expect(passes(SectionDraftJobData, valid)).toBe(true);
  });

  it('accepts requirementIds with valid UUIDs', () => {
    expect(
      passes(SectionDraftJobData, { ...valid, requirementIds: [VALID_UUID, VALID_UUID] }),
    ).toBe(true);
  });

  it('rejects an empty sectionTitle', () => {
    expect(fails(SectionDraftJobData, { ...valid, sectionTitle: '' })).toBe(true);
  });

  it('rejects a non-UUID in requirementIds array', () => {
    expect(fails(SectionDraftJobData, { ...valid, requirementIds: ['not-uuid'] })).toBe(true);
  });

  it('rejects a missing sectionId', () => {
    const { sectionId: _id, ...rest } = valid;
    expect(fails(SectionDraftJobData, rest)).toBe(true);
  });

  it('rejects an invalid proposalId UUID', () => {
    expect(fails(SectionDraftJobData, { ...valid, proposalId: BAD_UUID })).toBe(true);
  });
});

// ─── rfp-compliance-fill JobData ─────────────────────────────────────────────

describe('ComplianceFillJobData schema', () => {
  const valid = {
    orgId: VALID_UUID,
    orchestrationId: VALID_UUID,
    matrixItemId: VALID_UUID,
    requirementText: 'The vendor shall provide ISO 27001 certification.',
  };

  it('accepts a valid payload without optional category', () => {
    expect(passes(ComplianceFillJobData, valid)).toBe(true);
  });

  it('accepts a valid payload with optional category', () => {
    expect(passes(ComplianceFillJobData, { ...valid, category: 'Security' })).toBe(true);
  });

  it('rejects an empty requirementText (min 1)', () => {
    expect(fails(ComplianceFillJobData, { ...valid, requirementText: '' })).toBe(true);
  });

  it('rejects an invalid matrixItemId UUID', () => {
    expect(fails(ComplianceFillJobData, { ...valid, matrixItemId: BAD_UUID })).toBe(true);
  });

  it('rejects a missing orgId', () => {
    const { orgId: _orgId, ...rest } = valid;
    expect(fails(ComplianceFillJobData, rest)).toBe(true);
  });
});

// ─── rfp-embed-reference JobData ─────────────────────────────────────────────

describe('EmbedReferenceJobData schema', () => {
  const valid = {
    orgId: VALID_UUID,
    referenceId: VALID_UUID,
    contentText: 'Mantu delivered a full-stack cloud migration for Acme in 2023.',
  };

  it('accepts a valid payload', () => {
    expect(passes(EmbedReferenceJobData, valid)).toBe(true);
  });

  it('rejects an invalid referenceId UUID', () => {
    expect(fails(EmbedReferenceJobData, { ...valid, referenceId: BAD_UUID })).toBe(true);
  });

  it('rejects empty contentText (min 1)', () => {
    expect(fails(EmbedReferenceJobData, { ...valid, contentText: '' })).toBe(true);
  });

  it('rejects a missing orgId', () => {
    const { orgId: _orgId, ...rest } = valid;
    expect(fails(EmbedReferenceJobData, rest)).toBe(true);
  });

  it('rejects an invalid orgId UUID', () => {
    expect(fails(EmbedReferenceJobData, { ...valid, orgId: 'aaaa' })).toBe(true);
  });
});

// ─── rfp-embed-requirement JobData ───────────────────────────────────────────

describe('EmbedRequirementJobData schema', () => {
  const valid = {
    orgId: VALID_UUID,
    orchestrationId: VALID_UUID,
    requirementId: VALID_UUID,
    contentText: 'The system shall support SSO via SAML 2.0.',
  };

  it('accepts a valid payload', () => {
    expect(passes(EmbedRequirementJobData, valid)).toBe(true);
  });

  it('rejects an invalid requirementId UUID', () => {
    expect(fails(EmbedRequirementJobData, { ...valid, requirementId: BAD_UUID })).toBe(true);
  });

  it('rejects an invalid orchestrationId UUID', () => {
    expect(fails(EmbedRequirementJobData, { ...valid, orchestrationId: 'XXXX' })).toBe(true);
  });

  it('rejects empty contentText', () => {
    expect(fails(EmbedRequirementJobData, { ...valid, contentText: '' })).toBe(true);
  });

  it('rejects a missing requirementId', () => {
    const { requirementId: _id, ...rest } = valid;
    expect(fails(EmbedRequirementJobData, rest)).toBe(true);
  });
});
