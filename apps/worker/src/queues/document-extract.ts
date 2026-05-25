// Document intelligence extraction worker.
//
// Reads the source object from storage, performs parser/OCR work off the API
// request path, calls a Dust agent if configured, and writes structured
// solutions/products back to the CRM database.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { createHash } from 'node:crypto';
import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';

import { DOCUMENT_EXTRACT } from '@bidstack/shared';
import { DustClient } from '@bidstack/dust-client';
// Use the sandboxed wrapper so untrusted upload bytes are parsed inside a
// worker_thread with a memory ceiling and a hard timeout, isolated from the
// queue worker's heap. See docs/audits/2026-05-24-twenty-agent-deep-audit.md
// HIGH-2 for the threat model. The direct (in-process) export remains
// available for unit tests that don't need sandboxing.
import { extractTextFromBufferSandboxed } from '../lib/extract-text-sandbox.js';
import { readStoredDocument } from '../lib/storage-read.js';

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

interface SourceChunkCandidate {
  chunkIndex: number;
  text: string;
  hash: string;
}

interface RequirementCandidate {
  externalRef: string;
  text: string;
  requirementType: string;
  mandatory: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidenceBps: number;
  sourceChunkIndex: number;
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

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function buildSourceChunks(text: string): SourceChunkCandidate[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];

  const chunks: SourceChunkCandidate[] = [];
  const paragraphs = normalized.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  let current = '';

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > 1800 && current) {
      chunks.push({
        chunkIndex: chunks.length,
        text: current,
        hash: hashText(current),
      });
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push({
      chunkIndex: chunks.length,
      text: current,
      hash: hashText(current),
    });
  }

  if (chunks.length === 0 && normalized) {
    chunks.push({ chunkIndex: 0, text: normalized.slice(0, 1800), hash: hashText(normalized) });
  }

  return chunks.slice(0, 250);
}

function splitRequirementSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((line) => line.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter((line) => line.length >= 24 && line.length <= 700);
}

function looksLikeRequirement(text: string): boolean {
  return /\b(must|shall|required|requires|requirement|mandatory|provide|submit|include|comply|compliance|evidence|deadline|due|response|supplier|vendor|bidder|proponent)\b/i.test(
    text,
  );
}

function classifyRequirementType(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(price|pricing|commercial|cost|fee|discount|tax|invoice|payment)\b/.test(lower)) {
    return 'commercial';
  }
  if (/\b(legal|contract|liability|indemnity|terms|privacy|gdpr|data protection)\b/.test(lower)) {
    return 'legal';
  }
  if (/\b(security|soc 2|iso 27001|penetration|vulnerability|encryption|access control)\b/.test(lower)) {
    return 'security';
  }
  if (/\b(sla|support|service desk|availability|incident|response time)\b/.test(lower)) {
    return 'service';
  }
  if (/\b(deliverable|implementation|architecture|integration|technical|migration|cloud)\b/.test(lower)) {
    return 'technical';
  }
  return 'general';
}

function requirementPriority(text: string): RequirementCandidate['priority'] {
  const lower = text.toLowerCase();
  if (/\b(disqualif|mandatory|must not|shall not|penalty|deadline|privacy|breach)\b/.test(lower)) {
    return 'critical';
  }
  if (/\b(must|shall|required|security|compliance|legal|evidence)\b/.test(lower)) {
    return 'high';
  }
  if (/\b(should|requested|prefer|include|provide)\b/.test(lower)) {
    return 'medium';
  }
  return 'low';
}

export function extractRequirementCandidates(chunks: SourceChunkCandidate[]): RequirementCandidate[] {
  const candidates: RequirementCandidate[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    for (const sentence of splitRequirementSentences(chunk.text)) {
      if (!looksLikeRequirement(sentence)) continue;
      const key = sentence.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        externalRef: `REQ-${String(candidates.length + 1).padStart(3, '0')}`,
        text: sentence,
        requirementType: classifyRequirementType(sentence),
        mandatory: /\b(must|shall|required|mandatory)\b/i.test(sentence),
        priority: requirementPriority(sentence),
        confidenceBps: /\b(must|shall|required|mandatory|deadline)\b/i.test(sentence) ? 7800 : 6400,
        sourceChunkIndex: chunk.chunkIndex,
      });
      if (candidates.length >= 120) return candidates;
    }
  }

  return candidates;
}

