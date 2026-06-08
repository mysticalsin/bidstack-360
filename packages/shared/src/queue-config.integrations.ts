/**
 * queue-config.integrations.ts — Wave 4–8 integration + ML queue constants.
 *
 * Extracted from queue-config.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from queue-config.ts barrel).
 */
import type { QueueConfig } from './queue-config.core.js';

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

/**
 * competitor.research — grounded, cited competitor intelligence run.
 * One job per (competitorProfile [, opportunity]). Pulls USASpending award
 * pricing + optional SSRF-guarded web search → cite-or-omit extraction → writes
 * CompetitorInsight rows. concurrency 2 (external I/O bound, modest).
 * WHY 3 attempts: public APIs + provider calls have transient failures; the run
 * is idempotent (supersede-then-insert), so a retry is safe.
 */
export const COMPETITOR_RESEARCH: QueueConfig = {
  name: 'competitor.research',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400 * 7, count: 200 },
    removeOnFail: { age: 86_400 * 30, count: 500 },
  },
};
