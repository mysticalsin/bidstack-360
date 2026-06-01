// RFP legal scan worker.
//
// Runs the legal/finance/marketing/presales/bid review crew over the assembled
// proposal via the configured AI provider (direct LLM RFP_LLM_PROVIDER, or Dust).
// Logs findings to the AI audit log (EU AI Act Art. 50 transparency).
// Advances the orchestration to proposal_compile and chains the compile job.
//
// WHY sequential (not per-section): legal scan requires the full draft in
// context â€” individual section scans would miss cross-section risk patterns.
//
// FAIL-OPEN: if DUST_API_KEY / DUST_WORKSPACE_ID are absent the worker writes
// a "[Legal scan skipped â€” configure DUST_API_KEY.]" placeholder and
// continues. Pipeline is never blocked by a missing Dust credential.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { RFP_LEGAL_SCAN, RFP_PROPOSAL_COMPILE } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import { runRfpCompletion } from '../lib/rfp-llm.js';
import { resolveLlmFromEnv } from '../lib/llm-provider.js';
import {
  updateOrchestrationPhase,
  markOrchestrationFailed,
} from './rfp-requirement-extract.helpers.js';

const QUEUE_NAME = RFP_LEGAL_SCAN.name;
const DEFAULT_LEGAL_AGENT_ID = 'rfp-legal-scan-agent';
const DEFAULT_FINANCE_AGENT_ID = 'rfp-finance-review-agent';
const DEFAULT_MARKETING_AGENT_ID = 'rfp-marketing-review-agent';
const DEFAULT_PRESALES_AGENT_ID = 'rfp-presales-review-agent';
const DEFAULT_BID_AGENT_ID = 'rfp-bid-manager-agent';

// Cap concatenated section text sent to Dust â€” legal scan is whole-document,
// so we budget more chars than per-section drafting but still hard-cap to
// prevent runaway token spend.
const MAX_SECTION_CONTENT_CHARS = 8_000;
const MAX_RFP_SOURCE_CHARS = 10_000;

type ReviewStatus = 'success' | 'skipped' | 'error';

interface ReviewAgentConfig {
  key: 'legal' | 'finance' | 'marketing' | 'presales' | 'bid';
  role: string;
  purpose: string;
  envKey: string;
  legacyEnvKey?: string;
  defaultAgentId: string;
  instruction: string;
}

export interface ReviewCrewFinding {
  key: ReviewAgentConfig['key'];
  role: string;
  status: ReviewStatus;
  agentId: string | null;
  output: string;
  /** Which provider actually answered ('openai'|'anthropic'|'moonshot'|'dust'); undefined if skipped/errored. */
  provider?: string;
}

export const RFP_REVIEW_AGENTS: readonly ReviewAgentConfig[] = [
  {
    key: 'legal',
    role: 'Legal Counsel',
    purpose: 'rfpReviewLegal',
    envKey: 'DUST_RFP_REVIEW_LEGAL_AGENT_ID',
    legacyEnvKey: 'DUST_RFP_LEGAL_SCAN_AGENT_ID',
    defaultAgentId: DEFAULT_LEGAL_AGENT_ID,
    instruction:
      'Identify contractual red flags, unacceptable liability, IP, privacy, termination, data residency, and SLA penalty risks.',
  },
  {
    key: 'finance',
    role: 'Finance Lead',
    purpose: 'rfpReviewFinance',
    envKey: 'DUST_RFP_REVIEW_FINANCE_AGENT_ID',
    legacyEnvKey: 'DUST_RFP_PRICING_AGENT_ID',
    defaultAgentId: DEFAULT_FINANCE_AGENT_ID,
    instruction:
      'Assess pricing, margin, payment terms, FX/tax exposure, discount risk, and commercial feasibility.',
  },
  {
    key: 'marketing',
    role: 'Marketing Strategist',
    purpose: 'rfpReviewMarketing',
    envKey: 'DUST_RFP_REVIEW_MARKETING_AGENT_ID',
    legacyEnvKey: 'DUST_RFP_WIN_THEME_AGENT_ID',
    defaultAgentId: DEFAULT_MARKETING_AGENT_ID,
    instruction:
      'Evaluate positioning, win themes, proof points, differentiation, executive messaging, and customer resonance.',
  },
  {
    key: 'presales',
    role: 'Presales Lead',
    purpose: 'rfpReviewPresales',
    envKey: 'DUST_RFP_REVIEW_PRESALES_AGENT_ID',
    defaultAgentId: DEFAULT_PRESALES_AGENT_ID,
    instruction:
      'Assess technical fit, delivery assumptions, solution gaps, integrations, dependencies, and SME follow-up needs.',
  },
  {
    key: 'bid',
    role: 'Bid Manager',
    purpose: 'rfpReviewBid',
    envKey: 'DUST_RFP_REVIEW_BID_AGENT_ID',
    legacyEnvKey: 'DUST_CREW_AGENT_ID',
    defaultAgentId: DEFAULT_BID_AGENT_ID,
    instruction:
      'Consolidate all specialist inputs into a go-forward bid plan: top risks, owner actions, missing evidence, and decision recommendation.',
  },
] as const;

