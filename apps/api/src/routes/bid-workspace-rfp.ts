// Bid-workspace RFP review routes — the awaiting-approval stage surface.
//
//   GET   /bid-workspaces/:opportunityId/story-matches
//   GET   /bid-workspaces/:opportunityId/draft
//   PATCH /bid-workspaces/:opportunityId/draft/sections/:sectionId
//
// WHY here (not /proposals/:proposalId): the frontend hooks (useRfpStoryMatches,
// useRfpDraft) are keyed by bidWorkspaceId, which IS the opportunityId in this
// domain (same invariant useRfpCompliance relies on). The opportunity → proposal
// resolution happens server-side, mirroring the sibling /compliance route.
//
// WHY raw SQL for proposal_sections + requirement_reference_matches: the
// human_reviewed column is new and requirement_reference_matches is a Wave-9
// table, neither of which the dev-generated Prisma client carries yet (Windows
// regen lock); Azure/Linux regenerates cleanly. Parameterized + org-scoped.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { RFP_CREW, CREW_STAGES, crewMemberByKey } from '@bidstack/shared';

import { WorkspaceParams, ensureOpportunity } from './bid-workspace.helpers.js';

// Crew-board layout = a map of crew memberKey -> station (a pipeline stage or
// 'oversight'). Sanitized against the shared roster on every read + write so a
// forged key, an invalid station, or a roster change can never persist or
// resurface; the master (Bid Director) is pinned to oversight.
const VALID_STATIONS = new Set<string>([...CREW_STAGES, 'oversight']);
const CREW_KEYS = new Set(RFP_CREW.map((m) => m.key));

function sanitizeCrewLayout(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, station] of Object.entries(input ?? {})) {
    if (!CREW_KEYS.has(key) || !VALID_STATIONS.has(station)) continue;
    if (crewMemberByKey(key)?.isMaster && station !== 'oversight') continue;
    out[key] = station;
  }
  return out;
}

const StoryMatch = z.object({
  id: z.string().uuid(),
  title: z.string(),
  client: z.string(),
  industry: z.string(),
  relevanceScore: z.number().int().min(0).max(100),
  hybridScoreBps: z.number().int().min(0).max(10000),
  summary: z.string(),
  matchedRequirements: z.array(z.string()),
  url: z.string().nullable(),
});

const DraftSection = z.object({
  id: z.string().uuid(),
  order: z.number().int(),
  title: z.string(),
  content: z.string(),
  aiGenerated: z.boolean(),
  humanReviewed: z.boolean(),
  lastEditedAt: z.string().nullable(),
});

interface MatchRow {
  reference_id: string;
  requirement_id: string;
  score_bps: number;
}
interface SectionRow {
  id: string;
  sort_order: number;
  title: string;
  content: string;
  ai_drafted: boolean;
  human_reviewed: boolean;
  updated_at: Date;
}

const toDraftSection = (r: SectionRow) => ({
  id: r.id,
  order: r.sort_order,
  title: r.title,
  content: r.content,
  aiGenerated: r.ai_drafted,
  humanReviewed: r.human_reviewed,
  lastEditedAt: r.updated_at.toISOString(),
});