async function writeBidWorkspaceArtifacts({
  orgId,
  opportunityId,
  bidDocumentId,
  documentVersionId,
  text,
  dustRunId,
}: {
  orgId: string;
  opportunityId: string;
  bidDocumentId: string;
  documentVersionId: string;
  text: string;
  dustRunId: string | null;
}): Promise<void> {
  const chunks = buildSourceChunks(text);
  const requirements = extractRequirementCandidates(chunks);

  await prisma.$transaction(async (tx) => {
    const version = await tx.documentVersion.findFirst({
      where: { id: documentVersionId, orgId, bidDocumentId, deletedAt: null },
      select: { id: true },
    });
    if (!version) {
      throw new Error('Bid document extraction job does not match an active tenant-scoped version');
    }

    const humanTouchedRequirements = await tx.requirement.count({
      where: {
        orgId,
        documentVersionId,
        deletedAt: null,
        status: { not: 'suggested' },
      },
    });

    if (humanTouchedRequirements === 0) {
      await tx.complianceMatrixRow.deleteMany({
        where: {
          orgId,
          requirement: { documentVersionId, status: 'suggested' },
        },
      });
      await tx.requirement.deleteMany({
        where: { orgId, documentVersionId, status: 'suggested' },
      });
      await tx.sourceChunk.deleteMany({ where: { orgId, documentVersionId } });

      const createdChunks = new Map<number, string>();
      for (const chunk of chunks) {
        const row = await tx.sourceChunk.create({
          data: {
            orgId,
            bidDocumentId,
            documentVersionId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            hash: chunk.hash,
            locator: { chunkIndex: chunk.chunkIndex },
          },
          select: { id: true, chunkIndex: true },
        });
        createdChunks.set(row.chunkIndex, row.id);
      }

      for (const requirementCandidate of requirements) {
        const sourceChunkId = createdChunks.get(requirementCandidate.sourceChunkIndex) ?? null;
        const requirement = await tx.requirement.create({
          data: {
            orgId,
            opportunityId,
            bidDocumentId,
            documentVersionId,
            sourceChunkId,
            externalRef: requirementCandidate.externalRef,
            text: requirementCandidate.text,
            requirementType: requirementCandidate.requirementType,
            mandatory: requirementCandidate.mandatory,
            priority: requirementCandidate.priority,
            confidenceBps: requirementCandidate.confidenceBps,
            metadata: {
              extractionManaged: true,
              source: dustRunId ? 'dust_document_extract' : 'deterministic_document_extract',
            },
          },
          select: { id: true, priority: true },
        });
        const citation = [
          {
            bidDocumentId,
            documentVersionId,
            sourceChunkId,
            chunkIndex: requirementCandidate.sourceChunkIndex,
            text: requirementCandidate.text.slice(0, 500),
          },
        ];
        await tx.complianceMatrixRow.create({
          data: {
            orgId,
            opportunityId,
            requirementId: requirement.id,
            risk: requirement.priority,
            citations: citation,
            evidence: citation,
          },
        });
      }

      if (requirements.length === 0) {
        await tx.reviewIssue.create({
          data: {
            orgId,
            opportunityId,
            sourceChunkId: null,
            category: 'extraction',
            severity: 'medium',
            title: 'No explicit requirements detected',
            description:
              'The document was parsed, but no requirement-like statements were detected. Review the source manually before moving this bid forward.',
            recommendation: 'Assign a presales reviewer to inspect the document and add requirements manually.',
          },
        });
      }
    }

    await tx.documentVersion.update({
      where: { id: documentVersionId },
      data: {
        extractedText: text,
        extractionStatus: 'succeeded',
        ocrStatus: 'succeeded',
        layoutJson: {
          chunkCount: chunks.length,
          requirementCount: requirements.length,
        },
        metadata: {
          extractionManaged: true,
          dustRunId,
          skippedRewriteBecauseHumanTouched: humanTouchedRequirements > 0,
        },
      },
    });
    await tx.bidDocument.updateMany({
      where: { id: bidDocumentId, orgId, deletedAt: null },
      data: { status: 'ready' },
    });
    await tx.auditLog.create({
      data: {
        orgId,
        userId: null,
        action: 'bid_document.extracted',
        targetType: 'bid_document',
        targetId: bidDocumentId,
        diff: {
          opportunityId,
          documentVersionId,
          sourceChunks: chunks.length,
          requirements: requirements.length,
          dustRunId,
        },
      },
    });
  });
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
  storageKey: z.string().min(1),
  contentType: z.string().min(1),
  name: z.string().min(1),
  opportunityId: z.string().uuid().optional(),
  bidDocumentId: z.string().uuid().optional(),
  documentVersionId: z.string().uuid().optional(),
  prompt: z.string().optional(),
});
type JobData = z.infer<typeof JobData>;

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const {
    orgId,
    accountId,
    documentId,
    extractionId,
    storageKey,
    contentType,
    name,
    opportunityId,
    bidDocumentId,
    documentVersionId,
    prompt,
  } = JobData.parse(job.data);

  // Mark as running
  const runningUpdate = await prisma.documentExtraction.updateMany({
    where: { id: extractionId, orgId, documentId, deletedAt: null },
    data: { status: 'running' },
  });
  if (runningUpdate.count !== 1) {
    throw new Error('Document extraction job does not match an active tenant-scoped extraction');
  }
  if (bidDocumentId && documentVersionId) {
    await prisma.documentVersion.updateMany({
      where: { id: documentVersionId, orgId, bidDocumentId, deletedAt: null },
      data: { extractionStatus: 'running', ocrStatus: 'running' },
    });
    await prisma.bidDocument.updateMany({
      where: { id: bidDocumentId, orgId, deletedAt: null },
      data: { status: 'extracting' },
    });
  }

  const stored = await readStoredDocument({ orgId, storageKey });
  const extractedText = await extractTextFromBufferSandboxed({
    buffer: stored.buffer,
    contentType,
    name,
    sourcePath: stored.sourcePath,
  });
  const text = extractedText.length > 100_000 ? extractedText.slice(0, 100_000) : extractedText;

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
  const doneUpdate = await prisma.documentExtraction.updateMany({
    where: { id: extractionId, orgId, documentId, deletedAt: null },
    data: {
      status: 'done',
      extractedData: extractedData as unknown as Prisma.InputJsonValue,
      dustRunId,
    },
  });
  if (doneUpdate.count !== 1) {
    throw new Error(
      'Document extraction completion did not match an active tenant-scoped extraction',
    );
  }

  if (bidDocumentId && documentVersionId && opportunityId) {
    await writeBidWorkspaceArtifacts({
      orgId,
      opportunityId,
      bidDocumentId,
      documentVersionId,
      text,
      dustRunId,
    });
  }
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startDocumentExtract(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const queue = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60_000 },
    },
  );

  queue.on('completed', (job) => {
    log.info({ jobId: job.id, documentId: job.data.documentId }, 'document extraction completed');
  });

  queue.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'document extraction failed');
    if (job) {
      const parsed = JobData.safeParse(job.data);
      if (!parsed.success) {
        log.error(
          { jobId: job.id, err: parsed.error },
          'failed to parse job data in failure handler',
        );
        return;
      }
      const { orgId, documentId, extractionId } = parsed.data;
      prisma.documentExtraction
        .updateMany({
          where: { id: extractionId, orgId, documentId, deletedAt: null },
          data: { status: 'error', error: err.message.slice(0, 2000) },
        })
        .catch(() => undefined);
      if (parsed.data.bidDocumentId && parsed.data.documentVersionId) {
        prisma.documentVersion
          .updateMany({
            where: {
              id: parsed.data.documentVersionId,
              orgId,
              bidDocumentId: parsed.data.bidDocumentId,
              deletedAt: null,
            },
            data: {
              extractionStatus: 'failed',
              ocrStatus: 'failed',
              metadata: { error: err.message.slice(0, 2000) },
            },
          })
          .catch(() => undefined);
        prisma.bidDocument
          .updateMany({
            where: { id: parsed.data.bidDocumentId, orgId, deletedAt: null },
            data: { status: 'failed' },
          })
          .catch(() => undefined);
      }
    }
  });

  workers.push(queue);
  log.info({ queue: QUEUE_NAME }, 'document extraction worker started');
}
