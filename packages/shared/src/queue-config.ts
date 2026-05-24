// Shared BullMQ queue configuration. Producer-side (apps/api) and
// consumer-side (apps/worker) MUST construct their Queue/Worker handles
// with the same defaults or jobs get retried/cleaned up inconsistently.
// Keep the literal values here and import from both sides.
//
// Structural typing for the defaults (vs. `JobsOptions` from bullmq) keeps
// @bidstack/shared free of a runtime bullmq dependency — only apps that
// actually enqueue/process jobs need bullmq installed.

export interface QueueDefaults {
  attempts: number;
  backoff: { type: 'exponential' | 'fixed'; delay: number };
  removeOnComplete: { age: number; count?: number };
  removeOnFail: { age: number; count?: number };
}

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
    removeOnFail: { age: 604_800, count: 100 },
  },
};

/** Dust workspace poller — short backoff, 3 attempts. */
export const DUST_POLL: QueueConfig = {
  name: 'dust-poll',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 100 },
    removeOnFail: { age: 604_800, count: 50 },
  },
};

/** Dust webhook processor — drains sync_events written by /webhooks/dust. */
export const DUST_WEBHOOK_PROCESSOR: QueueConfig = {
  name: 'dust-webhook',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 100 },
    removeOnFail: { age: 604_800, count: 50 },
  },
};

/** Document intelligence extraction — reads file, calls LLM, writes solutions/products. */
export const DOCUMENT_EXTRACT: QueueConfig = {
  name: 'document-extract',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 100 },
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
    removeOnFail: { age: 604_800, count: 200 },
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
    removeOnFail: { age: 604_800, count: 100 },
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
    removeOnFail: { age: 604_800, count: 50 },
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
    removeOnFail: { age: 86_400 * 30, count: 200 },
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
    removeOnFail: { age: 604_800, count: 100 },
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
    removeOnFail: { age: 86_400 * 7, count: 200 },
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
    removeOnFail: { age: 604_800 * 2, count: 200 }, // keep failures 14d for DLQ
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
    removeOnFail: { age: 604_800, count: 200 },
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
    removeOnFail: { age: 604_800, count: 200 },
  },
};
