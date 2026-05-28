/**
 * Text embedding generation for RFP story retrieval.
 *
 * WHY 1024 dims: Balance between retrieval quality and pgvector HNSW performance.
 * Higher dims (e.g. 3072 for text-embedding-3-large) degrade HNSW ef_search speed
 * with diminishing accuracy gains for short-to-medium business text.
 *
 * Provider: Cohere embed-multilingual-v3 (1024 dims, 512 token context).
 * Fallback: if COHERE_API_KEY absent, returns zero vector (for dev/test only).
 * WHY Cohere over OpenAI: multilingual support for FR/DE/ES RFPs out of the box.
 */

import crypto from 'node:crypto';
import { createLogger } from './logger.js';

const log = createLogger({ name: 'embeddings' });

const EMBEDDING_DIM = 1024;

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dim: number;
  contentHash: string;
}

/** SHA-256 of input text — used to skip re-embedding unchanged content */
export function computeContentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

interface CohereEmbedResponse {
  embeddings: { float: number[][] };
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const contentHash = computeContentHash(text);
  const apiKey = process.env.COHERE_API_KEY;

  if (!apiKey) {
    // Dev/test mode: return zero vector — no real embedding generated.
    // WHY: allows pipeline to function without Cohere key in local dev without
    // making real API calls that would incur cost and external dependency.
    log.warn('COHERE_API_KEY not set — returning zero vector (dev mode)');
    return {
      vector: new Array(EMBEDDING_DIM).fill(0) as number[],
      model: 'zero-dev',
      dim: EMBEDDING_DIM,
      contentHash,
    };
  }

  const resp = await fetch('https://api.cohere.com/v2/embed', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'embed-multilingual-v3.0',
      texts: [text.slice(0, 512)], // Cohere v3 512-token limit
      input_type: 'search_document',
      truncate: 'RIGHT',
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Cohere embed API error ${resp.status}: ${body.slice(0, 200)}`);
  }

  // WHY cast: Cohere response shape is stable but fetch returns unknown
  const data = (await resp.json()) as CohereEmbedResponse;
  const vector = data.embeddings.float[0];

  if (!vector || vector.length !== EMBEDDING_DIM) {
    throw new Error(
      `Unexpected embedding dimension: got ${vector?.length ?? 0}, expected ${EMBEDDING_DIM}`,
    );
  }

  return { vector, model: 'embed-multilingual-v3.0', dim: EMBEDDING_DIM, contentHash };
}
