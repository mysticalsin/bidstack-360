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
