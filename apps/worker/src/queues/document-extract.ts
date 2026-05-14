// Document intelligence extraction worker.
//
// Reads pre-extracted text from the job payload, calls a Dust agent (if
// configured) or falls back to deterministic keyword extraction, then writes
// structured solutions/products back to the CRM database.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';

import { DOCUMENT_EXTRACT } from '@bidstack/shared';
import { DustClient } from '@bidstack/dust-client';

const QUEUE_NAME = DOCUMENT_EXTRACT.name;

// ─── Dust client (lazy, fail-open) ─────────────────────────────────────────

function getDustClient(log: pino.Logger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return null;
  return new DustClient({ apiKey, workspaceId, logger: log });
}

function getDustAgentId(): string | null {
  return process.env.DUST_DOCUMENT_EXTRACT_AGENT_ID ?? null;
}

// ─── Deterministic extraction fallback ─────────────────────────────────────

interface ExtractedItem {
  name: string;
  description: string;
  category: string;
  priceRange?: string;
}

interface ExtractionResult {
  solutions: ExtractedItem[];
  products: ExtractedItem[];
}

const SOLUTION_KEYWORDS = [
  'solution',
  'offering',
  'service',
  'consulting',
  'implementation',
  'migration',
  'transformation',
  'strategy',
  'assessment',
  'audit',
  'integration',
  'deployment',
  'managed service',
  'support',
];

const PRODUCT_KEYWORDS = [
  'product',
  'platform',
  'software',
  'tool',
  'suite',
  'license',
  'subscription',
  'hardware',
  'appliance',
  'module',
  'addon',
];

const CATEGORY_MAP: Record<string, string> = {
  cloud: 'infrastructure',
  infrastructure: 'infrastructure',
  hosting: 'infrastructure',
  security: 'security',
  'cyber security': 'security',
  compliance: 'security',
  'soc 2': 'security',
  'iso 27001': 'security',
  gdpr: 'security',
  data: 'data',
  analytics: 'data',
  'business intelligence': 'data',
  ai: 'ai',
  'machine learning': 'ai',
  'artificial intelligence': 'ai',
  software: 'software',
  development: 'software',
  devops: 'software',
  network: 'network',
  connectivity: 'network',
  telecom: 'network',
};

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return 'general';
}

function deterministicExtract(text: string): ExtractionResult {
  const lines = text.split(/\n+/).map((l) => l.trim());
  const solutions: ExtractedItem[] = [];
  const products: ExtractedItem[] = [];
  const seen = new Set<string>();

  // Track section context (e.g. "Solutions:" / "Products:" headers)
  let currentSection: 'solution' | 'product' | null = null;

  for (const line of lines) {
    if (line.length < 3) continue;

    const lower = line.toLowerCase();

    // Detect section headers
    if (/^solutions?\s*[:\-–]/.test(lower)) {
      currentSection = 'solution';
      continue;
    }
    if (/^products?\s*[:\-–]/.test(lower) || /^offerings?\s*[:\-–]/.test(lower)) {
      currentSection = 'product';
      continue;
    }

    // Match bullet points, numbered lists, or plain lines with separators
    const match = line.match(/^[-•*\d.)]+\s*(.+?)(?:\s*[-–:]\s*(.*))?$/);
    if (!match) {
      // Also try matching plain "Name — Description" or "Name: Description" lines
      const plainMatch = line.match(/^(.{3,80}?)\s*[-–:]\s*(.{5,})$/);
      if (plainMatch && line.length > 10 && line.length < 300) {
        const name = (plainMatch[1] ?? '').trim().slice(0, 120);
        const desc = (plainMatch[2] ?? '').trim().slice(0, 500);
        if (name) classifyAndPush(name, desc, line, currentSection, solutions, products, seen);
      }
      continue;
    }

    const name = (match[1] ?? '').trim().slice(0, 120);
    const desc = (match[2] ?? '').trim().slice(0, 500);
    if (!name || seen.has(name.toLowerCase())) continue;

    classifyAndPush(name, desc, line, currentSection, solutions, products, seen);
  }

  if (solutions.length === 0 && products.length === 0) {
    const firstParagraph = text.split(/\n\n+/)[0]?.slice(0, 300) ?? '';
    if (firstParagraph.length > 50) {
      solutions.push({
        name: 'General Offering',
        description: firstParagraph,
        category: 'general',
      });
    }
  }

  return { solutions, products };
}

function classifyAndPush(
  name: string,
  desc: string,
  line: string,
  section: 'solution' | 'product' | null,
  solutions: ExtractedItem[],
  products: ExtractedItem[],
  seen: Set<string>,
): void {
  if (!name || seen.has(name.toLowerCase())) return;
  seen.add(name.toLowerCase());

  const lower = line.toLowerCase();
  const isSolution = SOLUTION_KEYWORDS.some((k) => lower.includes(k));
  const isProduct = PRODUCT_KEYWORDS.some((k) => lower.includes(k));

  const item: ExtractedItem = {
    name,
    description: desc || line.slice(0, 200),
    category: detectCategory(line),
  };

  // Section context overrides keyword heuristics when present
  if (section === 'solution') {
    solutions.push(item);
  } else if (section === 'product') {
    products.push(item);
  } else if (isSolution || (!isProduct && lower.includes('solution'))) {
    solutions.push(item);
  } else if (isProduct) {
    products.push(item);
  } else {
    // No strong signal — default to solution if it sounds like a capability
    // (ends with common service-like suffixes)
    const serviceLike =
      /(?:migration|transformation|assessment|audit|consulting|support|management|operations)$/i;
    if (serviceLike.test(name)) {
      solutions.push(item);
    }
  }
}

