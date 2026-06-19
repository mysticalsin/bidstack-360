// Shared reference-library search — used by the spotlight_ref tool and by
// proposal.draft so both rank references the same way (no logic fork).
//
// Embeds the free-text query with Cohere (search_query, the retrieval
// counterpart to the worker's search_document write path) and ranks references
// by pgvector cosine similarity, org-scoped. Falls back to keyword search when
// no embedding key is configured. "references" is a reserved word in
// PostgreSQL and is double-quoted throughout.

import { prisma } from '@bidstack/db';
import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumRetrievalRuntimePolicy,
} from '@bidstack/db/serum-runtime-policy';

const COHERE_MODEL = 'embed-multilingual-v3.0';
const EMBED_DIM = 1024;

export interface RankedReference {
  id: string;
  title: string;
  description: string | null;
  industry: string | null;
  valueEur: number | null;
  usageCount: number;
  documentUrl: string | null;
  tags: string[];
  scoreBps: number;
}

export interface ReferenceSearchResult {
  mode: 'semantic' | 'keyword';
  references: RankedReference[];
}

export interface ReferenceSearchOpts {
  limit?: number;
  industry?: string;
  tags?: string[];
}

/**
 * Embed a query with Cohere. Returns null when COHERE_API_KEY is unset (caller
 * falls back to keyword search) or on any transport/shape error.
 */
export async function embedQuery(
  orgId: string,
  text: string,
  requestedChunks: number,
): Promise<number[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) return null;
  try {
    const decision = await checkSerumRetrievalRuntimePolicy({
      orgId,
      environment: defaultSerumConfigEnvironment(),
      configKey: SERUM_RUNTIME_CONFIG_KEYS.retrieval,
      operation: 'retrieval.referenceSearch',
      requestedChunks,
      sourceBacked: true,
      expectedConfidence: 1,
    });
    if (!decision.allowed) return null;

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

function defaultSerumConfigEnvironment(): 'dev' | 'staging' | 'production' {
  const env = process.env.SERUM_CONFIG_ENVIRONMENT;
  if (env === 'staging' || env === 'production') return env;
  return 'dev';
}

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

/**
 * Rank references for a free-text query, org-scoped. Semantic when embeddings
 * are available, keyword otherwise. Optional industry/tag refinement is applied
 * in memory over an over-fetched candidate set so the vector SQL stays simple.
 */
export async function searchReferences(
  orgId: string,
  query: string,
  opts: ReferenceSearchOpts = {},
): Promise<ReferenceSearchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
  const vector = await embedQuery(orgId, query, limit);

  let rows: RefRow[];
  if (vector) {
    const pgVec = `[${vector.join(',')}]`;
    const candidateLimit = Math.min(limit * 4, 50);
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
      WHERE re.org_id = ${orgId}::uuid
        AND r.deleted_at IS NULL
      ORDER BY re.vector <=> ${pgVec}::vector
      LIMIT ${candidateLimit}
    `;
  } else {
    const kw = `%${query.slice(0, 200)}%`;
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
      WHERE r.org_id = ${orgId}::uuid
        AND r.deleted_at IS NULL
        AND (r.title ILIKE ${kw} OR r.description ILIKE ${kw})
      ORDER BY r.usage_count DESC, r.created_at DESC
      LIMIT ${limit}
    `;
  }

  let results = rows;
  if (opts.industry) {
    const want = opts.industry.toLowerCase();
    results = results.filter((r) => (r.industry ?? '').toLowerCase() === want);
  }
  if (opts.tags && opts.tags.length > 0) {
    const want = new Set(opts.tags.map((t) => t.toLowerCase()));
    results = results.filter((r) => r.tags.some((t) => want.has(t.toLowerCase())));
  }
  results = results.slice(0, limit);

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
}
