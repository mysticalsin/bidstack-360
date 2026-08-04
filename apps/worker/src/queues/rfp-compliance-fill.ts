// RFP compliance fill worker.
//
// Calls Dust rfp-compliance-fill-agent to assess a single compliance matrix
// row — determines YES/NO/PARTIAL compliance and generates a one-line
// justification. Writes result to ComplianceMatrixRow.
//
// WHY per-row: compliance matrices can have 200+ rows. Parallelism
// (concurrency 6) gives a ~35× speedup over serial processing while
// staying within Dust API rate limits.
//
// ─── Two paths, one flag ────────────────────────────────────────────────────
//
// DIRECT WRITE (default, `RFP_PROPOSE_FACTS` unset): unchanged. The model gets
// a bare requirement sentence and its verdict lands on the row uncited.
//
// PROPOSE (`RFP_PROPOSE_FACTS=true`): the model gets the actual source text the
// requirement came from, with a document name and page range, and its answer
// lands as a `BidFact(PROPOSED)` with re-verified citations — never on the row.
// A human promotes it (ADR-0003 Decision 4). Every run passes the SERUM
// propose-only gate first.
//
// The flag is the rollback lever: flipping it off restores the direct path
// exactly, which is why `directWriteData` is shared by both and pinned by test.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumAgentRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';

import { RFP_COMPLIANCE_FILL, rolePreambleForKey } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import { runRfpCompletion } from '../lib/rfp-llm.js';
import { coerceJsonObject } from '../lib/llm-provider.js';
import { WEIGHTS, type EvidenceKind, type Observation } from '../agent/evidence.js';
import {
  chunkIndexById,
  formatPageRange,
  formatSourceContext,
  retrieveMatrixRowContext,
  type RequirementContext,
  type RetrievedMatrixRow,
} from '../agent/retrieval.js';
import { PROPOSER_AGENT_KEY, flagComplianceGap, proposeAnswer } from '../agent/facts.js';

const QUEUE_NAME = RFP_COMPLIANCE_FILL.name;
const DEFAULT_COMPLIANCE_AGENT_ID = 'rfp-compliance-fill-agent';

/** Default OFF. Only the exact string 'true' arms the proposer. */
export function proposeFactsEnabled(): boolean {
  return process.env.RFP_PROPOSE_FACTS === 'true';
}

function defaultSerumConfigEnvironment(): 'dev' | 'staging' | 'production' {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  matrixItemId: z.string().uuid(),
  requirementText: z.string().min(1),
  category: z.string().optional(),
  // ADR-0003 Decision 2: `approvalConfirmed` is a human action, not a config
  // derivation. The autofill route already refuses unless the orchestration is
  // 'approved'; it passes that through here. Absent → false → SERUM denies,
  // which is the correct answer for an unattended run this round.
  approvalConfirmed: z.boolean().default(false),
});
type JobData = z.infer<typeof JobData>;

// ─── Dust response schema ──────────────────────────────────────────────────

const ComplianceResult = z.object({
  status: z.enum(['YES', 'NO', 'PARTIAL', 'NOT_APPLICABLE']),
  justification: z.string().max(1000),
  confidence: z.number().int().min(0).max(10000).optional(),
});
type ComplianceResult = z.infer<typeof ComplianceResult>;

// What the worker persists: a parsed LLM verdict (ASSESSED) or the fallback
// (UNAVAILABLE). The fallback deliberately carries NO verdict and a null
// confidence — the old PARTIAL/0 made "the AI never ran" indistinguishable
// from "the AI found partial compliance" (fusion Phase 6: unknown ≠ bad).
type ComplianceAssessment =
  | { assessmentStatus: 'ASSESSED'; verdict: ComplianceResult }
  | { assessmentStatus: 'UNAVAILABLE'; confidence: null };

// ─── Deterministic fallback ─────────────────────────────────────────────────

// Exported for the unknown-not-bad regression test (rfp-fallback-assessment.test.ts).
export function fallbackCompliance(): ComplianceAssessment {
  return {
    assessmentStatus: 'UNAVAILABLE',
    confidence: null,
  };
}

/**
 * The ComplianceMatrixRow payload the direct-write path has always produced.
 *
 * Extracted (not changed) so the rollback lever is testable: with
 * `RFP_PROPOSE_FACTS` off the worker must write exactly this and nothing else,
 * and `rfp-compliance-fill.propose.test.ts` pins it field for field.
 */
