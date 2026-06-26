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
import { startWebhookDeliveryWorker } from './queues/webhook-delivery.js';
// Wave 8 — Y.js CRDT compaction
import { startYjsCompaction } from './queues/yjs-compaction.js';
// Wave 8 — Customer Success workers
import { startCsWorkers } from './queues/cs.js';
// Wave 8 — Call-processing pipeline (fetch-recording → transcribe → analyze → update-deal)
import { startCallWorkers } from './queues/calls.js';
// Wave 8 — Predictive ML scoring retrain worker
import { startPredictiveRetrainWorker } from './queues/predictive-retrain.js';
import { startCompetitorResearch } from './queues/competitor-research.js';
// Workflow automation — trigger dispatch (record_created / stage_changed) + schedule cron
import { startWorkflowDispatchWorker } from './queues/workflow-dispatch.js';
import { startWorkflowScheduleWorker } from './queues/workflow-schedule.js';
// Bid-deadline alerts (7/3/1 days) + scheduled analytics reports — repeatable scans
import { startBidDeadlineAlerts } from './queues/bid-deadline-alerts.js';
import { startScheduledReports } from './queues/scheduled-reports.js';
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
import { startMigrationWorker } from './queues/migration.js';
import { startSentrySmokeWorker } from './queues/sentry-smoke.js';
// GDPR Art. 20 — tenant data-portability export
import { startTenantExport } from './queues/tenant-export.js';
// EU AI Act Art. 50 / GDPR Art. 22 — AI audit log retention purge (daily)
import { startAiAuditRetention } from './queues/ai-audit-retention.js';
import { attachSentryToWorker, initWorkerSentry } from './plugins/sentry.js';
import { assertWorkerProductionEnv } from './lib/production-env.js';
import {
  attachMetricsToWorker,
  metricsAccessAllowed,
  renderMetrics,
  startQueueDepthCollector,
} from './lib/metrics.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
  name: 'worker',
});

// Fail fast on bad production config instead of booting "healthy" and failing
// jobs later when a queue first hits Postgres, Redis, encrypted provider tokens,
// or durable object storage.
try {
  assertWorkerProductionEnv(process.env);
} catch (err) {
  log.fatal({ err }, 'worker: invalid production env - refusing to boot');
  process.exit(1);
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
initWorkerSentry(log);

// WHY separate: startCallWorkers has a different signature — returns Worker[]
// synchronously (no queue/workers arrays) and does not need to be awaited.
workers.push(...startCallWorkers(connection, log, queues));

// Start the webhook-delivery worker FIRST and capture its producer queue: the
// workflow engine's `call_webhook` effect reuses this single queue instead of
// opening (and leaking) a new one per dispatch job / schedule scan.
const webhookDeliveryQueue = await startWebhookDeliveryWorker(connection, log, workers, queues);

await Promise.all([
  startDustPoller(connection, log, workers, queues),
  startWebhookProcessor(connection, log, workers, queues),
  startCompanyEnrichApollo(connection, log, workers, queues),
  startDocumentExtract(connection, log, workers, queues),
  startCalendarSync(connection, log, workers, queues),
  startEmailSync(connection, log, workers, queues),
  startSmsWorker(connection, log, workers as never, queues),
  startYjsCompaction(connection, log, workers, queues),
  startCsWorkers(connection, log, workers, queues),
  startPredictiveRetrainWorker(connection, log, workers, queues),
  startCompetitorResearch(connection, log, workers, queues),
  // Workflow automation engine — reuses the webhook-delivery producer queue.
  startWorkflowDispatchWorker(connection, log, workers, queues, webhookDeliveryQueue),
  startWorkflowScheduleWorker(connection, log, workers, queues, webhookDeliveryQueue),
  // Bid-deadline alerts + scheduled analytics reports (repeatable, org-scoped scans)
  startBidDeadlineAlerts(connection, log, workers, queues),
  startScheduledReports(connection, log, workers, queues),
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
  // Migration connector (CSV / Salesforce CSV / HubSpot) import consumer
  startMigrationWorker(connection, log, workers, queues),
  startSentrySmokeWorker(connection, log, workers, queues),
  // GDPR Art. 20 — tenant data-portability export
  startTenantExport(connection, log, workers, queues),
  // EU AI Act Art. 50 / GDPR Art. 22 — AI audit log retention purge (daily)
  startAiAuditRetention(connection, log, workers, queues),
]);

for (const worker of workers) {
  attachSentryToWorker(worker, worker.name, log);
  attachMetricsToWorker(worker, worker.name);
}

// Periodic queue-depth gauges (waiting/active per queue) for backpressure alerts.
const queueDepthCollector = startQueueDepthCollector(queues, log);

log.info(
  'BidStack worker ready (dust-poll + webhook-processor + company-enrich-apollo + document-extract + calendar-sync + email-sync + sms + webhook-delivery + yjs-compact + cs + call-processing + predictive-retrain + rfp-orchestrator + rfp-requirement-extract + rfp-story-match + rfp-section-draft + rfp-compliance-fill + rfp-embed-reference + rfp-embed-requirement)',
);

const healthPort = Number(process.env.WORKER_HEALTH_PORT || 4002);

const healthServer = http.createServer((req, res) => {
  // Prometheus scrape endpoint. Outside health auth, but production requires an
  // explicit bearer token (mirrors the API's /metrics guard).
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname === '/metrics') {
    void (async () => {
      if (!metricsAccessAllowed(req.headers.authorization)) {
        res.writeHead(process.env.METRICS_BEARER_TOKEN ? 401 : 404, {
          'Content-Type': 'text/plain',
        });
        res.end('Not found');
        return;
      }
      try {
        const body = await renderMetrics();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(body);
      } catch (err) {
        log.error({ err }, 'failed to render metrics');
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('metrics error');
      }
    })();
    return;
  }

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

// Survive a hot-reload (or any transient port overlap) instead of crashing the
// whole worker over the health endpoint: without an 'error' handler an
// EADDRINUSE is thrown as an unhandled event and kills the process. Retry a
// bounded number of times while the previous instance releases the port.
let healthListenRetries = 0;
healthServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && healthListenRetries < 10) {
    healthListenRetries += 1;
    log.warn(
      { healthPort, attempt: healthListenRetries },
      'health port busy, retrying in 1s (hot-reload overlap?)',
    );
    setTimeout(() => healthServer.listen(healthPort), 1000);
  } else {
    // Non-EADDRINUSE error, or the retry budget is exhausted. Running headless
    // makes an external liveness probe kill the pod anyway, so exit non-zero and
    // let the supervisor (or tsx-watch in dev) restart us cleanly.
    log.error({ err }, 'health server error — exiting for a clean restart');
    process.exit(1);
  }
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
    // Release the health port FIRST so a hot-reload's replacement can bind it
    // without a long EADDRINUSE retry window — BullMQ worker.close() below can
    // take seconds while it drains the active job.
    queueDepthCollector.stop();
    healthServer.close();
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
    await connection.quit();
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

process.on('unhandledRejection', (reason, _promise) => {
  log.fatal({ reason }, 'unhandledRejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
