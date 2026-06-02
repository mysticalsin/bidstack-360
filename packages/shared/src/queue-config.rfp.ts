/**
 * queue-config.rfp.ts — Wave 9 RFP Automation Engine queue constants.
 *
 * Extracted from queue-config.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from queue-config.ts barrel).
 */
import type { QueueConfig } from './queue-config.core.js';

// ─── Wave 9: RFP Automation Engine queues ─────────────────────────────────

/**
 * rfp.orchestrate — FlowProducer conductor.
 * One job per RFP upload. Spawns all downstream jobs via BullMQ FlowProducer.
 * concurrency: 1 per org to prevent duplicate pipeline runs.
 * WHY no retry: if orchestration fails, re-upload is required (fresh pipeline).
 */
export const RFP_ORCHESTRATE: QueueConfig = {
  name: 'rfp.orchestrate',
  defaultJobOptions: {
    attempts: 1,
    backoff: { type: 'fixed', delay: 0 },
    removeOnComplete: { age: 86_400 * 7, count: 100 },
    removeOnFail: { age: 86_400 * 30, count: 500 },
  },
};

/**
 * rfp.requirement-extract — Calls rfp-extractor-agent via Dust.
 * Extracts structured requirements from RFP document text.
 * concurrency: 2 (Dust API rate limit headroom).
 * exponential backoff: Dust API may be temporarily unavailable.
 */
export const RFP_REQUIREMENT_EXTRACT: QueueConfig = {
  name: 'rfp.requirement-extract',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400 * 7, count: 500 },
    removeOnFail: { age: 86_400 * 30, count: 500 },
  },
};

/**
 * rfp.story-match — Hybrid retrieval + Dust rfp-story-matcher-agent.
 * One job per extracted requirement. Fan-out from rfp.orchestrate.
 * concurrency: 16 (CPU-bound hybrid scoring dominates over I/O).
 * WHY 4 attempts: cosine search + Dust call both have transient failure modes.
 */
export const RFP_STORY_MATCH: QueueConfig = {
  name: 'rfp.story-match',
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400 * 7, count: 5_000 },
    removeOnFail: { age: 86_400 * 30, count: 5_000 },
  },
};

/**
 * rfp.compliance-fill — Dust rfp-compliance-fill-agent per compliance matrix row.
 * concurrency: 6 (compliance matrices can have 200+ rows; 6 prevents Dust overload).
 */
export const RFP_COMPLIANCE_FILL: QueueConfig = {
  name: 'rfp.compliance-fill',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400 * 7, count: 5_000 },
    removeOnFail: { age: 86_400 * 30, count: 5_000 },
  },
};

/**
 * rfp.section-draft — Dust rfp-draft-agent per proposal section.
 * concurrency: 4 (section drafts are long; cap to avoid token budget spikes).
 * WHY longer backoff (15s): section drafts are expensive Dust calls.
 */
export const RFP_SECTION_DRAFT: QueueConfig = {
  name: 'rfp.section-draft',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 86_400 * 7, count: 500 },
    removeOnFail: { age: 86_400 * 30, count: 500 },
  },
};

/**
 * rfp.legal-scan — Dust rfp-legal-scan-agent on assembled draft.
 * Sequential (runs after all section drafts complete).
 * concurrency: 4, HIGH priority.
 */
export const RFP_LEGAL_SCAN: QueueConfig = {
  name: 'rfp.legal-scan',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400 * 7, count: 200 },
    removeOnFail: { age: 86_400 * 30, count: 200 },
  },
};

/**
 * rfp.qa-review — Dust rfp-qa-agent + hallucination detection.
 * Runs after legal scan. Output enters human approval gate.
 * WHY 2 attempts only: if QA fails twice, human intervention required.
 */
export const RFP_QA_REVIEW: QueueConfig = {
  name: 'rfp.qa-review',
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400 * 7, count: 200 },
    removeOnFail: { age: 86_400 * 30, count: 200 },
  },
};

/**
 * rfp.proposal-compile — Assembles all drafted sections into final proposal.
 * Runs after legal scan. Sequential (one per proposal).
 * concurrency: 2 (long-running Dust call).
 */
export const RFP_PROPOSAL_COMPILE: QueueConfig = {
  name: 'rfp.proposal-compile',
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 86_400 * 7, count: 200 },
    removeOnFail: { age: 86_400 * 30, count: 200 },
  },
};

/**
 * rfp.embed-reference — Generates + upserts ReferenceEmbedding for a success story.
 * Triggered on SuccessStory create/update. LOW priority (background enrichment).
 * WHY 5 attempts: embedding API (Cohere/OpenAI) occasionally rate-limits.
 */
export const RFP_EMBED_REFERENCE: QueueConfig = {
  name: 'rfp.embed-reference',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 86_400 * 7, count: 1_000 },
  },
};

/**
 * rfp.embed-requirement — Generates + upserts RequirementEmbedding for an extracted requirement.
 * Triggered after rfp.requirement-extract completes per requirement.
 * WHY 5 attempts: same embedding API rate-limit rationale as rfp.embed-reference.
 */
export const RFP_EMBED_REQUIREMENT: QueueConfig = {
  name: 'rfp.embed-requirement',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 86_400 * 7, count: 5_000 },
  },
};

/** Convenience map: queue name → config. Used by worker bootstrap for fan-out registration. */
export const RFP_QUEUES = {
  ORCHESTRATE: RFP_ORCHESTRATE,
  REQUIREMENT_EXTRACT: RFP_REQUIREMENT_EXTRACT,
  STORY_MATCH: RFP_STORY_MATCH,
  COMPLIANCE_FILL: RFP_COMPLIANCE_FILL,
  SECTION_DRAFT: RFP_SECTION_DRAFT,
  LEGAL_SCAN: RFP_LEGAL_SCAN,
  PROPOSAL_COMPILE: RFP_PROPOSAL_COMPILE,
  QA_REVIEW: RFP_QA_REVIEW,
  EMBED_REFERENCE: RFP_EMBED_REFERENCE,
  EMBED_REQUIREMENT: RFP_EMBED_REQUIREMENT,
} as const;

export type RfpQueueName = (typeof RFP_QUEUES)[keyof typeof RFP_QUEUES]['name'];