export function directWriteData(result: ComplianceAssessment): {
  responseStatus?: string;
  answerDraft?: string;
  confidenceBps: number | null;
  assessmentStatus: 'ASSESSED' | 'UNAVAILABLE';
} {
  if (result.assessmentStatus === 'ASSESSED') {
    // WHY responseStatus + answerDraft: responseStatus holds the compliance
    // verdict; answerDraft holds the AI-generated justification text.
    // confidenceBps is the assessment's own confidence (previously discarded).
    return {
      responseStatus: result.verdict.status,
      answerDraft: result.verdict.justification,
      confidenceBps: result.verdict.confidence ?? null,
      assessmentStatus: 'ASSESSED',
    };
  }
  // Fallback: record only that assessment could not run. Deliberately does
  // NOT write a fake PARTIAL verdict or 0 confidence — the row keeps its
  // prior responseStatus and the UI renders "not assessed".
  return { assessmentStatus: 'UNAVAILABLE', confidenceBps: null };
}

// ─── Proposal schema (propose path) ────────────────────────────────────────

// Built from the ledger's own price list so a new evidence kind cannot be
// accepted from the model before `evidence.ts` knows how to price it.
const EVIDENCE_KINDS = Object.keys(WEIGHTS) as [EvidenceKind, ...EvidenceKind[]];

