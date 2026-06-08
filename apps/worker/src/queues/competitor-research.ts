// Competitor research worker — grounded, cited competitor intelligence.
//
// For one CompetitorProfile (optionally scoped to an opportunity):
//   1. USASpending federal award amounts → cited pricing insights (no LLM).
//   2. Optional SSRF-guarded web search → fetch public pages → cite-or-omit LLM
//      extraction (a finding citing an unfetched URL is dropped — see
//      @bidstack/shared/competitor-intel).
//   3. Supersede prior active insights for the scope and write the fresh set.
//
// Web page content is UNTRUSTED — it is wrapped via buildAgentUserMessage so a
// malicious competitor page cannot inject instructions into the extraction call.
// All fetches go through createResearchFetch (SSRF + DNS-rebinding guard).

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import {
  COMPETITOR_RESEARCH,
  buildUsaSpendingCompetitorInsights,
  fetchGroundedDocuments,
  findingsToInsightDrafts,
  parseCompetitorFindings,
  type CompetitorInsightDraft,
  type GroundedSource,
} from '@bidstack/shared';

import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import { runRfpCompletion } from '../lib/rfp-llm.js';
import { resolveLlmFromEnv } from '../lib/llm-provider.js';
import { createResearchFetch } from '../lib/safe-research-fetch.js';

const QUEUE_NAME = COMPETITOR_RESEARCH.name;
const DEFAULT_AGENT_ID = 'competitor-intel-agent';
const MAX_DOCS = 6;

const JobData = z.object({
  orgId: z.string().uuid(),
  competitorProfileId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable().optional(),
  /** Optional caller-supplied public URLs to ground on (in addition to search). */
  seedUrls: z.array(z.string().url()).max(20).optional(),
});
type JobData = z.infer<typeof JobData>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

// ─── Web search (optional, env-gated) ───────────────────────────────────────

/**
 * Resolve candidate public URLs for a competitor via the configured search
 * provider. Returns [] when no provider/key is set — USASpending still works
 * with zero credentials, so the feature degrades gracefully.
 */
async function searchCompetitorUrls(
  competitorName: string,
  fetchImpl: FetchLike,
  log: pino.Logger,
): Promise<string[]> {
  const provider = process.env.COMPETITOR_SEARCH_PROVIDER;
  const apiKey = process.env.COMPETITOR_SEARCH_API_KEY;
  if (!provider || !apiKey) return [];
  const query = `${competitorName} RFP tender pricing case study award`;
  try {
    if (provider === 'tavily') {
      const res = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: MAX_DOCS }),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { results?: Array<{ url?: string }> };
      return (body.results ?? []).map((r) => r.url).filter((u): u is string => Boolean(u));
    }
    // Other providers (exa, serpapi) are intentionally not wired yet — add here.
    log.warn({ provider }, 'competitor-research: unknown COMPETITOR_SEARCH_PROVIDER');
    return [];
  } catch (err) {
    log.warn({ err }, 'competitor-research: search provider call failed — continuing');
    return [];
  }
}

// ─── LLM extraction over fetched documents ──────────────────────────────────

function formatSourcesForPrompt(docs: GroundedSource[]): string {
  return docs
    .map(
      (d, i) =>
        `[SOURCE ${i + 1}]\nURL: ${d.url}\nTITLE: ${d.title ?? '(none)'}\n${d.snippet}`,
    )
    .join('\n\n');
}

async function extractFromDocuments(opts: {
  orgId: string;
  competitorName: string;
  docs: GroundedSource[];
  dust: Awaited<ReturnType<typeof getOrgDust>>['client'];
  creds: Awaited<ReturnType<typeof getOrgDust>>['creds'];
  traceId?: string;
  log: pino.Logger;
}): Promise<CompetitorInsightDraft[]> {
  const { orgId, competitorName, docs, dust, creds, traceId, log } = opts;
  if (docs.length === 0 || (!dust && !resolveLlmFromEnv())) return [];

  const agentId =
    resolveAgentId(creds, 'competitorIntel', process.env.DUST_COMPETITOR_AGENT_ID) ??
    DEFAULT_AGENT_ID;

  // Untrusted page content goes in rfpContent — never the instruction template.
  const userMessage = buildAgentUserMessage({
    template:
      'You are a competitive-intelligence analyst. Using ONLY the SOURCES below about {{COMPETITOR}}, ' +
      'extract concrete, verifiable findings (pricing, win/loss, capability, positioning, rfp_response, news). ' +
      'Return ONLY JSON: { "findings": [ { "category": "pricing"|"win_loss"|"capability"|"positioning"|"rfp_response"|"news"|"other", "title": string, "summary": string, "sourceUrl": string, "confidence": 0-1 } ] }. ' +
      'sourceUrl MUST be copied EXACTLY from one of the SOURCE URLs above. Never invent a URL or a fact not present in the sources. Return an empty array if nothing is supported.',
    trusted: { COMPETITOR: competitorName },
    rfpContent: formatSourcesForPrompt(docs),
  });

  const completion = await runRfpCompletion({
    orgId,
    log,
    dust,
    agentId,
    userMessage,
    system:
      'You are a competitive-intelligence analyst. Respond with ONLY a valid JSON object — no prose, no markdown fences.',
    agentType: 'competitor-intel',
    responseFormat: 'json_object',
    maxTokens: 4000,
    traceId,
  });
  if (!completion) return [];

  const allowedUrls = docs.map((d) => d.url);
  const { findings, dropped, parseError } = parseCompetitorFindings(completion.text, allowedUrls);
  if (parseError) {
    log.warn('competitor-research: extraction output unparseable — skipping web findings');
    return [];
  }
  if (dropped > 0) {
    // The cite-or-omit guarantee at work — the model cited URLs we never fetched.
    log.warn({ dropped }, 'competitor-research: dropped findings citing unfetched URLs');
  }
  return findingsToInsightDrafts(findings, completion.provider ?? 'web');
}

