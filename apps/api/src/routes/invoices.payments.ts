/**
 * invoices.payments.ts — state-transition routes + payment recording sub-plugin.
 *
 *   POST /invoices/:id/send     draft → sent  (+ webhook fan-out)
 *   POST /invoices/:id/cancel   any  → cancelled
 *   POST /invoices/:id/pay      mark fully paid (+ webhook fan-out)
 *   POST /invoices/:id/payments record a partial payment (auto-pays when balance reaches 0)
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { PaymentMethod as PrismaPaymentMethod } from '@bidstack/db';
import { INVOICE_STATE_TRANSITIONS, InvoiceDetail, PaymentCreate } from '@bidstack/shared';
import type { InvoiceState } from '@bidstack/shared';

import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';
import {
  OptionalInvoiceTransitionBody,
  loadInvoiceDetail,
  toPrismaState,
} from './invoices.helpers.js';

export const invoicePaymentsPlugin: FastifyPluginAsyncZod = async (server) => {
  // ── State transitions ─────────────────────────────────────────────────────
  // WHY loop: send and cancel share identical guard logic; the only differences
  // are the action name, the target state, and the webhook event (send only).

  for (const [action, to] of [
    ['send', 'sent'],
    ['cancel', 'cancelled'],
  ] as const) {
    server.post(
      `/invoices/:id/${action}`,
      {
        preHandler: server.requireRole('admin', 'finance'),
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: OptionalInvoiceTransitionBody,
          response: { 200: InvoiceDetail },
        },
      },
      async (req) => {
        const invoice = await prisma.invoice.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId },
        });
        if (!invoice) throw server.httpErrors.notFound('Invoice not found');
        const from = invoice.state as z.infer<typeof InvoiceState>;
        if (!INVOICE_STATE_TRANSITIONS[from].includes(to)) {
          throw server.httpErrors.conflict(
            `Cannot transition from '${from}' to '${to}'. Allowed: ${INVOICE_STATE_TRANSITIONS[from].join(', ')}.`,
          );
        }
        await prisma.$transaction([
          prisma.invoice.update({
            where: { id: invoice.id },
            data: { state: toPrismaState(to) },
          }),
          prisma.auditLog.create({
            data: {
              orgId: req.auth.orgId,
              userId: req.auth.userId,
              action: `invoice.${action}`,
              targetType: 'invoice',
              targetId: invoice.id,
              diff: { from, to, reason: req.body?.reason ?? null },
            },
          }),
        ]);
        // Fan-out invoice.sent — fire-and-forget (fail-open).
        if (to === 'sent') {
          void fanOutWebhookEvent(req.auth.orgId, 'invoice.sent', { id: invoice.id });
        }
        return loadInvoiceDetail(req.auth.orgId, invoice.id);
      },
    );
  }

  // ── POST /invoices/:id/pay ─────────────────────────────────────────────────
  // Pay is special: it also flips paidMicros to totalMicros and writes paidAt.
  server.post(
    '/invoices/:id/pay',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: OptionalInvoiceTransitionBody,
        response: { 200: InvoiceDetail },
      },
    },
    async (req) => {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!invoice) throw server.httpErrors.notFound('Invoice not found');
      const from = invoice.state as z.infer<typeof InvoiceState>;
      if (!INVOICE_STATE_TRANSITIONS[from].includes('paid')) {
        throw server.httpErrors.conflict(
          `Cannot mark as paid from state '${from}'. Allowed: ${INVOICE_STATE_TRANSITIONS[from].join(', ')}.`,
        );
      }
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            state: toPrismaState('paid'),
            paidAt: new Date(),
            paidMicros: invoice.totalMicros,
          },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'invoice.pay',
            targetType: 'invoice',
            targetId: invoice.id,
            diff: { from, to: 'paid', reason: req.body?.reason ?? null },
          },
        }),
      ]);
      // Fan-out invoice.paid — fire-and-forget (fail-open).
      void fanOutWebhookEvent(req.auth.orgId, 'invoice.paid', { id: invoice.id });
      return loadInvoiceDetail(req.auth.orgId, invoice.id);
    },
  );

  // ── POST /invoices/:id/payments ────────────────────────────────────────────
  server.post(
    '/invoices/:id/payments',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: PaymentCreate,
        response: { 201: InvoiceDetail },
      },
    },
    async (req, reply) => {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!invoice) throw server.httpErrors.notFound('Invoice not found');
      if (invoice.state === 'cancelled' || invoice.state === 'paid') {
        throw server.httpErrors.conflict(`Cannot record payments on a ${invoice.state} invoice`);
      }

      const { amountMicros, currency, method, reference, receivedAt } = req.body;
      // Reject cross-currency payments — auto-pay compares raw micros, so a 100 USD
      // payment must not settle a 100 CAD invoice. (Review finding, 2026-06-04.)
      if (currency.toUpperCase() !== invoice.currency.toUpperCase()) {
        throw server.httpErrors.conflict(
          `Payment currency ${currency} does not match invoice currency ${invoice.currency}`,
        );
      }
      const amount = BigInt(amountMicros);
      const paidState = toPrismaState('paid');

      await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            orgId: req.auth.orgId,
            invoiceId: invoice.id,
            amountMicros: amount,
            currency,
            method: method as unknown as PrismaPaymentMethod,
            reference: reference ?? null,
            receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          },
        });
        // Atomic increment (paid_micros = paid_micros + amount) so two concurrent
        // payments can't lost-update each other — the previous read-then-write of
        // the absolute total silently dropped money under concurrency.
        const updated = await tx.invoice.update({
          where: { id: invoice.id },
          data: { paidMicros: { increment: amount } },
        });
        // Auto-pay once cumulative payments meet the total, re-checked from the
        // post-increment row (not a stale read). Idempotent if two payments race.
        const nowPaid = updated.paidMicros >= updated.totalMicros;
        if (nowPaid && updated.state !== paidState) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { state: paidState, paidAt: new Date() },
          });
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'invoice.payment',
            targetType: 'invoice',
            targetId: invoice.id,
            diff: {
              amountMicros: amount.toString(),
              method,
              newPaidMicros: updated.paidMicros.toString(),
              autoPaid: nowPaid,
            },
          },
        });
      });

      return reply.code(201).send(await loadInvoiceDetail(req.auth.orgId, invoice.id));
    },
  );
};