// â”€â”€â”€ Job schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  proposalId: z.string().uuid(),
});
type JobData = z.infer<typeof JobData>;

function formatReviewContext(sourceText: string, sectionText: string): string {
  return [
    '# Original RFP source',
    sourceText || '[Original RFP text unavailable.]',
    '# Current proposal draft',
    sectionText || '[No proposal sections drafted yet.]',
  ].join('\n\n');
}

function formatPriorFindings(findings: ReviewCrewFinding[]): string {
  if (findings.length === 0) return '';
  return findings
    .map((f) => `## ${f.role}\nStatus: ${f.status}\n${f.output}`)
    .join('\n\n')
    .slice(0, 8_000);
}

async function runReviewAgent(opts: {
  agent: ReviewAgentConfig;
  dust: Awaited<ReturnType<typeof getOrgDust>>['client'];
  creds: Awaited<ReturnType<typeof getOrgDust>>['creds'];
  orgId: string;
  proposalId: string;
  contextText: string;
  priorFindings: ReviewCrewFinding[];
  traceId?: string;
  log: pino.Logger;
}): Promise<ReviewCrewFinding> {
  const { agent, dust, creds, orgId, proposalId, contextText, priorFindings, traceId, log } = opts;
  const envFallback = process.env[agent.envKey] ?? process.env[agent.legacyEnvKey ?? ''];
  const agentId = resolveAgentId(creds, agent.purpose, envFallback) ?? agent.defaultAgentId;

  // Skip only when NO provider is available — a direct LLM (RFP_LLM_PROVIDER) is
  // enough even without a Dust workspace.
  if (!dust && !resolveLlmFromEnv()) {
    return {
      key: agent.key,
      role: agent.role,
      status: 'skipped',
      agentId: null,
      output: `[${agent.role} review pending - connect an AI provider (Dust or RFP_LLM_PROVIDER) in Settings.]`,
    };
  }

  const userMessage = buildAgentUserMessage({
    template:
      'You are {{ROLE}} in the BidStack RFP response crew. {{INSTRUCTION}} ' +
      'Return concise markdown with: Critical risks, Required owner actions, Missing information, and Go-forward recommendation. ' +
      'Do not approve the bid; humans approve gates.',
    trusted: { ROLE: agent.role, INSTRUCTION: agent.instruction, PROPOSAL_ID: proposalId },
    rfpContent: contextText,
    userText: formatPriorFindings(priorFindings),
  });

  // Provider-agnostic: direct LLM (RFP_LLM_PROVIDER) → this role's Dust agent → null.
  const completion = await runRfpCompletion({
    orgId,
    log,
    dust,
    agentId,
    userMessage,
    agentType: `rfp-review-${agent.key}`,
    responseFormat: 'text',
    maxTokens: 8000,
    traceId,
  });

  if (!completion) {
    return {
      key: agent.key,
      role: agent.role,
      status: 'error',
      agentId,
      output: `[${agent.role} review unavailable - manual review required.]`,
    };
  }

  return {
    key: agent.key,
    role: agent.role,
    status: 'success',
    agentId,
    provider: completion.provider,
    output: completion.text.trim() || `[${agent.role} returned no output - review manually.]`,
  };
}

