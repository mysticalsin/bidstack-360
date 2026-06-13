import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { SearchResponse } from '@bidstack/shared';

const VALID_TYPES = ['opportunity', 'contact', 'company', 'task', 'note'] as const;

type ValidType = (typeof VALID_TYPES)[number];

export const searchRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/search',
    {
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
      type SearchItem = z.infer<typeof SearchResponse>['items'][number];
      const buckets: SearchItem[][] = [];
      // Each type pushes its mapped rows into its own bucket; buckets are
      // concatenated, score-sorted, and capped AFTER all queries resolve — so
      // the global cap keeps the highest-scoring matches regardless of type
      // order (the old running cap could drop a better match from a later type).
      const addResults = (items: SearchItem[]) => {
        buckets.push(items);
      };

      const like = `%${q}%`;
      const lowerQ = q.toLowerCase();

      function score(...fields: (string | null | undefined)[]): number {
        const text = fields.filter(Boolean).join(' ').toLowerCase();
        if (text === lowerQ) return 100;
        const idx = text.indexOf(lowerQ);
        if (idx === 0) return 80;
        if (idx > 0) return 60;
        return 0;
      }

      const queries: Array<Promise<unknown>> = [];

      if (requestedTypes.includes('opportunity')) {
        queries.push((async () => {
        // Leverage the GIN trigram index on (customer || ' ' || name || ' ' || code).
        const opps = await prisma.$queryRaw<
          Array<{ id: string; code: string; customer: string; name: string }>
        >`
          SELECT id, code, customer, name
          FROM opportunities
          WHERE org_id = ${req.auth.orgId}::uuid
            AND deleted_at IS NULL
            AND (customer || ' ' || name || ' ' || code) ILIKE ${like}
          ORDER BY updated_at DESC
          LIMIT ${perTypeLimit}
        `;
        addResults(
          opps.map((o) => ({
            type: 'opportunity' as const,
            id: o.id,
            title: `${o.code} — ${o.name}`,
            subtitle: o.customer,
            url: `/opportunities/${o.id}`,
            score: score(o.code, o.name, o.customer),
          })),
        );
        })());
      }

      if (requestedTypes.includes('contact')) {
        queries.push((async () => {
        const contacts = await prisma.contact.findMany({
          where: {
            orgId: req.auth.orgId,
            deletedAt: null,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { role: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: perTypeLimit,
        });
        addResults(
          contacts.map((c) => ({
            type: 'contact' as const,
            id: c.id,
            title: c.name,
            subtitle: [c.role, c.email, c.customer].filter(Boolean).join(' · '),
            url: `/contacts?search=${encodeURIComponent(c.name)}`,
            score: score(c.name, c.email, c.role, c.customer),
          })),
        );
        })());
      }

      if (requestedTypes.includes('company')) {
        queries.push((async () => {
        const companies = await prisma.companyEnrichment.findMany({
          where: {
            orgId: req.auth.orgId,
            deletedAt: null,
            OR: [
              { normalizedName: { contains: q, mode: 'insensitive' } },
              { domain: { contains: q, mode: 'insensitive' } },
              { tradeName: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: perTypeLimit,
        });
        addResults(
          companies.map((c) => ({
            type: 'company' as const,
            id: c.id,
            title: c.tradeName ?? c.legalName,
            subtitle: c.domain ?? '',
            url: `/accounts/${encodeURIComponent(c.id)}`,
            score: score(c.normalizedName, c.domain, c.tradeName),
          })),
        );
        })());
      }

      if (requestedTypes.includes('task')) {
        queries.push((async () => {
        const tasks = await prisma.task.findMany({
          where: {
            orgId: req.auth.orgId,
            deletedAt: null,
            title: { contains: q, mode: 'insensitive' },
          },
          take: perTypeLimit,
        });
        addResults(
          tasks.map((t) => ({
            type: 'task' as const,
            id: t.id,
            title: t.title,
            subtitle: t.status,
            url: `/tasks?search=${encodeURIComponent(t.title)}`,
            score: score(t.title),
          })),
        );
        })());
      }

      if (requestedTypes.includes('note')) {
        queries.push((async () => {
        const notes = await prisma.note.findMany({
          where: {
            orgId: req.auth.orgId,
            deletedAt: null,
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { bodyMd: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: perTypeLimit,
        });
        addResults(
          notes.map((n) => ({
            type: 'note' as const,
            id: n.id,
            title: n.title,
            subtitle: n.accountId,
            url: `/accounts/${encodeURIComponent(n.accountId)}`,
            score: score(n.title) + (n.bodyMd.toLowerCase().includes(lowerQ) ? 5 : 0),
          })),
        );
        })());
      }


      // All per-type queries run concurrently (was strictly sequential).
      await Promise.all(queries);

      // Sort by relevance descending so the highest-quality matches surface
      // first, then apply the global cap so it keeps the best across all types.
      const results = buckets
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, totalCap);

      return { items: results };
    },
  );
};
