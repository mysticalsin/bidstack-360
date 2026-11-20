/**
 * tags.helpers.ts — query helpers and local suggestion logic for tag routes.
 *
 * Extracted from tags.ts (BS-R1 file-size refactor).
 * Not part of the public API — imported only by tags.ts.
 */
import { type z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  type EntityTagsResponse,
  type TagSuggestResponse,
  type TaggableEntityType,
} from '@bidstack/shared';

import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';

/**
 * Sprint 1 — tenant-ownership for the taggable surface. The shared
 * `tenantEntityBelongsToOrg` helper covers most types but not the two
 * Polo PreSales-specific ones we tag (`bid_opportunity`, `activity`). Inline
 * the extra cases here rather than expanding the shared helper for a
 * narrow consumer. Returns a plain boolean — handlers do the throw so
 * fastify's request-scoped httpErrors typing stays clean.
 */
export async function taggableOwnedBy(
  orgId: string,
  entityType: z.infer<typeof TaggableEntityType>,
  entityId: string,
): Promise<boolean> {
  if (entityType === 'bid_opportunity') {
    return (
      (await prisma.bidOpportunity.count({ where: { id: entityId, orgId, deletedAt: null } })) > 0
    );
  }
  if (entityType === 'activity') {
    return (await prisma.activity.count({ where: { id: entityId, orgId, deletedAt: null } })) > 0;
  }
  return tenantEntityBelongsToOrg(entityType, entityId, orgId);
}

export async function loadEntityTags(
  orgId: string,
  entityType: z.infer<typeof TaggableEntityType>,
  entityId: string,
): Promise<z.infer<typeof EntityTagsResponse>> {
  const rows = await prisma.entityTag.findMany({
    where: { orgId, entityType, entityId },
    include: { tag: true },
    orderBy: { taggedAt: 'asc' },
  });
  return {
    entityType,
    entityId,
    tags: rows
      .filter((r) => r.tag.deletedAt === null)
      .map((r) => ({
        id: r.tag.id,
        orgId: r.tag.orgId,
        name: r.tag.name,
        color: r.tag.color,
        createdById: r.tag.createdById,
        createdAt: r.tag.createdAt.toISOString(),
        updatedAt: r.tag.updatedAt.toISOString(),
      })),
  };
}

/**
 * Local heuristic tag suggester. Ships in Sprint 1 so the UI can wire up
 * the suggestion chips without waiting for Dust prompt-tuning. Replaced by
 * a Dust agent call in Sprint 2.
 *
 * Heuristic: tokenise the input, find any existing tag whose name appears
 * as a substring (case-insensitive), and surface those first. Then pull a
 * small set of canonical "bid hygiene" tags if their keywords match.
 */
export function suggestTagsLocally(
  text: string,
  existing: Array<{ id: string; name: string }>,
): z.infer<typeof TagSuggestResponse>['suggestions'] {
  const normalised = text.toLowerCase();
  const seen = new Set<string>();
  const out: z.infer<typeof TagSuggestResponse>['suggestions'] = [];

  for (const tag of existing) {
    const key = tag.name.toLowerCase();
    if (seen.has(key)) continue;
    if (normalised.includes(key)) {
      out.push({
        name: tag.name,
        reason: `Existing tag "${tag.name}" appears in the record content.`,
        confidence: 0.9,
        existingTagId: tag.id,
      });
      seen.add(key);
    }
  }

  const HEURISTICS: Array<{ name: string; pattern: RegExp; reason: string }> = [
    {
      name: 'Strategic',
      pattern: /strategic|enterprise|key account/,
      reason: 'Strategic-account language detected.',
    },
    {
      name: 'RFP',
      pattern: /rfp|request for proposal|tender/,
      reason: 'RFP/tender language detected.',
    },
    { name: 'Renewal', pattern: /renewal|renew|expir/, reason: 'Renewal cycle language detected.' },
    {
      name: 'Hot Lead',
      pattern: /hot lead|urgent|deadline this week|short deadline/,
      reason: 'Urgency cues detected.',
    },
    {
      name: 'Public Sector',
      pattern: /public sector|government|gov\.|gov\b|ministry|council/,
      reason: 'Public-sector context detected.',
    },
    {
      name: 'Compliance',
      pattern: /gdpr|hipaa|iso\s?27001|soc\s?2/,
      reason: 'Compliance framework referenced.',
    },
  ];

  for (const h of HEURISTICS) {
    if (out.length >= 5) break;
    const key = h.name.toLowerCase();
    if (seen.has(key)) continue;
    if (h.pattern.test(normalised)) {
      const existingMatch = existing.find((t) => t.name.toLowerCase() === key);
      out.push({
        name: h.name,
        reason: h.reason,
        confidence: 0.7,
        existingTagId: existingMatch?.id ?? null,
      });
      seen.add(key);
    }
  }

  return out.slice(0, 5);
}
