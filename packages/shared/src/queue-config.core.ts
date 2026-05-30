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

/**
 * Crew run — executes a CrewAI-style multi-agent crew (kickoff) and persists
 * the result. Few attempts: the agents fail open, so a hard failure is usually
 * a definition/DB issue not worth hammering.
 */
export const CREW_RUN: QueueConfig = {
  name: 'crew-run',
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 200 },
    removeOnFail: { age: 604_800, count: 5000 },
  },
};
