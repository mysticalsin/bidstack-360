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

// Upper bound on chunks we request from the SERUM retrieval policy for a
// semantic search. Matches the policy's own default maxChunks (8) so a caller
// asking for a larger `limit` (the tool allows up to 25) still runs in semantic
// mode — clamped to this cap — instead of tripping the policy's chunk-count
// guard and silently degrading to keyword search. When the requested limit
// exceeds this cap, the result is flagged via `cappedToPolicyMax`.
const SEMANTIC_RETRIEVAL_CHUNK_CAP = 8;

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
  // True when the caller's `limit` exceeded the semantic retrieval chunk cap, so
  // the semantic search still ran but was capped at SEMANTIC_RETRIEVAL_CHUNK_CAP
  // chunks. Distinguishes a deliberate cap (still semantic) from a keyword
  // fallback (mode === 'keyword'). Absent/false when no capping occurred.
  cappedToPolicyMax?: boolean;
}

export interface ReferenceSearchOpts {
  limit?: number;
  industry?: string;
  tags?: string[];
}

/**
 * Embed a query with Cohere. Returns null — and the caller falls back to keyword
 * search — in three cases:
 *  1. COHERE_API_KEY is unset (no embedding provider configured);
 *  2. the SERUM retrieval policy denies the operation (governed, intentional —
 *     e.g. policy disabled, ungrounded, or below the confidence threshold). Note
 *     the caller clamps `requestedChunks` to SEMANTIC_RETRIEVAL_CHUNK_CAP first,
 *     so a chunk-count over-request is capped rather than denied here;
 *  3. any Cohere transport error or unexpected response shape.
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
  // Clamp the chunk count we ask the SERUM policy for: requesting more than the
  // policy cap is denied outright, which would silently drop us to keyword
  // search. Clamping keeps semantic mode alive (returning up to the cap) and we
  // surface the cap on the result so callers can tell this apart from a denial.
  const requestedChunks = Math.min(limit, SEMANTIC_RETRIEVAL_CHUNK_CAP);
  const cappedToPolicyMax = limit > SEMANTIC_RETRIEVAL_CHUNK_CAP;
  const vector = await embedQuery(orgId, query, requestedChunks);

  // In semantic mode the policy only permits `requestedChunks` grounded chunks,
  // so honour that as the result count too; keyword search is not chunk-governed
  // and uses the full requested `limit`.
  const effectiveLimit = vector ? requestedChunks : limit;

  let rows: RefRow[];
  if (vector) {
    const pgVec = `[${vector.join(',')}]`;
    const candidateLimit = Math.min(effectiveLimit * 4, 50);
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
  results = results.slice(0, effectiveLimit);

  return {
    mode: vector ? 'semantic' : 'keyword',
    // Only meaningful when semantic mode actually ran; a keyword fallback was
    // not capped, it was denied/unconfigured.
    ...(vector && cappedToPolicyMax ? { cappedToPolicyMax: true } : {}),
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
