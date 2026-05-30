/**
 * invoices.export.ts — streaming CSV export + AR-aging report sub-plugin.
 *
 *   GET /invoices/export    — cursor-paginated CSV, streamed via reply.hijack()
 *   GET /invoices/ar-aging  — 4-bucket accounts-receivable aging report
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma } from '@bidstack/db';
import { ArAgingReport, InvoiceFilter } from '@bidstack/shared';

import { ArAgingQuery, toPrismaState } from './invoices.helpers.js';

export const invoiceExportPlugin: FastifyPluginAsyncZod = async (server) => {
  // ── GET /invoices/export ──────────────────────────────────────────────────
  server.get(
    '/invoices/export',
    {
      preHandler: [
        server.requirePermission('invoices:read'),
        server.requireRole('admin', 'finance'),
      ],
      schema: { querystring: InvoiceFilter },
    },
    async (req, reply) => {
      const { state, customerName, salesOrderId, countryCode, search, overdueOnly } = req.query;

      // BS-24: stream the CSV cursor-paginated rather than buffering all rows.
      // Prior behavior loaded 1,000 rows (with 2 eager relations) into memory
      // before any byte was written — large orgs saw GC pressure and a
      // multi-second TTFB. Cursor pagination + reply.raw.write keeps memory
      // flat at one batch worth of rows (200) and lets the browser show the
      // download progress dialog immediately.
      //
      // EXPORT_HARD_CAP is a defensive ceiling: even with cursor pagination
      // we won't stream more than this in a single request. Anything more
      // belongs in a background job that ships an S3-presigned URL to the
      // user. 10,000 is comfortably above any sensible interactive export.
      const EXPORT_HARD_CAP = 10_000;
      const BATCH_SIZE = 200;

      function csvEscape(value: unknown): string {
        const str = value == null ? '' : String(value);
        const sanitized = str.replace(/^(=|\+|-|@|\t|\r)/, "'$1");
        if (!/[,"\r\n]/.test(sanitized)) return sanitized;
        return `"${sanitized.replace(/"/g, '""')}"`;
      }

      const HEADERS = [
        'Number',
        'State',
        'Customer',
        'Currency',
        'Total',
        'Paid',
        'Balance',
        'Invoice Date',
        'Due Date',
        'Salesperson',
        'Lines',
      ];

      const where = {
        orgId: req.auth.orgId,
        ...(state ? { state: toPrismaState(state) } : {}),
        ...(customerName
          ? { customerName: { contains: customerName, mode: 'insensitive' as const } }
          : {}),
        ...(salesOrderId ? { salesOrderId } : {}),
        ...(countryCode ? { countryCode } : {}),
        ...(overdueOnly ? { dueDate: { lt: new Date() } } : {}),
        ...(search
          ? {
              OR: [
                { customerName: { contains: search, mode: 'insensitive' as const } },
                { number: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const stamp = new Date().toISOString().slice(0, 10);
      const tag = state ? `-${state}` : '';
      const filename = `invoices${tag}-${stamp}.csv`;
      const sanitizedName = Array.from(filename)
        .filter((char) => {
          const code = char.charCodeAt(0);
          return code >= 0x20 && code !== 0x7f && char !== '"';
        })
        .join('');
      const encodedFilename = `attachment; filename*=UTF-8''${encodeURIComponent(sanitizedName)}`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', encodedFilename)
        // WHY hijack: takes the reply out of Fastify's send pipeline so we
        // can write to res.raw directly. Without this, Fastify expects a
        // single .send() and any raw writes leak past the JSON serializer.
        .hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': encodedFilename,
        'Transfer-Encoding': 'chunked',
      });
      reply.raw.write('﻿' + HEADERS.map(csvEscape).join(',') + '\r\n');

      let cursor: string | undefined;
      let total = 0;
      while (total < EXPORT_HARD_CAP) {
        const batch = await prisma.invoice.findMany({
          where,
          include: {
            salesperson: { select: { name: true } },
            salesOrder: { select: { number: true } },
            _count: { select: { lines: true } },
          },
          orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) break;
        for (const inv of batch) {
          const totalMicros = inv.totalMicros;
          const paidMicros = inv.paidMicros;
          const balanceMicros = totalMicros - paidMicros;
          const row = [
            inv.number,
            inv.state,
            inv.customerName,
            inv.currency,
            (Number(totalMicros) / 1_000_000).toFixed(2),
            (Number(paidMicros) / 1_000_000).toFixed(2),
            (Number(balanceMicros) / 1_000_000).toFixed(2),
            inv.invoiceDate.toISOString().slice(0, 10),
            inv.dueDate.toISOString().slice(0, 10),
            inv.salesperson?.name ?? '',
            inv._count.lines,
          ];
          reply.raw.write(row.map(csvEscape).join(',') + '\r\n');
        }
        cursor = batch[batch.length - 1]?.id;
        if (!cursor) break;
        total += batch.length;
      }

      if (total >= EXPORT_HARD_CAP) {
        req.log.warn(
          { orgId: req.auth.orgId, exported: total, cap: EXPORT_HARD_CAP },
          'invoice CSV export hit hard cap — consider a background-job export for this org',
        );
      }
      reply.raw.end();
    },
  );

  // ── GET /invoices/ar-aging ────────────────────────────────────────────────
  server.get(
    '/invoices/ar-aging',
    {
      preHandler: [
        server.requirePermission('invoices:read'),
        server.requireRole('admin', 'finance'),
      ],
      schema: {
        querystring: ArAgingQuery,
        response: { 200: ArAgingReport },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const currency = req.query.currency ?? 'CAD';

      // WHY raw SQL: the previous implementation loaded up to 1,000 invoice rows
      // into JS and bucketed them there — silently under-reporting large orgs,
      // wasting memory on rows whose individual values are never needed (only
      // their sums are), and missing the `deleted_at IS NULL` guard.
      // A single GROUP BY pushes all arithmetic to Postgres and returns exactly
      // 4 rows regardless of org size.
      type BucketRow = { bucket: string; invoice_count: bigint; outstanding_micros: bigint };

      const rows = await prisma.$queryRaw<BucketRow[]>`
        SELECT
          CASE
            WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - due_date)) / 86400) BETWEEN  0 AND  30 THEN 'current'
            WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - due_date)) / 86400) BETWEEN 31 AND  60 THEN '31-60'
            WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - due_date)) / 86400) BETWEEN 61 AND  90 THEN '61-90'
            ELSE '90+'
          END                                           AS bucket,
          COUNT(*)                                      AS invoice_count,
          COALESCE(SUM(total_micros - paid_micros), 0)  AS outstanding_micros
        FROM invoices
        WHERE
              org_id     = ${orgId}::uuid
          AND currency   = ${currency}
          AND state      IN ('sent', 'overdue')
          AND deleted_at IS NULL
          AND due_date   <= NOW()
        GROUP BY 1
      `;

      const BUCKETS: Array<{
        label: string;
        key: string;
        minDays: number;
        maxDays: number | null;
      }> = [
        { label: 'Current (0–30 days)', key: 'current', minDays: 0, maxDays: 30 },
        { label: '31–60 days', key: '31-60', minDays: 31, maxDays: 60 },
        { label: '61–90 days', key: '61-90', minDays: 61, maxDays: 90 },
        { label: '90+ days', key: '90+', minDays: 91, maxDays: null },
      ];

      const rowsByKey = Object.fromEntries(rows.map((r) => [r.bucket, r]));
      let totalOutstandingMicros = 0n;

      const buckets = BUCKETS.map((b) => {
        const row = rowsByKey[b.key];
        const outstandingMicros = row ? BigInt(row.outstanding_micros) : 0n;
        totalOutstandingMicros += outstandingMicros;
        return {
          label: b.label,
          minDays: b.minDays,
          maxDays: b.maxDays,
          invoiceCount: row ? Number(row.invoice_count) : 0,
          outstandingMicros: String(outstandingMicros),
        };
      });

      return {
        currency,
        generatedAt: new Date().toISOString(),
        buckets,
        totalOutstandingMicros: String(totalOutstandingMicros),
      };
    },
  );
};
