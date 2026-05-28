// Shared BullMQ queue configuration. Producer-side (apps/api) and
// consumer-side (apps/worker) MUST construct their Queue/Worker handles
// with the same defaults or jobs get retried/cleaned up inconsistently.
// Keep the literal values here and import from both sides.
//
// Structural typing for the defaults (vs. `JobsOptions` from bullmq) keeps
// @bidstack/shared free of a runtime bullmq dependency — only apps that
// actually enqueue/process jobs need bullmq installed.

/**
 * Default job options applied to every job enqueued in a BullMQ queue.
 * Deliberately excludes the bullmq `JobsOptions` type so this package
 * remains free of a runtime bullmq dependency.
 */
export interface QueueDefaults {
  attempts: number;
  backoff: { type: 'exponential' | 'fixed'; delay: number };
  removeOnComplete: { age: number; count?: number };
  removeOnFail: { age: number; count?: number };
}

/**
 * Complete queue configuration shared between producer (API) and consumer (worker).
 * Import the named constant (e.g. {@link COMPANY_ENRICH_APOLLO}) rather than
 * constructing this directly to ensure producer/consumer parity.
 */
export interface QueueConfig {
  /** BullMQ queue name. Single string identifier shared producer ↔ worker. */
  name: string;
  /** Default options applied to every enqueued job in this queue. */
  defaultJobOptions: QueueDefaults;
}

