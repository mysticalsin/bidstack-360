import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

import { type Queue, type Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { prisma } from '@bidstack/db';

import { startCompanyEnrichApollo } from './queues/company-enrich-apollo.js';
import { startDustPoller } from './queues/dust-poll.js';
import { startWebhookProcessor } from './queues/webhook-processor.js';
import { startDocumentExtract } from './queues/document-extract.js';
import { startCalendarSync } from './queues/calendar-sync.js';
import { startEmailSync } from './queues/email-sync.js';
import { startSmsWorker } from './queues/sms.js';
import { startNativePushWorker } from './queues/notifications.js';
import { startWebhookDeliveryWorker } from './queues/webhook-delivery.js';
// Wave 8 — Y.js CRDT compaction
import { startYjsCompaction } from './queues/yjs-compaction.js';
// Wave 8 — Customer Success workers
import { startCsWorkers } from './queues/cs.js';
// Wave 8 — Call-processing pipeline (fetch-recording → transcribe → analyze → update-deal)
import { startCallWorkers } from './queues/calls.js';
// Wave 8 — Predictive ML scoring retrain worker
import { startPredictiveRetrainWorker } from './queues/predictive-retrain.js';
// Wave 9 — RFP Automation Engine workers
import { startRfpOrchestrator, startRfpOrchestrationReaper } from './queues/rfp-orchestrator.js';
import { startRfpRequirementExtract } from './queues/rfp-requirement-extract.js';
import { startRfpStoryMatch } from './queues/rfp-story-match.js';
import { startRfpSectionDraft } from './queues/rfp-section-draft.js';
import { startRfpComplianceFill } from './queues/rfp-compliance-fill.js';
import { startRfpEmbedReference } from './queues/rfp-embed-reference.js';
import { startRfpEmbedRequirement } from './queues/rfp-embed-requirement.js';
import { startRfpLegalScan } from './queues/rfp-legal-scan.js';
import { startRfpProposalCompile } from './queues/rfp-proposal-compile.js';
import { startRfpQaReview } from './queues/rfp-qa-review.js';
import { startCrewRun, startCrewRunReaper } from './queues/crew-run.js';
import { startSignatureWorkers } from './queues/signatures.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
  name: 'worker',
});

// Fail fast on bad production config instead of booting "healthy" and failing
// every job. Postgres + Redis are the worker's universal hard dependencies; the
// API enforces its own env via getEnv(), but the worker can't import that
// app-specific schema, so it checks its must-haves here. (DATABASE_URL is read
// by the Prisma client; REDIS_URL by every BullMQ queue below.)
if (process.env.NODE_ENV === 'production') {
  const missing = (['DATABASE_URL', 'REDIS_URL'] as const).filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    log.fatal({ missing }, 'worker: missing required production env — refusing to boot');
    process.exit(1);
  }
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
const redisEndpoint = (() => {
  try {
    const url = new URL(redisUrl);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return 'redis://<invalid-url>';
  }
})();

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => log.error({ err }, 'redis error'));
connection.on('connect', () => log.info({ redisEndpoint }, 'redis connected'));

const workers: Worker[] = [];
const queues: Queue[] = [];

// WHY separate: startCallWorkers has a different signature — returns Worker[]
// synchronously (no queue/workers arrays) and does not need to be awaited.
workers.push(...startCallWorkers(connection, log, queues));

await Promise.all([
  startDustPoller(connection, log, workers, queues),
  startWebhookProcessor(connection, log, workers, queues),
  startCompanyEnrichApollo(connection, log, workers, queues),
  startDocumentExtract(connection, log, workers, queues),
  startCalendarSync(connection, log, workers, queues),
  startEmailSync(connection, log, workers, queues),
  startSmsWorker(connection, log, workers as never, queues),
  startNativePushWorker(connection, log, workers, queues),
  startWebhookDeliveryWorker(connection, log, workers, queues),
  startYjsCompaction(connection, log, workers, queues),
  startCsWorkers(connection, log, workers, queues),
  startPredictiveRetrainWorker(connection, log, workers, queues),
  // Wave 9 — RFP Automation Engine
  startRfpOrchestrator(connection, log, workers, queues),
  startRfpOrchestrationReaper(connection, log, workers, queues),
  startRfpRequirementExtract(connection, log, workers, queues),
  startRfpStoryMatch(connection, log, workers, queues),
  startRfpSectionDraft(connection, log, workers, queues),
  startRfpComplianceFill(connection, log, workers, queues),
  startRfpEmbedReference(connection, log, workers, queues),
  startRfpEmbedRequirement(connection, log, workers, queues),
  // Wave 9 — RFP late-pipeline consumers. Chain:
  // section_draft (all done) -> legal_scan -> proposal_compile -> qa_review -> awaiting_approval
  startRfpLegalScan(connection, log, workers, queues),
  startRfpProposalCompile(connection, log, workers, queues),
  startRfpQaReview(connection, log, workers, queues),
  startSignatureWorkers(connection, log, workers, queues),
  // Wave 10 — Crew (CrewAI-style multi-agent) execution
  startCrewRun(connection, log, workers, queues),
  startCrewRunReaper(connection, log, workers, queues),
]);

log.info(
  'BidStack worker ready (dust-poll + webhook-processor + company-enrich-apollo + document-extract + calendar-sync + email-sync + sms + native-push + webhook-delivery + yjs-compact + cs + call-processing + predictive-retrain + rfp-orchestrator + rfp-requirement-extract + rfp-story-match + rfp-section-draft + rfp-compliance-fill + rfp-embed-reference + rfp-embed-requirement)',
);

const healthPort = Number(process.env.WORKER_HEALTH_PORT || 4002);

const healthServer = http.createServer((_req, res) => {
  // Probe BOTH dependencies: nearly every queue handler hits Postgres, so a
  // worker with a dead DB must not report healthy (it would keep receiving jobs
  // it can only fail).
  void (async () => {
    const redisReady = connection.status === 'ready';
    let dbReady: boolean;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      dbReady = false;
    }
    const ok = redisReady && dbReady;
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: ok ? 'ok' : 'error',
        queue: redisReady ? 'connected' : 'disconnected',
        db: dbReady ? 'connected' : 'disconnected',
      }),
    );
  })();
});

healthServer.listen(healthPort, () => {
  log.info({ healthPort }, 'health server listening');
});

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down worker');
  const timeout = setTimeout(() => {
    log.error('forced exit after timeout');
    process.exit(1);
  }, 10_000);
  try {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
    await connection.quit();
    healthServer.close();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'shutdown error');
    clearTimeout(timeout);
    process.exit(1);
  }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
