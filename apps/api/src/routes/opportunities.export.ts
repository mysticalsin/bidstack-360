/**
 * Streaming CSV export for opportunities.
 *
 * GET /api/opportunities/export
 *
 * WHY streaming rather than JSON array:
 *   Large orgs can have thousands of opportunities. Loading them all into
 *   memory and serializing to JSON would spike RAM and delay the first byte.
 *   A cursor-batched stream writes 250 rows at a time, keeping the Node.js
 *   heap flat regardless of total row count.
 *
 * Column set matches the client-side export in OpportunitiesPage.tsx so
 * users get identical headers whether they export from the table or via a
 * direct download link.
 */

import { PassThrough } from 'node:stream';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import { microsToUnits } from '@bidstack/shared';

import { applyOpportunityScope, getAccessScope } from '../lib/access-scope.js';

const BATCH_SIZE = 250;

// RFC 4180 quoting + spreadsheet formula-injection neutralization. A leading
// =, +, -, @, tab, or CR is prefixed with ' so Excel/Sheets won't execute it as
// a formula on attacker-controlled free-text (name/customer). Mirrors
// invoices.export.ts. (Review finding, 2026-06-04.)
function csvCell(value: string): string {
  const sanitized = value.replace(/^([=+\-@\t\r])/, "'$1");
  if (/[,"\n\r]/.test(sanitized)) return `"${sanitized.replace(/"/g, '""')}"`;
  return sanitized;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',') + '\r\n';
}

// Micros → display value (× 1e-6, two decimal places). Routed through the
// shared `microsToUnits` helper (BigInt whole/remainder split) rather than the
// naive `Number(micros) / 1e6`, which rounds the BigInt→Number conversion
// *before* dividing and silently corrupts any single value above
// ~$9.007B (Number.MAX_SAFE_INTEGER micros). See packages/shared/src/utils/money.ts.
function formatMicros(micros: bigint | number): string {
  return microsToUnits(micros).toFixed(2);
}

const CSV_HEADERS = [
  'Code',
  'Name',
  'Customer',
  'Stage',
  'Value (EUR)',
  'Probability',
  'Due date',
  'Owner',
  'Territory',
  'Updated at',
] as const;

export const opportunityExportRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/opportunities/export',
    {
      schema: {
        summary: 'Export all opportunities as CSV (streaming)',
        tags: ['opportunities'],
        querystring: z.object({
          stage: z.string().optional(),
          pipelineStageId: z.string().uuid().optional(),
          owner: z.string().email().optional(),
          industry: z.string().optional(),
        }),
        // Bypass Fastify's JSON serializer; reply is streamed as CSV.
        response: { 200: z.any() },
      },
    },
    async (req, reply) => {
      const { stage, pipelineStageId, owner, industry } = req.query;
      const orgId = req.auth.orgId;
      const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      // M7 access scoping: a group-restricted user's CSV must contain exactly
      // the rows they can see in the list/detail views — never a full-org
      // pipeline dump. Mirror the sibling list route (opportunities.ts) by
      // wrapping the where clause with applyOpportunityScope. See lib/access-scope.ts.
      const accessScope = await getAccessScope(orgId, req.auth.userId);
      const where = applyOpportunityScope(
        {
          orgId,
          deletedAt: null,
          ...(pipelineStageId ? { pipelineStageId } : {}),
          ...(stage ? { stage: stage as PrismaStage } : {}),
          ...(industry ? { industry } : {}),
          ...(owner ? { owner: { email: owner } } : {}),
        },
        accessScope,
      );

      // Stream through Fastify so global headers (CORS/security) still apply
      // while keeping memory flat for large exports.
      const stream = new PassThrough();
      reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="polo-presales-opportunities-${stamp}.csv"`)
        .header('Cache-Control', 'no-store');

      const writeExport = async () => {
        // Header row
        stream.write(csvRow([...CSV_HEADERS]));

        let cursor: string | undefined;
        let totalWritten = 0;

        // Cursor-paginate so the heap stays flat for large datasets.
        while (true) {
          // WHY include not select: Prisma's TS inference for relation fields is
          // only reliable with `include`. Using `select` with nested relation
          // objects causes the compiler to fall back to the bare scalar type and
          // lose pipelineStage/owner/territory. include + narrow sub-selects
          // matches the pattern used across every other query in this codebase.
          const batch = await prisma.opportunity.findMany({
            where,
            include: {
              pipelineStage: { select: { name: true } },
              owner: { select: { name: true, email: true } },
              territory: { select: { name: true } },
            },
            // Compound (updatedAt, id) order so ties on the non-unique
            // updatedAt column don't drop rows at a batch boundary: Prisma's
            // cursor can't distinguish already-returned from not-yet-returned
            // rows sharing an updatedAt value without a unique tiebreaker.
            // id: 'asc' matches the tiebreaker direction used in companies.ts /
            // contacts.ts / tasks.ts (Rule 11 — codebase convention).
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });

          if (batch.length === 0) break;

          for (const opp of batch) {
            const stageName = opp.pipelineStage?.name ?? opp.stage ?? '';
            const ownerLabel = opp.owner?.name ?? opp.owner?.email ?? '';
            const territory = opp.territory?.name ?? '';
            stream.write(
              csvRow([
                opp.code,
                opp.name,
                opp.customer,
                stageName,
                formatMicros(opp.valueMicros),
                `${opp.probability}%`,
                opp.dueDate?.toISOString().slice(0, 10) ?? '',
                ownerLabel,
                territory,
                opp.updatedAt.toISOString(),
              ]),
            );
          }

          totalWritten += batch.length;
          cursor = batch[batch.length - 1]!.id;
          if (batch.length < BATCH_SIZE) break;
        }

        req.log.info({ orgId, totalWritten }, 'opportunities/export: streamed CSV');
        stream.end();
      };

      void writeExport().catch((err) => {
        req.log.error({ err }, 'opportunities/export: stream failed');
        stream.destroy(err instanceof Error ? err : new Error('Export stream failed'));
      });

      return reply.send(stream);
    },
  );
};
