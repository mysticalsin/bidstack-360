import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { SearchResponse } from '@bidstack/shared';

const VALID_TYPES = ['opportunity', 'contact', 'company', 'task', 'note', 'sales_order'] as const;

type ValidType = (typeof VALID_TYPES)[number];

export const searchRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/search',
    {
      schema: {
        querystring: z.object({
          q: z.string().trim().min(1).max(120),
          types: z.string().optional(),
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
      const results: Array<z.infer<typeof SearchResponse>['items'][number]> = [];

      const addResults = (items: typeof results) => {
        const remaining = totalCap - results.length;
        if (remaining > 0) {
          results.push(...items.slice(0, remaining));
        }
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

      if (requestedTypes.includes('opportunity')) {
        // Leverage the GIN trigram index on (customer || ' ' || name || ' ' || code).
        const opps = await prisma.$queryRaw<
          Array<{ id: string; code: string; customer: string; name: string }>
        >`
          SELECT id, code, customer, name
          FROM opportunities
          WHERE org_id = ${req.auth.orgId}::uuid
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
      }

      if (requestedTypes.includes('contact')) {
        const contacts = await prisma.contact.findMany({
          where: {
            orgId: req.auth.orgId,
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
      }

      if (requestedTypes.includes('company')) {
        const companies = await prisma.companyEnrichment.findMany({
          where: {
            orgId: req.auth.orgId,
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
      }

      if (requestedTypes.includes('task')) {
        const tasks = await prisma.task.findMany({
          where: {
            orgId: req.auth.orgId,
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
      }

      if (requestedTypes.includes('note')) {
        const notes = await prisma.note.findMany({
          where: {
            orgId: req.auth.orgId,
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
      }

      if (requestedTypes.includes('sales_order')) {
        const orders = await prisma.salesOrder.findMany({
          where: {
            orgId: req.auth.orgId,
            OR: [
              { number: { contains: q, mode: 'insensitive' } },
              { customerName: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: perTypeLimit,
        });
        addResults(
          orders.map((o) => ({
            type: 'sales_order' as const,
            id: o.id,
            title: o.number,
            subtitle: o.customerName,
            url: `/sales/orders/${o.id}`,
            score: score(o.number, o.customerName),
          })),
        );
      }

      // Sort by relevance descending so the highest-quality matches surface first.
      results.sort((a, b) => b.score - a.score);

      return { items: results };
    },
  );
};