async function persistReviewCrewFindings(opts: {
  orgId: string;
  orchestrationId: string;
  proposalId: string;
  findings: ReviewCrewFinding[];
}): Promise<void> {
  const { orgId, orchestrationId, proposalId, findings } = opts;
  // Record the provider(s) that actually answered (was hardcoded 'dust', which
  // mis-attributed the EU AI Act Art. 50 provenance on a direct-LLM deployment).
  const usedProviders = [
    ...new Set(findings.map((f) => f.provider).filter((p): p is string => Boolean(p))),
  ];
  const payload = {
    reviewCrew: {
      provider: usedProviders.length ? usedProviders.join('+') : 'none',
      process: 'sequential',
      completedAt: new Date().toISOString(),
      proposalId,
      roles: findings.map((f) => ({
        key: f.key,
        role: f.role,
        status: f.status,
        agentId: f.agentId,
        output: f.output,
      })),
    },
  };

  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET config = config || ${JSON.stringify(payload)}::jsonb,
        updated_at = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
  `;

  await prisma.auditLog.create({
    data: {
      orgId,
      userId: null,
      action: 'rfp.review_crew.complete',
      targetType: 'rfp_orchestration',
      targetId: orchestrationId,
      diff: {
        proposalId,
        roles: findings.map((f) => ({ key: f.key, status: f.status })),
      },
    },
  });
}

// â”€â”€â”€ Core processor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function processJob(
  job: Job<JobData>,
  log: pino.Logger,
  proposalCompileQueue: BullQueue,
): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, documentVersionId, proposalId } = parsed.data;

  // Verify proposal belongs to this org before touching any data
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId, orgId },
    select: { id: true },
  });
  if (!proposal) {
    const err = new Error(`rfp-legal-scan: proposal ${proposalId} not found for org ${orgId}`);
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  // Gather proposal section text â€” ordered by sortOrder so Dust sees a
  // coherent document, not a random assembly of sections.
  const sections = await prisma.proposalSection.findMany({
    where: { proposalId, orgId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { title: true, content: true },
  });

  const sectionText = sections
    .map((s) => `## ${s.title ?? 'Untitled'}\n\n${s.content ?? ''}`)
    .join('\n\n')
    .slice(0, MAX_SECTION_CONTENT_CHARS);

  const source = await prisma.documentVersion.findFirst({
    where: { id: documentVersionId, orgId, deletedAt: null },
    select: { extractedText: true },
  });
  if (!source) {
    const err = new Error(
      `rfp-review-crew: document version ${documentVersionId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const contextText = formatReviewContext(
    (source.extractedText ?? '').slice(0, MAX_RFP_SOURCE_CHARS),
    sectionText,
  );
  const { client: reviewDust, creds: reviewCreds } = await getOrgDust(orgId, log);
  const reviewFindings: ReviewCrewFinding[] = [];

  for (const agent of RFP_REVIEW_AGENTS) {
    reviewFindings.push(
      await runReviewAgent({
        agent,
        dust: reviewDust,
        creds: reviewCreds,
        orgId,
        proposalId,
        contextText,
        priorFindings: reviewFindings,
        traceId: job.id ?? undefined,
        log,
      }),
    );
  }

  await persistReviewCrewFindings({
    orgId,
    orchestrationId,
    proposalId,
    findings: reviewFindings,
  });

  // Advance orchestration state then chain proposal-compile.
  // WHY advance before enqueue: if enqueue fails the orchestration phase is
  // still correct and the compile job can be re-enqueued manually without
  // corrupting the completed_phases array.
  await updateOrchestrationPhase(orchestrationId, orgId, 'proposal_compile', 'legal_scan');

  await proposalCompileQueue.add(
    'rfp.proposal-compile',
    { orgId, orchestrationId, proposalId },
    { jobId: `rfp-proposal-compile-${orchestrationId}` },
  );

  log.info(
    { orgId, orchestrationId, proposalId, roles: reviewFindings.map((f) => f.key) },
    'rfp-review-crew: complete',
  );
}

// â”€â”€â”€ BullMQ bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function startRfpLegalScan(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const proposalCompileQueue = new BullQueue(RFP_PROPOSAL_COMPILE.name, {
    connection,
    defaultJobOptions: RFP_PROPOSAL_COMPILE.defaultJobOptions,
  });
  queues.push(proposalCompileQueue);

  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id }), proposalCompileQueue),
    {
      connection,
      // WHY concurrency 4: legal scan is a HIGH-priority gate step â€” Dust-bound
      // but sequential per proposal. 4 allows concurrent proposals without
      // saturating the Dust API token budget.
      concurrency: 4,
      limiter: { max: 8, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, proposalId: job.data.proposalId }, 'rfp-legal-scan: completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-legal-scan: failed');
    const dataParsed = JobData.safeParse(job?.data);
    if (dataParsed.success) {
      const { orchestrationId, orgId } = dataParsed.data;
      markOrchestrationFailed(
        orchestrationId,
        orgId,
        'legal_scan',
        (err as Error).message?.slice(0, 2000) ?? 'unknown error',
      ).catch(() => undefined);
    }
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-legal-scan worker started');
}
