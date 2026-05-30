/**
 * Call processing BullMQ workers — Wave 8 Voice + Video.
 *
 * Four queues processed here (in pipeline order):
 *
 *  1. call.fetch-recording   — downloads MP4/MP3/WebM from provider to S3.
 *  2. call.transcribe        — submits S3 audio to Deepgram; writes transcript.
 *  3. call.analyze           — Claude MEDDIC analysis; writes CallSummary rows.
 *  4. call.update-deal       — proposes stage updates via in-app notification.
 *
 * Pipeline:
 *  webhook → call.fetch-recording → call.transcribe → call.analyze → call.update-deal
 *
 * WHY separate queues instead of a single chain:
 *  - Each stage can fail independently and retry without repeating earlier stages.
 *  - call.analyze can be re-triggered manually (POST /calls/:id/extract-insights)
 *    without re-fetching or re-transcribing.
 *  - Different concurrency limits per stage (S3 I/O bound vs LLM rate-limited).
 *
 * PII: transcriptText may contain names, phone numbers, financials.
 *  - Deepgram `redact` option masks PCI data server-side.
 *  - If PII_FIELD_ENCRYPTION=true, transcriptText is encrypted before DB write.
 *    (Encryption is enforced by the PII cipher from @bidstack/shared/crypto.)
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  CALL_FETCH_RECORDING,
  CALL_TRANSCRIBE,
  CALL_ANALYZE,
  CALL_UPDATE_DEAL,
} from '@bidstack/shared';
import { transcribeAudioUrl } from '../../src/services/calls/transcription.service.js';
import {
  analyzeCallTranscript,
  meddicDimensionToKey,
} from '../../src/services/calls/analysis.service.js';
import {
  uploadRecording,
  getSignedRecordingUrl,
} from '../../src/services/calls/recording-storage.service.js';
import { downloadTwilioRecording } from '../../src/services/calls/twilio-voice.service.js';
import { getZoomRecordings } from '../../src/services/calls/zoom.service.js';

// ─── Job data schemas ──────────────────────────────────────────────────────

const FetchRecordingJobData = z.object({
  callSessionId: z.string().uuid(),
  orgId: z.string().uuid(),
  provider: z.enum(['ZOOM', 'TEAMS', 'GOOGLE_MEET', 'TWILIO_VOICE']),
  /** For Zoom: the double-encoded meeting UUID. */
  meetingUuid: z.string().optional(),
  /** For Twilio Voice: the recording URL (unauthenticated MP3 URL). */
  recordingUrl: z.string().url().optional(),
  recordingSid: z.string().optional(),
});

const TranscribeJobData = z.object({
  callSessionId: z.string().uuid(),
  orgId: z.string().uuid(),
  /** S3 object key for the recording — will be signed before sending to Deepgram. */
  s3Key: z.string(),
  /** Whether the recording has dual (stereo) channels (Twilio dual-channel). */
  dualChannel: z.boolean().default(false),
});

const AnalyzeJobData = z.object({
  callSessionId: z.string().uuid(),
  orgId: z.string().uuid(),
});

const UpdateDealJobData = z.object({
  callSessionId: z.string().uuid(),
  orgId: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  /** High-confidence suggestions from the analyze pass. */
  suggestions: z.array(
    z.object({
      field: z.enum(['stage', 'amount', 'closeDate', 'nextStep']),
      suggestedValue: z.string(),
      rationale: z.string(),
      confidence: z.number(),
    }),
  ),
});

// ─── Queue factory helpers ─────────────────────────────────────────────────

function makeQueue(config: typeof CALL_FETCH_RECORDING, redis: IORedis): Queue {
  return new Queue(config.name, {
    connection: redis,
    defaultJobOptions: config.defaultJobOptions,
  });
}

// ─── Worker 1: fetch-recording ─────────────────────────────────────────────