// zod strips unknown keys, so a `confidence` the model volunteers is dropped
// here and never reaches the ledger. The model reports what it observed; the
// ledger prices it (ADR-0004 Decision 5).
const ProposedAnswer = z.object({
  status: z.enum(['YES', 'NO', 'PARTIAL', 'NOT_APPLICABLE']),
  justification: z.string().min(1).max(1000),
  evidence: z
    .array(
      z.object({
        kind: z.enum(EVIDENCE_KINDS),
        detail: z.string().min(1).max(300),
        sourceChunkId: z.string().uuid().optional(),
      }),
    )
    .max(20)
    .default([]),
  citations: z
    .array(
      z.object({
        sourceChunkId: z.string().uuid(),
        quote: z.string().min(1).max(600),
      }),
    )
    .max(20)
    .default([]),
});
type ProposedAnswer = z.infer<typeof ProposedAnswer>;

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, matrixItemId, requirementText, category } = parsed.data;

  // Verify compliance row belongs to this org — uses existing ComplianceMatrixRow model
  const item = await prisma.complianceMatrixRow.findUnique({
    where: { id: matrixItemId },
    select: { id: true, orgId: true },
  });
  if (!item || item.orgId !== orgId) {
    const err = new Error(
      `rfp-compliance-fill: matrixItem ${matrixItemId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  if (proposeFactsEnabled()) {
    await runProposePath(parsed.data, job, log);
    return;
  }

  const { client: dust, creds } = await getOrgDust(orgId, log);
  const complianceAgentId =
    resolveAgentId(creds, 'complianceFill', process.env.DUST_RFP_COMPLIANCE_AGENT_ID) ??
    DEFAULT_COMPLIANCE_AGENT_ID;
  let result: ComplianceAssessment;

  const userMessage = buildAgentUserMessage({
    template:
      `${rolePreambleForKey('compliance_officer')}\n\n` +
      'Assess compliance for the following requirement{{CATEGORY_SUFFIX}}. ' +
      'Return ONLY a JSON object with: status (YES|NO|PARTIAL|NOT_APPLICABLE), ' +
      'justification (concise string, max 1000 chars), confidence (0-10000).',
    trusted: {
      CATEGORY_SUFFIX: category ? ` in category "${category}"` : '',
    },
    rfpContent: requirementText,
  });

  // Provider-agnostic: direct LLM (RFP_LLM_PROVIDER) → Dust agent → UNAVAILABLE fallback.
  const completion = await runRfpCompletion({
    orgId,
    log,
    dust,
    agentId: complianceAgentId,
    userMessage,
    system:
      'You are an RFP compliance officer. Respond with ONLY a valid JSON object — no prose, no markdown fences.',
    agentType: 'rfp-compliance',
    responseFormat: 'json_object',
    traceId: job.id ?? undefined,
  });

  if (completion) {
    try {
      const p2 = ComplianceResult.safeParse(JSON.parse(coerceJsonObject(completion.text)));
      result = p2.success
        ? { assessmentStatus: 'ASSESSED', verdict: p2.data }
        : fallbackCompliance();
    } catch {
      result = fallbackCompliance();
    }
  } else {
    result = fallbackCompliance();
  }

  await prisma.complianceMatrixRow.update({
    where: { id: matrixItemId },
    data: directWriteData(result),
  });

  log.info(
    {
      orgId,
      orchestrationId,
      matrixItemId,
      status: result.assessmentStatus === 'ASSESSED' ? result.verdict.status : 'UNAVAILABLE',
    },
    'rfp-compliance-fill: complete',
  );
}

// ─── Propose path ──────────────────────────────────────────────────────────

/** Record only that the assessment could not run. Never a verdict, never a 0. */
async function markUnavailable(matrixItemId: string): Promise<void> {
  await prisma.complianceMatrixRow.update({
    where: { id: matrixItemId },
    data: directWriteData(fallbackCompliance()),
  });
}

function buildProposePrompt(args: {
  context: RequirementContext;
  requirementText: string;
  category: string | undefined;
}): string {
  const kinds = EVIDENCE_KINDS.map((kind) => `"${kind}"`).join(', ');
  return buildAgentUserMessage({
    template:
      `${rolePreambleForKey('compliance_officer')}\n\n` +
      'Assess compliance for the requirement below{{CATEGORY_SUFFIX}}, using ONLY the ' +
      'source extracts that follow it. The extracts come from {{DOCUMENT}}, {{PAGES}}.\n\n' +
      'Return ONLY a JSON object with:\n' +
      '- status: YES | NO | PARTIAL | NOT_APPLICABLE\n' +
      '- justification: concise string, max 1000 chars\n' +
      `- evidence: array of { kind, detail, sourceChunkId? } where kind is one of ${kinds}. ` +
      'Report only what you actually observed, one entry per independent source, and write ' +
      'detail for a bid manager reading a tooltip ("DPA §3 names AWS eu-west-1", never ' +
      '"match confirmed").\n' +
      '- citations: array of { sourceChunkId, quote } where quote is copied VERBATIM from ' +
      'that extract. Every quote is re-checked against the extract in code; one that cannot ' +
      'be found is discarded along with the observation it supports.\n\n' +
      'Do NOT return a confidence, score, probability or certainty of any kind. You report ' +
      'what you saw; the evidence ledger prices it. If nothing in the extracts states this ' +
      'requirement, say so — an unanswered row a person can fill beats a wrong answer ' +
      'nobody knows to check.',
    trusted: {
      CATEGORY_SUFFIX: args.category ? ` in category "${args.category}"` : '',
      DOCUMENT: args.context.document
        ? `${args.context.document.title} (v${args.context.document.versionNo})`
        : 'the source document',
      PAGES: formatPageRange(args.context.pageRange),
    },
    rfpContent: `REQUIREMENT:\n${args.requirementText}\n\nSOURCE EXTRACTS:\n${formatSourceContext(
      args.context,
    )}`,
  });
}

async function askForProposal(args: {
  data: JobData;
  job: Job<JobData>;
  log: pino.Logger;
  context: RequirementContext;
}): Promise<ProposedAnswer | null> {
  const { orgId, requirementText, category } = args.data;
  const { client: dust, creds } = await getOrgDust(orgId, args.log);
  const agentId =
    resolveAgentId(creds, 'complianceFill', process.env.DUST_RFP_COMPLIANCE_AGENT_ID) ??
    DEFAULT_COMPLIANCE_AGENT_ID;

  const completion = await runRfpCompletion({
    orgId,
    log: args.log,
    dust,
    agentId,
    userMessage: buildProposePrompt({ context: args.context, requirementText, category }),
    system:
      'You are an RFP compliance officer. Respond with ONLY a valid JSON object — no prose, no markdown fences.',
    agentType: 'rfp-compliance',
    responseFormat: 'json_object',
    traceId: args.job.id ?? undefined,
  });
  if (!completion) return null;

  try {
    const parsed = ProposedAnswer.safeParse(JSON.parse(coerceJsonObject(completion.text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Keep only what points at a chunk we actually retrieved this run. A chunk id
 * the model invented — or lifted from another tenant's document — has no entry
 * here, so it can neither be cited nor carry an observation's weight.
 */
function toObservations(
  answer: ProposedAnswer,
  known: Map<string, unknown>,
): { evidence: Observation[]; unknownRefs: number } {
  let unknownRefs = 0;
  const evidence: Observation[] = [];
  for (const item of answer.evidence) {
    if (item.sourceChunkId && !known.has(item.sourceChunkId)) {
      unknownRefs += 1;
      continue;
    }
    evidence.push(
      item.sourceChunkId
        ? { kind: item.kind, detail: item.detail, sourceChunkId: item.sourceChunkId }
        : { kind: item.kind, detail: item.detail },
    );
  }
  return { evidence, unknownRefs };
}

async function runProposePath(data: JobData, job: Job<JobData>, log: pino.Logger): Promise<void> {
  const { orgId, orchestrationId, matrixItemId, approvalConfirmed } = data;

  // ADR-0003 Decision 1: SERUM runs BEFORE anything is read. A denial is a
  // clean stop — never a fall-through to the less-governed direct write.
  const decision = await checkSerumAgentRuntimePolicy({
    orgId,
    environment: defaultSerumConfigEnvironment(),
    configKey: SERUM_RUNTIME_CONFIG_KEYS.agents,
    agentId: PROPOSER_AGENT_KEY,
    approvalConfirmed,
  });
  if (!decision.allowed) {
    log.warn(
      { orgId, matrixItemId, status: decision.status, reason: decision.reason },
      'rfp-compliance-fill: SERUM denied the proposer run',
    );
    return;
  }

  const { matrixRow, context } = await retrieveMatrixRowContext(prisma, {
    orgId,
    matrixRowId: matrixItemId,
  });
  if (!context.assessable || !matrixRow || !context.chunk || !context.requirement) {
    // No chunk means we did not look, not that the answer is no. UNAVAILABLE,
    // and deliberately no compliance gap: unknown is not bad (ADR-0004).
    await markUnavailable(matrixItemId);
    log.info(
      { orgId, orchestrationId, matrixItemId, reason: context.unavailableReason },
      'rfp-compliance-fill: no assessable source — proposer skipped',
    );
    return;
  }

  const answer = await askForProposal({ data, job, log, context });
  if (!answer) {
    await markUnavailable(matrixItemId);
    log.info({ orgId, matrixItemId }, 'rfp-compliance-fill: proposer produced no usable JSON');
    return;
  }

  await storeProposal({ data, log, context, matrixRow, answer });
}

async function storeProposal(args: {
  data: JobData;
  log: pino.Logger;
  context: RequirementContext;
  matrixRow: RetrievedMatrixRow;
  answer: ProposedAnswer;
}): Promise<void> {
  const { orgId, matrixItemId } = args.data;
  const { context, answer, matrixRow } = args;
  const requirement = context.requirement;
  if (!requirement) return;

  const chunksById = chunkIndexById(context);
  const { evidence, unknownRefs } = toObservations(answer, chunksById);

  const proposal = await proposeAnswer(prisma, {
    orgId,
    opportunityId: matrixRow.opportunityId,
    subjectType: 'matrix_row',
    subjectId: matrixItemId,
    claim: answer.justification,
    verdict: answer.status,
    evidence,
    citationCandidates: answer.citations,
    chunksById,
    assessmentStatus: 'ASSESSED',
    humanAuthored: Boolean(matrixRow.answerDraft?.trim()),
  });

  // A mandatory requirement we cannot evidence is a first-class outcome, not a
  // silent low score: the high-severity issue blocks the approval gate via the
  // recount that already exists (rfp-pipeline.ts:465-471).
  const unevidenced = proposal.refusal === 'below-floor' || answer.status === 'NO';
  if (requirement.mandatory && unevidenced) {
    await flagComplianceGap(prisma, {
      orgId,
      opportunityId: matrixRow.opportunityId,
      requirementId: requirement.id,
      subjectType: 'matrix_row',
      subjectId: matrixItemId,
      // A distinct claim, not the justification verbatim: when a NO answer was
      // itself stored, reusing its text would hash to the same value and put two
      // indistinguishable facts on one subject.
      gap: `Mandatory requirement not evidenced. ${answer.justification}`,
      requirementText: requirement.text,
      // Only what survived quote re-verification. Handing the model's original
      // list here would let a rejected observation price the gap.
      evidence: proposal.verifiedEvidence,
      sourceChunkId: context.chunk?.id ?? null,
      assessmentStatus: 'ASSESSED',
    });
  }

  args.log.info(
    {
      orgId,
      matrixItemId,
      verdict: answer.status,
      stored: proposal.stored,
      band: proposal.band,
      refusal: proposal.refusal ?? null,
      citationsStored: proposal.citationsStored,
      citationsRejected: proposal.rejectedCitations.length,
      unknownChunkRefs: unknownRefs,
    },
    'rfp-compliance-fill: proposal complete',
  );
}

/** Test seam — the BullMQ worker below invokes exactly this function. */
export async function processComplianceFillJobForTest(
  job: Job<JobData>,
  log: pino.Logger,
): Promise<void> {
  return processJob(job, log);
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpComplianceFill(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
    {
      connection,
      concurrency: 6,
      limiter: { max: 30, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, matrixItemId: job.data.matrixItemId },
      'rfp-compliance-fill: completed',
    );
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-compliance-fill: failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-compliance-fill worker started');
}
