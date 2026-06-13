import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import { SearchResponse } from '@bidstack/shared';

import { scoreMatch, tokenize } from '../lib/search-score.js';

const VALID_TYPES = ['opportunity', 'lead', 'contact', 'company', 'task', 'note'] as const;

type ValidType = (typeof VALID_TYPES)[number];

/**
 * Token-AND retrieval clause: a row matches only when EVERY query token appears
 * in at least one of `fields` (case-insensitive). This is what lets a multi-term
 * query like "acme paris" find a company named Acme located in Paris, where the
 * two terms live in different columns. Returns undefined for an empty token list
 * so callers fall back to no extra filter.
 */
function tokenAndClauses(
  tokens: string[],
  fields: string[],
): { OR: Record<string, { contains: string; mode: 'insensitive' }>[] }[] {
  return tokens.map((tok) => ({
    OR: fields.map((f) => ({ [f]: { contains: tok, mode: 'insensitive' as const } })),
  }));
}

function recencyMs(...dates: (Date | null | undefined)[]): number {
  for (const d of dates) if (d) return d.getTime();
  return 0;
}

export const searchRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/search',
    {
      // Per-user cap: search fans out concurrent ILIKE queries across 6 entities,
      // so protect it from runaway autocomplete/abuse at scale. Generous enough
      // for fast debounced typing (2/sec sustained).
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          q: z.string().trim().min(1).max(120),
          types: z.string().max(255).optional(),
          limit: z.coerce.number().int().min(1).max(20).default(5),
        }),
        response: { 200: SearchResponse },
      },
    },
    async (req) => {
      const { q, types, limit: perTypeLimit } = req.query;
      const requestedTypes = types
        ? types
            .split(',')
            .map((t) => t.trim())
            .filter((t): t is ValidType => VALID_TYPES.includes(t as ValidType))
        : [...VALID_TYPES];

      const totalCap = 30;
      const tokens = tokenize(q);
      // Zod already rejects an all-whitespace q (trim + min 1), so this only
      // fires on a degenerate token set. Guard anyway: an empty token list would
      // make the token-AND clauses match-all (the whole org), never that.
      if (tokens.length === 0) return { items: [] };
      type SearchItem = z.infer<typeof SearchResponse>['items'][number];
      // Carry a recency timestamp alongside each item so equally-relevant matches
      // are tie-broken by "most recently touched" instead of arbitrary type order.
      type Scored = { item: SearchItem; recency: number };
      const buckets: Scored[][] = [];
      const addResults = (items: Scored[]) => {
        buckets.push(items);
      };

      const queries: Array<Promise<unknown>> = [];

      if (requestedTypes.includes('opportunity')) {
        queries.push(
          (async () => {
            // Each token must match the concatenated text (token-AND). The
            // concat MUST be byte-identical to the GIN trigram index expression
            // (migration 20260510235000: coalesce(...) on each column) — Postgres
            // only uses an expression index when the predicate expression matches
            // structurally, so a bare `customer || …` would silently seq-scan.
            const concat = Prisma.sql`(coalesce(customer,'') || ' ' || coalesce(name,'') || ' ' || coalesce(code,''))`;
            const tokenConds =
              tokens.length > 0
                ? Prisma.join(
                    tokens.map((t) => Prisma.sql`${concat} ILIKE ${`%${t}%`}`),
                    ' AND ',
                  )
                : Prisma.sql`TRUE`;
            const opps = await prisma.$queryRaw<
              Array<{ id: string; code: string; customer: string; name: string; updated_at: Date }>
            >`
              SELECT id, code, customer, name, updated_at
              FROM opportunities
              WHERE org_id = ${req.auth.orgId}::uuid
                AND deleted_at IS NULL
                AND (${tokenConds})
              ORDER BY updated_at DESC
              LIMIT ${perTypeLimit}
            `;
            addResults(
              opps.map((o) => ({
                item: {
                  type: 'opportunity' as const,
                  id: o.id,
                  title: `${o.code} — ${o.name}`,
                  subtitle: o.customer,
                  url: `/opportunities/${o.id}`,
                  score: scoreMatch(q, [
                    { text: o.name, weight: 3 },
                    { text: o.customer, weight: 3 },
                    { text: o.code, weight: 2 },
                  ]),
                },
                recency: recencyMs(o.updated_at),
              })),
            );
          })(),
        );
      }

      if (requestedTypes.includes('lead')) {
        queries.push(
          (async () => {
            const leads = await prisma.lead.findMany({
              where: {
                orgId: req.auth.orgId,
                deletedAt: null,
                AND: tokenAndClauses(tokens, [
                  'firstName',
                  'lastName',
                  'email',
                  'companyName',
                ]) as Prisma.LeadWhereInput['AND'],
              },
              orderBy: { statusChangedAt: 'desc' },
              take: perTypeLimit,
            });
            addResults(
              leads.map((l) => ({
                item: {
                  type: 'lead' as const,
                  id: l.id,
                  title: `${l.firstName} ${l.lastName}`.trim(),
                  subtitle: [l.companyName, l.email].filter(Boolean).join(' · '),
                  url: `/leads/${l.id}`,
                  score: scoreMatch(q, [
                    { text: l.firstName, weight: 3 },
                    { text: l.lastName, weight: 3 },
                    { text: l.companyName, weight: 2 },
                    { text: l.email, weight: 2 },
                  ]),
                },
                recency: recencyMs(l.statusChangedAt, l.updatedAt, l.createdAt),
              })),
            );
          })(),
        );
      }

      if (requestedTypes.includes('contact')) {
        queries.push(
          (async () => {
            const contacts = await prisma.contact.findMany({
              where: {
                orgId: req.auth.orgId,
                deletedAt: null,
                AND: tokenAndClauses(tokens, [
                  'name',
                  'email',
                  'role',
                ]) as Prisma.ContactWhereInput['AND'],
              },
              take: perTypeLimit,
            });
            addResults(
              contacts.map((c) => ({
                item: {
                  type: 'contact' as const,
                  id: c.id,
                  title: c.name,
                  subtitle: [c.role, c.email, c.customer].filter(Boolean).join(' · '),
                  url: `/contacts?search=${encodeURIComponent(c.name)}`,
                  score: scoreMatch(q, [
                    { text: c.name, weight: 3 },
                    { text: c.role, weight: 2 },
                    { text: c.email, weight: 2 },
                    { text: c.customer, weight: 2 },
                  ]),
                },
                recency: recencyMs(c.createdAt),
              })),
            );
          })(),
        );
      }

      if (requestedTypes.includes('company')) {
        queries.push(
          (async () => {
            const companies = await prisma.companyEnrichment.findMany({
              where: {
                orgId: req.auth.orgId,
                deletedAt: null,
                AND: tokenAndClauses(tokens, [
                  'normalizedName',
                  'domain',
                  'tradeName',
                  'legalName',
                ]) as Prisma.CompanyEnrichmentWhereInput['AND'],
              },
              take: perTypeLimit,
            });
            addResults(
              companies.map((c) => ({
                item: {
                  type: 'company' as const,
                  id: c.id,
                  title: c.tradeName ?? c.legalName,
                  subtitle: c.domain ?? '',
                  url: `/accounts/${encodeURIComponent(c.id)}`,
                  score: scoreMatch(q, [
                    { text: c.tradeName, weight: 3 },
                    { text: c.normalizedName, weight: 3 },
                    { text: c.domain, weight: 2 },
                    { text: c.legalName, weight: 2 },
                  ]),
                },
                recency: recencyMs(c.updatedAt, c.createdAt),
              })),
            );
          })(),
        );
      }

      if (requestedTypes.includes('task')) {
        queries.push(
          (async () => {
            const tasks = await prisma.task.findMany({
              where: {
                orgId: req.auth.orgId,
                deletedAt: null,
                AND: tokenAndClauses(tokens, ['title']) as Prisma.TaskWhereInput['AND'],
              },
              take: perTypeLimit,
            });
            addResults(
              tasks.map((t) => ({
                item: {
                  type: 'task' as const,
                  id: t.id,
                  title: t.title,
                  subtitle: t.status,
                  url: `/tasks?search=${encodeURIComponent(t.title)}`,
                  score: scoreMatch(q, [{ text: t.title, weight: 3 }]),
                },
                recency: recencyMs(t.createdAt),
              })),
            );
          })(),
        );
      }

      if (requestedTypes.includes('note')) {
        queries.push(
          (async () => {
            const notes = await prisma.note.findMany({
              where: {
                orgId: req.auth.orgId,
                deletedAt: null,
                AND: tokenAndClauses(tokens, [
                  'title',
                  'bodyMd',
                ]) as Prisma.NoteWhereInput['AND'],
              },
              take: perTypeLimit,
            });
            addResults(
              notes.map((n) => ({
                item: {
                  type: 'note' as const,
                  id: n.id,
                  title: n.title,
                  subtitle: n.accountId,
                  url: `/accounts/${encodeURIComponent(n.accountId)}`,
                  score: scoreMatch(q, [
                    { text: n.title, weight: 3 },
                    { text: n.bodyMd, weight: 1 },
                  ]),
                },
                recency: recencyMs(n.updatedAt, n.createdAt),
              })),
            );
          })(),
        );
      }

      // All per-type queries run concurrently.
      await Promise.all(queries);

      // Rank by relevance, then by recency for ties, then keep the best globally.
      const results = buckets
        .flat()
        .sort((a, b) => b.item.score - a.item.score || b.recency - a.recency)
        .slice(0, totalCap)
        .map((s) => s.item);

      return { items: results };
    },
  );
};