/** Apollo.io data verification queue — long backoff, 5 attempts. */
export const COMPANY_ENRICH_APOLLO: QueueConfig = {
  name: 'company-enrich-apollo',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/** Dust workspace poller — short backoff, 3 attempts. */
export const DUST_POLL: QueueConfig = {
  name: 'dust-poll',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 100 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/** Dust webhook processor — drains sync_events written by /webhooks/dust. */
export const DUST_WEBHOOK_PROCESSOR: QueueConfig = {
  name: 'dust-webhook',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 100 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/** Document intelligence extraction — reads file, calls LLM, writes solutions/products. */
export const DOCUMENT_EXTRACT: QueueConfig = {
  name: 'document-extract',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Calendar push — fires when an event is created/updated/deleted locally.
 * Short backoff because conflicts (412/etag mismatch) need fast resolution.
 */
export const CALENDAR_PUSH: QueueConfig = {
  name: 'calendar-push',
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 3_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Calendar incremental pull — drains changed events from Google sync token
 * or MS Graph delta link. Runs frequently (every ~2 min via scheduler).
 */
export const CALENDAR_PULL_INCREMENTAL: QueueConfig = {
  name: 'calendar-pull-incremental',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Calendar watch renewal — Google push channels expire after 7 days.
 * This job renews them daily. Enqueued by the worker bootstrap cron.
 */
export const CALENDAR_WATCH_RENEW: QueueConfig = {
  name: 'calendar-watch-renew',
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 50 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Migration connector — Salesforce CSV, HubSpot OAuth, and generic CSV.
 * Processes rows in chunks of 100. Long backoff because HubSpot API 429s
 * require waiting 10+ seconds before retrying (Burst tier: 100 req/10s).
 * Jobs are idempotent via external_id deduplication in the worker.
 */
export const MIGRATION: QueueConfig = {
  name: 'migration',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400 * 7, count: 500 }, // keep 7d for audit
    removeOnFail: { age: 86_400 * 30, count: 5000 },
  },
};

// ─── Wave 4: Integration Hub queues ──────────────────────────────────────

/**
 * Email incremental pull — fetches new/changed messages via Gmail history API
 * or MS Graph delta query. Runs every 5 min per active integration token.
 */
export const EMAIL_PULL_INCREMENTAL: QueueConfig = {
  name: 'email-pull-incremental',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Email tracking open — queued by the pixel endpoint to batch DB writes.
 * Low priority; a few seconds of latency is acceptable.
 */
export const EMAIL_TRACK_OPEN: QueueConfig = {
  name: 'email-track-open',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 86_400 * 7, count: 5000 },
  },
};

/**
 * Zapier webhook fan-out — delivers HMAC-signed POST to each active ZapierTrigger
 * subscription. Exponential backoff, dead-letter after 5 failures.
 */
export const ZAPIER_WEBHOOK: QueueConfig = {
  name: 'zapier-webhook',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 604_800 * 2, count: 5000 }, // keep failures 14d for DLQ
  },
};

// ─── Wave 5: Slack notification queues ───────────────────────────────────

/**
 * Slack channel message — posts Block Kit message to a channel.
 * Rate-limited per Slack Tier 3 (≤50 req/sec burst; per-channel 1 msg/s).
 * WHY separate from DM queue: different per-channel rate limits apply.
 */
export const SLACK_SEND_MESSAGE: QueueConfig = {
  name: 'slack.send-message',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Slack DM — opens a 1:1 IM channel via conversations.open and posts.
 * Kept separate from channel messages for rate-limit accounting.
 */
export const SLACK_DM_USER: QueueConfig = {
  name: 'slack.dm-user',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

// ─── Wave 5: Outlook (Microsoft Graph Mail) queues ────────────────────────

/**
 * Outlook incremental pull — delta query via @odata.deltaLink.
 * Triggered by Graph webhook notification or fallback 5-min cron.
 * Respects Retry-After on 429 by moving job to delayed state.
 */
export const OUTLOOK_PULL_INCREMENTAL: QueueConfig = {
  name: 'email.outlook.pull-incremental',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Outlook historical backfill — runs once after first OAuth connection.
 * Resets deltaLink and pulls the full inbox (last ~100 messages).
 */
export const OUTLOOK_PULL_HISTORICAL: QueueConfig = {
  name: 'email.outlook.pull-historical',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 100 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * Outlook subscription renewal — daily cron at 02:00 UTC.
 * Renews GraphSubscription rows expiring within 26 h.
 * Idempotent: re-running is safe.
 */
export const OUTLOOK_SUBSCRIPTION_RENEW: QueueConfig = {
  name: 'email.outlook.subscription-renew',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 86_400, count: 50 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

// ─── Wave 8: Voice + Video call processing queues ────────────────────────

/**
 * call.fetch-recording — downloads provider MP4/WebM to S3 after recording.completed event.
 * WHY exponential long backoff: S3 uploads can transiently fail; provider recording
 * URLs may not be immediately available even after the webhook fires.
 */
export const CALL_FETCH_RECORDING: QueueConfig = {
  name: 'call.fetch-recording',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * call.transcribe — submits audio file to Deepgram for speaker-diarized transcription.
 * WHY separate from fetch-recording: transcription can start as soon as the file is
 * available in S3, independently of any downstream analysis.
 */
export const CALL_TRANSCRIBE: QueueConfig = {
  name: 'call.transcribe',
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * call.analyze — LLM analysis pass: summary, action items, MEDDIC signals, sentiment.
 * WHY separate queue: can be re-triggered manually via POST /calls/:id/extract-insights
 * without re-fetching the recording or re-transcribing.
 */
export const CALL_ANALYZE: QueueConfig = {
  name: 'call.analyze',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

/**
 * call.update-deal — proposes deal-stage updates based on high-confidence call signals.
 * WHY HUMAN-IN-THE-LOOP: Auto-applying deal changes from AI is a business risk.
 * This job creates an in-app notification with a suggested update; the rep decides.
 */
export const CALL_UPDATE_DEAL: QueueConfig = {
  name: 'call.update-deal',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};

// ─── Wave 7: Outbound webhook delivery queues ─────────────────────────────

/**
 * Outbound webhook delivery — HTTP POST with HMAC-SHA256 signature to
 * partner-registered subscription URLs.
 *
 * Retry schedule: immediate → 30 s → 2 min → 15 min → 1 h → 6 h (5 attempts).
 * Dead-letters after 5 failures; increments `failureCount` on the subscription.
 * WHY exponential with large initial delay: partners need time to recover from
 * outages before we bombard them; 30 s covers most transient 500s.
 */
export const WEBHOOK_DELIVERY: QueueConfig = {
  name: 'webhook.delivery',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400 * 7, count: 1_000 }, // 7 days for audit
    removeOnFail: { age: 86_400 * 30, count: 5000 },
  },
};

// ─── Wave 8: Predictive scoring ML queues ────────────────────────────────

/**
 * predictive.retrain — triggered weekly by cron OR manually via
 * POST /admin/predictive/retrain. Trains one logistic-regression model per
 * (orgId, entityType) on the last 12 months of closed deals.
 *
 * WHY single queue, not fan-out per org: jobs are idempotent (modelVersion
 * is content-addressed from trainedAt timestamp). Weekly cadence means low
 * job volume — no per-org queue overhead needed at this scale.
 */
export const PREDICTIVE_RETRAIN: QueueConfig = {
  name: 'predictive.retrain',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 86_400 * 7, count: 200 },
    removeOnFail: { age: 86_400 * 30, count: 5000 },
  },
};

/**
 * predictive.score — on-demand scoring job, enqueued after lead/opp update.
 * Low latency target: should complete in < 500 ms (pure in-process inference).
 * Result cached in Redis for 1 h under key predictive:score:<orgId>:<type>:<entityId>.
 */
export const PREDICTIVE_SCORE: QueueConfig = {
  name: 'predictive.score',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 500 },
    removeOnFail: { age: 86_400, count: 5000 },
  },
};

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
  QA_REVIEW: RFP_QA_REVIEW,
  EMBED_REFERENCE: RFP_EMBED_REFERENCE,
  EMBED_REQUIREMENT: RFP_EMBED_REQUIREMENT,
} as const;

export type RfpQueueName = (typeof RFP_QUEUES)[keyof typeof RFP_QUEUES]['name'];
