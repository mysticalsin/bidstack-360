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
      preHandler: server.requireRole('admin', 'finance'),
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
      const now = new Date();

      const invoices = await prisma.invoice.findMany({
        where: {
          orgId,
          currency,
          state: { in: ['sent', 'overdue'] },
        },
        select: { id: true, totalMicros: true, paidMicros: true, dueDate: true },
        take: 1000,
      });

      const BUCKETS = [
        { label: 'Current (0–30 days)', minDays: 0, maxDays: 30 },
        { label: '31–60 days', minDays: 31, maxDays: 60 },
        { label: '61–90 days', minDays: 61, maxDays: 90 },
        { label: '90+ days', minDays: 91, maxDays: null as number | null },
      ];

      let totalOutstandingMicros = 0n;
      const bucketResults = BUCKETS.map((b) => {
        const rows = invoices.filter((inv) => {
          const daysPastDue = Math.floor(
            (now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          return daysPastDue >= b.minDays && (b.maxDays === null || daysPastDue <= b.maxDays);
        });
        const outstandingMicros = rows.reduce(
          (sum, inv) => sum + BigInt(inv.totalMicros) - BigInt(inv.paidMicros),
          0n,
        );
        totalOutstandingMicros += outstandingMicros;
        return { ...b, invoiceCount: rows.length, outstandingMicros: String(outstandingMicros) };
      });

      return {
        currency,
        generatedAt: now.toISOString(),
        buckets: bucketResults,
        totalOutstandingMicros: String(totalOutstandingMicros),
      };
    },
  );
};