/** The most recent non-deleted proposal for an opportunity (the active draft). */
async function latestProposalId(orgId: string, opportunityId: string): Promise<string | null> {
  const proposal = await prisma.proposal.findFirst({
    where: { orgId, opportunityId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return proposal?.id ?? null;
}

export const bidWorkspaceRfpRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── GET story matches (success stories matched to this RFP's requirements) ──
  server.get(
    '/bid-workspaces/:opportunityId/story-matches',
    {
      preHandler: server.requirePermission('documents:read'),
      schema: {
        params: WorkspaceParams,
        response: { 200: z.object({ items: z.array(StoryMatch), total: z.number().int() }) },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const requirements = await prisma.requirement.findMany({
        where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
        select: { id: true },
      });
      if (requirements.length === 0) return { items: [], total: 0 };
      const requirementIds = requirements.map((r) => r.id);

      // Wave-9 table — raw SQL. Org-scoped + bounded to this RFP's requirements.
      const matches = await prisma.$queryRaw<MatchRow[]>`
        SELECT reference_id, requirement_id, score_bps
        FROM requirement_reference_matches
        WHERE org_id = ${req.auth.orgId}::uuid AND deleted_at IS NULL
          AND requirement_id = ANY(${requirementIds}::uuid[])
      `;
      if (matches.length === 0) return { items: [], total: 0 };

      // Group by reference (success story): best score + the requirements it hit.
      const byRef = new Map<string, { score: number; reqs: Set<string> }>();
      for (const m of matches) {
        const agg = byRef.get(m.reference_id) ?? { score: 0, reqs: new Set<string>() };
        agg.score = Math.max(agg.score, m.score_bps);
        agg.reqs.add(m.requirement_id);
        byRef.set(m.reference_id, agg);
      }

      // Reference + company are core models (in the client) — typed lookup.
      const refs = await prisma.reference.findMany({
        where: { orgId: req.auth.orgId, id: { in: [...byRef.keys()] }, deletedAt: null },
        select: {
          id: true,
          title: true,
          industry: true,
          description: true,
          documentUrl: true,
          company: { select: { name: true } },
        },
      });

      const items = refs
        .map((r) => {
          const agg = byRef.get(r.id);
          const score = agg?.score ?? 0;
          return {
            id: r.id,
            title: r.title,
            client: r.company?.name ?? '',
            industry: r.industry ?? '',
            relevanceScore: Math.round(score / 100),
            hybridScoreBps: score,
            summary: r.description ?? '',
            matchedRequirements: agg ? [...agg.reqs] : [],
            url: r.documentUrl,
          };
        })
        .sort((a, b) => b.hybridScoreBps - a.hybridScoreBps);

      return { items, total: items.length };
    },
  );

  // ─── GET the proposal draft (sections) for review ────────────────────────────
  server.get(
    '/bid-workspaces/:opportunityId/draft',
    {
      preHandler: server.requirePermission('documents:read'),
      schema: {
        params: WorkspaceParams,
        response: {
          200: z.object({ proposalId: z.string().uuid(), sections: z.array(DraftSection) }),
        },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const proposalId = await latestProposalId(req.auth.orgId, opportunity.id);
      if (!proposalId) return reply.notFound('No proposal draft for this opportunity yet');

      const sections = await prisma.$queryRaw<SectionRow[]>`
        SELECT id, sort_order, title, content, ai_drafted, human_reviewed, updated_at
        FROM proposal_sections
        WHERE org_id = ${req.auth.orgId}::uuid AND proposal_id = ${proposalId}::uuid
          AND deleted_at IS NULL
        ORDER BY sort_order ASC
      `;
      return { proposalId, sections: sections.map(toDraftSection) };
    },
  );

  // ─── PATCH a draft section (content + human-review flag) ─────────────────────
  server.patch(
    '/bid-workspaces/:opportunityId/draft/sections/:sectionId',
    {
      preHandler: server.requirePermission('documents:write'),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: WorkspaceParams.extend({ sectionId: z.string().uuid() }),
        body: z.object({ content: z.string().max(100_000), humanReviewed: z.boolean() }),
        response: { 200: DraftSection },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const proposalId = await latestProposalId(req.auth.orgId, opportunity.id);
      if (!proposalId) return reply.notFound('No proposal draft for this opportunity yet');

      const wordCount = req.body.content.trim().split(/\s+/).filter(Boolean).length;
      // Update scoped to org + the resolved proposal so a forged sectionId from
      // another proposal/org can't be written. RETURNING gives us the new row.
      const rows = await prisma.$queryRaw<SectionRow[]>`
        UPDATE proposal_sections
        SET content = ${req.body.content},
            word_count = ${wordCount},
            human_reviewed = ${req.body.humanReviewed},
            updated_at = now()
        WHERE id = ${req.params.sectionId}::uuid AND org_id = ${req.auth.orgId}::uuid
          AND proposal_id = ${proposalId}::uuid AND deleted_at IS NULL
        RETURNING id, sort_order, title, content, ai_drafted, human_reviewed, updated_at
      `;
      const updated = rows[0];
      if (!updated) return reply.notFound('Section not found');
      return toDraftSection(updated);
    },
  );

  // ─── GET the saved crew-board layout for this workspace ──────────────────────
  server.get(
    '/bid-workspaces/:opportunityId/crew-layout',
    {
      preHandler: server.requirePermission('documents:read'),
      schema: {
        params: WorkspaceParams,
        response: { 200: z.object({ layout: z.record(z.string()) }) },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const rows = await prisma.$queryRaw<{ layout: Record<string, string> }[]>`
        SELECT layout FROM rfp_crew_layouts
        WHERE org_id = ${req.auth.orgId}::uuid AND opportunity_id = ${opportunity.id}::uuid
      `;
      return { layout: sanitizeCrewLayout(rows[0]?.layout ?? {}) };
    },
  );

  // ─── PUT the crew-board layout (persists drag-to-restation per workspace) ────
  server.put(
    '/bid-workspaces/:opportunityId/crew-layout',
    {
      preHandler: server.requirePermission('documents:write'),
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: WorkspaceParams,
        body: z.object({ layout: z.record(z.string()) }),
        response: { 200: z.object({ layout: z.record(z.string()) }) },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const layout = sanitizeCrewLayout(req.body.layout);
      const json = JSON.stringify(layout);
      await prisma.$executeRaw`
        INSERT INTO rfp_crew_layouts (id, org_id, opportunity_id, layout, created_at, updated_at)
        VALUES (gen_random_uuid(), ${req.auth.orgId}::uuid, ${opportunity.id}::uuid, ${json}::jsonb, now(), now())
        ON CONFLICT ON CONSTRAINT uniq_org_opportunity_crew_layout
        DO UPDATE SET layout = ${json}::jsonb, updated_at = now()
      `;
      return { layout };
    },
  );
};