// ─── Prompt builder ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a CRM intelligence extractor. Given the following company document, extract:
1. SOLUTIONS — services, offerings, consulting engagements, or strategic capabilities this company provides.
2. PRODUCTS — software, platforms, hardware, or tangible items this company sells.

Respond ONLY in valid JSON with this exact shape (no markdown, no explanation):
{
  "solutions": [
    { "name": "...", "description": "...", "category": "..." }
  ],
  "products": [
    { "name": "...", "description": "...", "category": "...", "priceRange": "optional string like 50000-150000" }
  ]
}

If no solutions or products are found, return empty arrays. Categories should be one of: infrastructure, security, data, ai, software, network, general.

--- DOCUMENT ---
`;

// ─── Worker processor ──────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  accountId: z.string().min(1),
  documentId: z.string().uuid(),
  extractionId: z.string().uuid(),
  text: z.string(),
  prompt: z.string().optional(),
});
type JobData = z.infer<typeof JobData>;

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const { orgId, accountId, documentId, extractionId, text, prompt } = JobData.parse(job.data);

  // Mark as running
  await prisma.documentExtraction.update({
    where: { id: extractionId },
    data: { status: 'running' },
  });

  let result: ExtractionResult;
  let dustRunId: string | null = null;

  const dust = getDustClient(log);
  const agentId = getDustAgentId();

  if (dust && agentId) {
    try {
      const message = prompt
        ? `${EXTRACTION_PROMPT}\nAdditional instructions: ${prompt}\n\n${text.slice(0, 80_000)}`
        : `${EXTRACTION_PROMPT}\n${text.slice(0, 80_000)}`;
      const run = await dust.runAgent(agentId, message);
      dustRunId = run.run_id;

      if (run.status === 'failed' || !run.output) {
        throw new Error(`Dust agent run failed: ${run.status}`);
      }

      let output = run.output;
      const fenceMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch && fenceMatch[1]) output = fenceMatch[1];
      output = output.trim();

      const parsed = JSON.parse(output) as {
        solutions?: Array<{ name?: string; description?: string; category?: string }>;
        products?: Array<{
          name?: string;
          description?: string;
          category?: string;
          priceRange?: string;
        }>;
      };
      result = {
        solutions: (parsed.solutions ?? [])
          .filter((s) => s.name)
          .map((s) => ({
            name: String(s.name).slice(0, 200),
            description: String(s.description ?? '').slice(0, 1000),
            category: String(s.category ?? 'general'),
          })),
        products: (parsed.products ?? [])
          .filter((p) => p.name)
          .map((p) => ({
            name: String(p.name).slice(0, 200),
            description: String(p.description ?? '').slice(0, 1000),
            category: String(p.category ?? 'general'),
            priceRange: p.priceRange,
          })),
      };

      log.info(
        { runId: dustRunId, solutions: result.solutions.length, products: result.products.length },
        'Dust extraction completed',
      );
    } catch (err) {
      log.warn({ err }, 'Dust extraction failed, falling back to deterministic extraction');
      result = deterministicExtract(text);
    }
  } else {
    log.info('No Dust agent configured, using deterministic extraction');
    result = deterministicExtract(text);
  }

  // Write solutions to DB
  for (const s of result.solutions) {
    await prisma.accountSolution.upsert({
      where: {
        orgId_accountId_name: { orgId, accountId, name: s.name },
      },
      create: {
        orgId,
        accountId,
        name: s.name,
        description: s.description || null,
        category: s.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
      update: {
        description: s.description || null,
        category: s.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
    });
  }

  // Write products to DB
  for (const p of result.products) {
    await prisma.accountProduct.upsert({
      where: {
        orgId_accountId_name: { orgId, accountId, name: p.name },
      },
      create: {
        orgId,
        accountId,
        name: p.name,
        description: p.description || null,
        category: p.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
      update: {
        description: p.description || null,
        category: p.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
    });
  }

  // Mark extraction as done
  const extractedData: {
    solutions: Array<{ name: string; description: string; category: string }>;
    products: Array<{ name: string; description: string; category: string; priceRange?: string }>;
  } = {
    solutions: result.solutions,
    products: result.products,
  };
  await prisma.documentExtraction.update({
    where: { id: extractionId },
    data: {
      status: 'done',
      extractedData: extractedData as unknown as Prisma.InputJsonValue,
      dustRunId,
    },
  });
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startDocumentExtract(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const queue = new BullWorker<JobData>(QUEUE_NAME, async (job) => processJob(job, log), {
    connection,
    concurrency: 2,
    limiter: { max: 10, duration: 60_000 },
  });

  queue.on('completed', (job) => {
    log.info({ jobId: job.id, documentId: job.data.documentId }, 'document extraction completed');
  });

  queue.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'document extraction failed');
    if (job) {
      const { extractionId } = JobData.parse(job.data);
      prisma.documentExtraction
        .update({
          where: { id: extractionId },
          data: { status: 'error', error: err.message.slice(0, 2000) },
        })
        .catch(() => undefined);
    }
  });

  workers.push(queue);
  log.info({ queue: QUEUE_NAME }, 'document extraction worker started');
}
