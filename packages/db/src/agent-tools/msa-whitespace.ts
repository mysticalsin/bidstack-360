/**
 * MSA whitespace and relationship map tools (slice 13b), read only, shared
 * by the MCP server and Jarvis. Both stay inside the caller's company scope
 * (API-key allowlist or the user's groups).
 */
import { z } from 'zod';

import { prisma } from '../index.js';
import { loadRelationshipMap } from '../msa-whitespace/relationship-map.js';
import { loadWhitespaceFlags } from '../msa-whitespace/load.js';
import { companyScopeWhere, opportunityScopeWhere } from '../msa-whitespace/scope.js';

import type { AgentCitation, AgentTool, AgentToolCtx } from './types.js';

const MAX_ITEMS = 25;

const WhitespaceInput = z.object({
  companyId: z.string().uuid().optional(),
  companyName: z.string().min(1).max(200).optional(),
  line: z.enum(['it', 'engineering', 'digital']).optional(),
  limit: z.number().int().min(1).max(MAX_ITEMS).default(10),
});

const MapInput = z
  .object({
    companyId: z.string().uuid().optional(),
    companyName: z.string().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.companyId || v.companyName), { message: 'companyId or companyName is required' });

type Ctx = AgentToolCtx & { keyId?: string | null };

async function scopeFor(ctx: Ctx) {
  return companyScopeWhere(prisma, { orgId: ctx.orgId, userId: ctx.userId ?? null, keyId: ctx.keyId ?? null });
}

async function resolveCompanyId(ctx: Ctx, args: { companyId?: string; companyName?: string }): Promise<string | null> {
  if (args.companyId) return args.companyId;
  if (!args.companyName) return null;
  const where = await scopeFor(ctx);
  const row = await prisma.company.findFirst({
    where: { AND: [where, { name: { equals: args.companyName, mode: 'insensitive' } }] },
    select: { id: true },
  });
  if (!row) throw new Error('Account not found');
  return row.id;
}

/** msa_whitespace: ranked openings where an MSA exists but a group line does not sell yet. */
export const msaWhitespace: AgentTool<typeof WhitespaceInput> = {
  description:
    'Ranked MSA whitespace: accounts where one of our entities holds an MSA but IT, Engineering or Digital sells nothing yet. Each flag has a 0-100 score with every factor and its evidence (clause, rate card role, hiring, news).',
  input: WhitespaceInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      companyId: { type: 'string', format: 'uuid' },
      companyName: { type: 'string', minLength: 1, maxLength: 200 },
      line: { type: 'string', enum: ['it', 'engineering', 'digital'] },
      limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS },
    },
    additionalProperties: false,
  },
  kind: 'read',
  permission: 'msa:read',
  async handler(args, ctx) {
    const where = await scopeFor(ctx as Ctx);
    const companyId = await resolveCompanyId(ctx as Ctx, args);
    const flags = (await loadWhitespaceFlags(prisma, ctx.orgId, where, { companyId: companyId ?? undefined }))
      .filter((f) => f.state === 'new')
      .filter((f) => !args.line || f.lines.includes(args.line))
      .slice(0, Math.min(MAX_ITEMS, args.limit ?? 10));
    const citations: AgentCitation[] = flags.map((f) => ({ kind: 'account', label: f.companyName, href: `/agreements/${f.msaId}` }));
    return {
      items: flags.map((f) => ({
        headline: f.headline,
        company: f.companyName,
        companyId: f.companyId,
        msaId: f.msaId,
        signingEntity: f.signingEntity.name,
        lines: f.lines,
        score: f.score,
        owner: f.owner?.name ?? null,
        factors: f.factors.map((x) => ({ factor: x.label, points: x.points, max: x.max, detail: x.detail, evidence: x.citations })),
      })),
      citations,
    };
  },
};

/** relationship_map: who in the group works with an account and its affiliates. */
export const relationshipMap: AgentTool<typeof MapInput> = {
  description:
    'Who works with an account and its parent and affiliates: our signing entities with MSAs, opportunities, projects and revenue by business line and owner, contacts, last activity by person, and countries.',
  input: MapInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      companyId: { type: 'string', format: 'uuid' },
      companyName: { type: 'string', minLength: 1, maxLength: 200 },
    },
    additionalProperties: false,
  },
  kind: 'read',
  permission: 'msa:read',
  async handler(args, ctx) {
    const where = await scopeFor(ctx as Ctx);
    const companyId = await resolveCompanyId(ctx as Ctx, args);
    if (!companyId) throw new Error('companyId or companyName is required');
    const c = ctx as Ctx;
    const opportunityWhere = await opportunityScopeWhere(prisma, { orgId: c.orgId, userId: c.userId ?? null, keyId: c.keyId ?? null });
    const map = await loadRelationshipMap(prisma, ctx.orgId, companyId, where, opportunityWhere);
    if (!map) throw new Error('Account not found');
    const citations: AgentCitation[] = [{ kind: 'account', label: map.companies.find((c) => c.relation === 'self')?.name ?? 'Account', href: `/accounts/${companyId}` }];
    return { ...map, rows: map.rows.slice(0, 100), citations };
  },
};
