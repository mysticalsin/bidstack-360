// spotlight_ref — Spotlight Ref MCP tool.
//
// Semantic search over the reference library (past delivered projects, case
// studies, success stories) so an agent drafting a new RFP response can pull
// the most relevant proof points. The ranking logic is shared with
// proposal.draft via ../lib/reference-search.js (no fork).
//
// Org isolation: searchReferences filters on the caller's ctx.orgId — the whole
// tenancy model here is "every handler passes ctx.orgId" (see auth.ts).

import { z } from 'zod';

import { searchReferences } from '../lib/reference-search.js';

import type { Tool } from './index.js';

const Input = z.object({
  query: z.string().min(1).max(2000),
  industry: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  limit: z.number().int().min(1).max(25).default(8),
});

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
    return searchReferences(ctx.orgId, args.query, {
      limit: args.limit,
      industry: args.industry,
      tags: args.tags,
    });
  },
};
