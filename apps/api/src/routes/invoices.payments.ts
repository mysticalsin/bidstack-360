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
      const amount = BigInt(amountMicros);
      const newPaidMicros = invoice.paidMicros + amount;
      // Auto-pay: when cumulative payments meet or exceed the invoice total,
      // flip state to 'paid' so the invoice doesn't linger as overdue.
      const nowPaid = newPaidMicros >= invoice.totalMicros;

      await prisma.$transaction([
        prisma.payment.create({
          data: {
            orgId: req.auth.orgId,
            invoiceId: invoice.id,
            amountMicros: amount,
            currency,
            method: method as unknown as PrismaPaymentMethod,
            reference: reference ?? null,
            receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          },
        }),
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            paidMicros: newPaidMicros,
            ...(nowPaid ? { state: toPrismaState('paid'), paidAt: new Date() } : {}),
          },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'invoice.payment',
            targetType: 'invoice',
            targetId: invoice.id,
            diff: {
              amountMicros: amount.toString(),
              method,
              newPaidMicros: newPaidMicros.toString(),
              autoPaid: nowPaid,
            },
          },
        }),
      ]);

      return reply.code(201).send(await loadInvoiceDetail(req.auth.orgId, invoice.id));
    },
  );
};