// ─── Persistence ────────────────────────────────────────────────────────────

async function persistInsights(opts: {
  orgId: string;
  competitorProfileId: string;
  opportunityId: string | null;
  drafts: CompetitorInsightDraft[];
}): Promise<void> {
  const { orgId, competitorProfileId, opportunityId, drafts } = opts;
  await prisma.$transaction(async (tx) => {
    // Idempotent refresh: supersede prior active insights for this exact scope,
    // then insert the fresh set. Re-running a research job replaces, never dupes.
    await tx.competitorInsight.updateMany({
      where: { orgId, competitorProfileId, opportunityId, status: 'active', deletedAt: null },
      data: { status: 'superseded' },
    });
    if (drafts.length > 0) {
      await tx.competitorInsight.createMany({
        data: drafts.map((d) => ({
          orgId,
          competitorProfileId,
          opportunityId,
          category: d.category,
          title: d.title,
          summary: d.summary,
          sourceUrl: d.sourceUrl,
          sourceTitle: d.sourceTitle,
          sourceSnippet: d.sourceSnippet,
          provider: d.provider,
          confidenceBps: d.confidenceBps,
          publishedAt: d.publishedAt ? new Date(d.publishedAt) : null,
          metadata: d.metadata as Prisma.InputJsonValue,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        orgId,
        userId: null,
        action: 'competitor.research.complete',
        targetType: 'competitor_profile',
        targetId: competitorProfileId,
        diff: { opportunityId, insightsCreated: drafts.length },
      },
    });
  });
}

// ─── Core processor ─────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`competitor-research: invalid job data: ${parsed.error.message}`);
  }
  const { orgId, competitorProfileId, seedUrls } = parsed.data;
  const opportunityId = parsed.data.opportunityId ?? null;

  const profile = await prisma.competitorProfile.findFirst({
    where: { id: competitorProfileId, orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!profile) {
    const err = new Error(`competitor-research: profile ${competitorProfileId} not found`);
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const researchFetch = createResearchFetch();
  const now = new Date();

  // 1. USASpending cited pricing (no LLM, no key required).
  const usaSpending = await buildUsaSpendingCompetitorInsights({
    competitorName: profile.name,
    now,
    fetchImpl: researchFetch,
  });

  // 2. Optional web search → SSRF-guarded fetch → cite-or-omit extraction.
  const searchUrls = await searchCompetitorUrls(profile.name, researchFetch, log);
  const candidateUrls = [...(seedUrls ?? []), ...searchUrls];
  let webDrafts: CompetitorInsightDraft[] = [];
  if (candidateUrls.length > 0) {
    const docs = await fetchGroundedDocuments({
      urls: candidateUrls,
      fetchImpl: researchFetch,
      maxDocs: MAX_DOCS,
    });
    const { client: dust, creds } = await getOrgDust(orgId, log);
    webDrafts = await extractFromDocuments({
      orgId,
      competitorName: profile.name,
      docs,
      dust,
      creds,
      traceId: job.id ?? undefined,
      log,
    });
  }

  const drafts = [...usaSpending, ...webDrafts];
  await persistInsights({ orgId, competitorProfileId, opportunityId, drafts });

  log.info(
    { orgId, competitorProfileId, opportunityId, usaSpending: usaSpending.length, web: webDrafts.length },
    'competitor-research: complete',
  );
}

// ─── BullMQ bootstrap ───────────────────────────────────────────────────────

export async function startCompetitorResearch(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => {
      try {
        await processJob(job, log.child({ jobId: job.id }));
      } catch (err) {
        log.error({ err, jobId: job?.id }, 'Job failed gracefully');
        throw err;
      }
    },
    { connection, concurrency: 2, limiter: { max: 10, duration: 60_000 } },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'competitor-research: failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'competitor-research worker started');
}
