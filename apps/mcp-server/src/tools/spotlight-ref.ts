// spotlight_ref — Spotlight Ref MCP tool.
//
// Semantic search over the reference library (past delivered projects, case
// studies, success stories) so an agent drafting a new RFP response can pull
// the most relevant proof points. Embeds the free-text query with Cohere
// (search_query, matching the worker's search_document vectors) and ranks
// references by pgvector cosine similarity. Falls back to keyword search when
// no embedding key is configured (fail-open, consistent with the rest of the
// platform).
//
// Org isolation: every query filters on ctx.orgId on BOTH the embeddings and
// the reference row — the whole tenancy model here is "every handler passes
// ctx.orgId" (see auth.ts). "references" is double-quoted: it is a reserved
// word in PostgreSQL.

import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const COHERE_MODEL = 'embed-multilingual-v3.0';
const EMBED_DIM = 1024;

/**
 * Embed a free-text query with Cohere. input_type 'search_query' is the
 * retrieval counterpart to the worker's 'search_document' write path — using
 * the wrong side measurably degrades recall. Returns null when COHERE_API_KEY
 * is unset (caller falls back to keyword search).
 */
async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts: [text.slice(0, 512)],
        model: COHERE_MODEL,
        input_type: 'search_query',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    const vec = data.embeddings?.[0];
    return vec && vec.length === EMBED_DIM ? vec : null;
  } catch {
    return null;
  }
}

const Input = z.object({
  query: z.string().min(1).max(2000),
  industry: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  limit: z.number().int().min(1).max(25).default(8),
});

interface RefRow {
  id: string;
  title: string;
  description: string | null;
  industry: string | null;
  value_micros: bigint | null;
  usage_count: number;
  document_url: string | null;
  tags: string[];
  score: number;
}

export const spotlightRef: Tool<typeof Input> = {
  description:
    'Spotlight Ref — semantic search over the reference library (past delivered projects, case studies, success stories) to surface the best references for an RFP requirement or section. Ranks by vector similarity, falling back to keyword search when embeddings are unavailable. Returns ranked references with title, description, industry, deal value, usage count, and a relevance score (basis points).',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
        description: 'The RFP requirement or section text to find supporting references for.',
      },
      industry: { type: 'string', maxLength: 100, description: 'Optional exact industry filter.' },
      tags: {
        type: 'array',
        items: { type: 'string', maxLength: 50 },
        maxItems: 10,
        description: 'Optional tag filter — a reference matches if it shares any listed tag.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 25, default: 8 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const vector = await embedQuery(args.query);

    let rows: RefRow[];
    if (vector) {
      const pgVec = `[${vector.join(',')}]`;
      // Over-fetch (4×, capped) so optional industry/tag refinement still has
      // enough rows to return `limit` after filtering.
      const candidateLimit = Math.min(args.limit * 4, 50);
      rows = await prisma.$queryRaw<RefRow[]>`
        SELECT
          r.id::text,
          r.title,
          r.description,
          r.industry,
          r.value_micros,
          r.usage_count,
          r.document_url,
          COALESCE(r.tags, ARRAY[]::text[]) AS tags,
          (1 - (re.vector <=> ${pgVec}::vector)) AS score
        FROM reference_embeddings re
        JOIN "references" r ON r.id = re.reference_id AND r.org_id = re.org_id
        WHERE re.org_id = ${ctx.orgId}::uuid
          AND r.deleted_at IS NULL
        ORDER BY re.vector <=> ${pgVec}::vector
        LIMIT ${candidateLimit}
      `;
    } else {
      // Keyword fallback — no embedding key configured.
      const kw = `%${args.query.slice(0, 200)}%`;
      rows = await prisma.$queryRaw<RefRow[]>`
        SELECT
          r.id::text,
          r.title,
          r.description,
          r.industry,
          r.value_micros,
          r.usage_count,
          r.document_url,
          COALESCE(r.tags, ARRAY[]::text[]) AS tags,
          0::float8 AS score
        FROM "references" r
        WHERE r.org_id = ${ctx.orgId}::uuid
          AND r.deleted_at IS NULL
          AND (r.title ILIKE ${kw} OR r.description ILIKE ${kw})
        ORDER BY r.usage_count DESC, r.created_at DESC
        LIMIT ${args.limit}
      `;
    }

    // Optional refinement in memory keeps the vector SQL simple and safe.
    let results = rows;
    if (args.industry) {
      const want = args.industry.toLowerCase();
      results = results.filter((r) => (r.industry ?? '').toLowerCase() === want);
    }
    if (args.tags && args.tags.length > 0) {
      const want = new Set(args.tags.map((t) => t.toLowerCase()));
      results = results.filter((r) => r.tags.some((t) => want.has(t.toLowerCase())));
    }
    results = results.slice(0, args.limit);

    return {
      mode: vector ? 'semantic' : 'keyword',
      references: results.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        industry: r.industry,
        valueEur: r.value_micros !== null ? Number(r.value_micros) / 1_000_000 : null,
        usageCount: r.usage_count,
        documentUrl: r.document_url,
        tags: r.tags,
        scoreBps: Math.round(Math.max(0, Math.min(1, r.score)) * 10000),
      })),
    };
  },
};