async function processFetchRecording(
  job: Job,
  transcribeQueue: Queue,
  log: pino.Logger,
): Promise<void> {
  const data = FetchRecordingJobData.parse(job.data);
  const { callSessionId, provider } = data;

  log.info({ callSessionId, provider }, 'call.fetch-recording: starting');

  let audioBuffer: Buffer | null = null;
  let mimeType = 'audio/mp3';

  if (provider === 'TWILIO_VOICE' && data.recordingUrl) {
    audioBuffer = await downloadTwilioRecording(data.recordingUrl);
    mimeType = 'audio/mp3';
  } else if (provider === 'ZOOM' && data.meetingUuid) {
    const files = await getZoomRecordings(data.meetingUuid);
    // Prefer MP4 audio-only track; fall back to the first audio file
    const audioFile =
      files.find((f) => f.file_type === 'M4A') ??
      files.find((f) => f.file_type === 'MP4') ??
      files[0];

    if (!audioFile?.download_url) {
      throw new Error(`Zoom: no recording files found for meeting ${data.meetingUuid}`);
    }

    // Zoom recording downloads require the access token — fetch via S3 redirect
    // For Zoom, the download_url requires Authorization: Bearer <token>
    // We upload directly from the Zoom URL via Deepgram's URL mode to avoid
    // large buffer allocations for long meetings. Store the raw URL as recordingUrl.
    await prisma.callSession.update({
      where: { id: callSessionId },
      data: { recordingUrl: audioFile.download_url },
    });

    // Enqueue transcription using the Zoom URL directly (Deepgram fetches it)
    await transcribeQueue.add('transcribe', {
      callSessionId,
      orgId: data.orgId,
      s3Key: audioFile.download_url, // Zoom URL used directly
      dualChannel: false,
    } satisfies z.infer<typeof TranscribeJobData>);

    log.info(
      { callSessionId },
      'call.fetch-recording: Zoom recording URL stored, transcribe queued',
    );
    return;
  } else if (provider === 'TEAMS' || provider === 'GOOGLE_MEET') {
    // Teams/Meet recordings are accessed via provider-specific auth.
    // Store placeholder — full download requires per-user OAuth not available in worker.
    // TODO: implement when delegated recording access is configured.
    log.warn(
      { callSessionId, provider },
      'call.fetch-recording: provider recording download not yet implemented; skipping',
    );
    await prisma.callSession.update({
      where: { id: callSessionId },
      data: { status: 'COMPLETED' },
    });
    return;
  }

  if (!audioBuffer) {
    throw new Error(`No audio buffer obtained for ${provider} call ${callSessionId}`);
  }

  // Upload to S3
  const s3Key = await uploadRecording(callSessionId, audioBuffer, mimeType);

  await prisma.callSession.update({
    where: { id: callSessionId },
    data: { recordingUrl: s3Key },
  });

  // Enqueue transcription
  await transcribeQueue.add('transcribe', {
    callSessionId,
    orgId: data.orgId,
    s3Key,
    dualChannel: provider === 'TWILIO_VOICE',
  } satisfies z.infer<typeof TranscribeJobData>);

  log.info({ callSessionId, s3Key }, 'call.fetch-recording: uploaded to S3, transcribe queued');
}

// ─── Worker 2: transcribe ──────────────────────────────────────────────────

async function processTranscribe(job: Job, analyzeQueue: Queue, log: pino.Logger): Promise<void> {
  const data = TranscribeJobData.parse(job.data);
  const { callSessionId, s3Key, dualChannel } = data;

  log.info({ callSessionId }, 'call.transcribe: starting');

  let transcriptionUrl = s3Key;

  // If stored as an S3 key (not a full URL), sign it
  if (!s3Key.startsWith('http')) {
    transcriptionUrl = await getSignedRecordingUrl(s3Key);
  }

  const result = await transcribeAudioUrl(transcriptionUrl, dualChannel);

  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      transcriptText: result.text,
      transcriptStructured: result.segments as unknown as Prisma.InputJsonValue,
    },
  });

  // Enqueue analysis
  await analyzeQueue.add('analyze', {
    callSessionId,
    orgId: data.orgId,
  } satisfies z.infer<typeof AnalyzeJobData>);

  log.info(
    { callSessionId, segments: result.segments.length, confidence: result.confidence },
    'call.transcribe: transcript stored, analyze queued',
  );
}

// ─── Worker 3: analyze ────────────────────────────────────────────────────

async function processAnalyze(job: Job, updateDealQueue: Queue, log: pino.Logger): Promise<void> {
  const data = AnalyzeJobData.parse(job.data);
  const { callSessionId } = data;

  log.info({ callSessionId }, 'call.analyze: starting');

  const session = await prisma.callSession.findUnique({
    where: { id: callSessionId },
    select: {
      transcriptText: true,
      transcriptStructured: true,
      entityType: true,
      entityId: true,
    },
  });

  if (!session?.transcriptText) {
    throw new Error(`call.analyze: No transcript for session ${callSessionId}`);
  }

  const segments = Array.isArray(session.transcriptStructured)
    ? (session.transcriptStructured as Array<{
        speaker: string;
        startMs: number;
        endMs: number;
        text: string;
      }>)
    : [];

  const insights = await analyzeCallTranscript(session.transcriptText, segments);

  // Write insights back to CallSession
  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      summary: insights.summary,
      actionItems: insights.actionItems as unknown as Prisma.InputJsonValue,
      sentimentScore: insights.sentimentScore,
      talkRatio: insights.talkRatio as unknown as Prisma.InputJsonValue,
    },
  });

  // Write MEDDIC signals as CallSummary rows
  if (insights.meddicSignals.length > 0) {
    // Delete existing summaries for this session to avoid duplicates on re-analysis
    await prisma.callSummary.deleteMany({ where: { callSessionId } });

    await prisma.callSummary.createMany({
      data: insights.meddicSignals.map((signal) => ({
        callSessionId,
        orgId: data.orgId,
        key: meddicDimensionToKey(signal.dimension),
        value: signal.value,
        confidence: signal.confidence,
        sourceQuoteRef: signal.sourceQuoteRef,
      })),
    });
  }

  log.info(
    {
      callSessionId,
      meddicSignals: insights.meddicSignals.length,
      actionItems: insights.actionItems.length,
      sentiment: insights.sentimentScore,
    },
    'call.analyze: insights written',
  );

  // Enqueue deal-update suggestions for high-confidence signals
  const highConfidence = insights.dealSuggestions.filter((s) => s.confidence >= 0.8);
  if (highConfidence.length > 0 && session.entityId) {
    await updateDealQueue.add('suggest-deal-update', {
      callSessionId,
      orgId: data.orgId,
      entityType: session.entityType,
      entityId: session.entityId,
      suggestions: highConfidence,
    } satisfies z.infer<typeof UpdateDealJobData>);
  }
}

// ─── Worker 4: update-deal ────────────────────────────────────────────────

async function processUpdateDeal(job: Job, log: pino.Logger): Promise<void> {
  const data = UpdateDealJobData.parse(job.data);
  const { callSessionId, entityType, entityId, suggestions, orgId } = data;

  log.info(
    { callSessionId, entityType, entityId, suggestions: suggestions.length },
    'call.update-deal: creating in-app notifications',
  );

  // HUMAN-IN-THE-LOOP: never auto-apply deal changes.
  // Create an AiInsight notification for each suggestion.
  // The rep sees these as "AI suggested: move deal to Proposal stage" and can accept/dismiss.
  for (const suggestion of suggestions) {
    await prisma.aiInsight.create({
      data: {
        orgId,
        kind: `CALL_DEAL_SUGGESTION_${suggestion.field.toUpperCase()}`,
        title: `Call suggestion: ${suggestion.field}`,
        summary: `AI suggestion (${Math.round(suggestion.confidence * 100)}% confidence): ${suggestion.rationale}`,
        opportunityId: entityType.toLowerCase() === 'opportunity' ? entityId : null,
        confidenceBps: Math.round(suggestion.confidence * 10_000),
        sourceAttribution: [
          {
            sourceType: 'CALL_SESSION',
            sourceId: callSessionId,
            suggestedValue: suggestion.suggestedValue,
          },
        ],
        status: 'PENDING',
      },
    });
  }

  log.info({ callSessionId, count: suggestions.length }, 'call.update-deal: notifications created');
}

// ─── Bootstrap function ────────────────────────────────────────────────────

/**
 * Bootstraps all four call-processing workers.
 * Call from apps/worker/src/index.ts.
 */
export function startCallWorkers(redis: IORedis, log: pino.Logger, queues?: Queue[]): Worker[] {
  const transcribeQueue = makeQueue(CALL_TRANSCRIBE, redis);
  const analyzeQueue = makeQueue(CALL_ANALYZE, redis);
  const updateDealQueue = makeQueue(CALL_UPDATE_DEAL, redis);
  // Register the internal queues for graceful shutdown so their buffered Redis
  // writes are flushed on SIGTERM instead of dropped (main.ts closes `queues`).
  queues?.push(transcribeQueue, analyzeQueue, updateDealQueue);

  const fetchWorker = new Worker(
    CALL_FETCH_RECORDING.name,
    (job) => processFetchRecording(job, transcribeQueue, log),
    { connection: redis, concurrency: 5 },
  );

  const transcribeWorker = new Worker(
    CALL_TRANSCRIBE.name,
    (job) => processTranscribe(job, analyzeQueue, log),
    // Concurrency 2 — Deepgram has per-account concurrency limits on free tier
    { connection: redis, concurrency: 2 },
  );

  const analyzeWorker = new Worker(
    CALL_ANALYZE.name,
    (job) => processAnalyze(job, updateDealQueue, log),
    // Concurrency 1 — Claude rate limits; increase per your Anthropic tier
    { connection: redis, concurrency: 1 },
  );

  const updateDealWorker = new Worker(CALL_UPDATE_DEAL.name, (job) => processUpdateDeal(job, log), {
    connection: redis,
    concurrency: 10,
  });

  for (const worker of [fetchWorker, transcribeWorker, analyzeWorker, updateDealWorker]) {
    worker.on('failed', (job, err) => {
      log.error({ jobId: job?.id, queue: job?.queueName, err }, 'Call worker job failed');
    });
    worker.on('completed', (job) => {
      log.info({ jobId: job.id, queue: job.queueName }, 'Call worker job completed');
    });
  }

  return [fetchWorker, transcribeWorker, analyzeWorker, updateDealWorker];
}

// Named exports for the queue configs (used by the API to enqueue jobs)
export { makeQueue };
