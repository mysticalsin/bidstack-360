// Booking page management routes (authenticated).
//
// Endpoints:
//   POST /booking-pages          — create a new booking page
//   PUT  /booking-pages/:id      — update a booking page
//   GET  /booking-pages          — list the caller's booking pages
//
// Public booking routes (availability + create + cancel) → bookings-public.ts
// Schemas + email helper                                 → bookings.helpers.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { BookingPageCreate, BookingPagePatch } from './bookings.helpers.js';

const BOOKING_PAGE_LIST_LIMIT = 500;

export const bookingsPagesRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── POST /booking-pages ────────────────────────────────────────────────
  server.post(
    '/booking-pages',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: BookingPageCreate,
        response: {
          201: z.object({ id: z.string().uuid(), slug: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;

      const existing = await prisma.bookingPage.findFirst({
        where: { orgId, slug: req.body.slug, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw server.httpErrors.conflict(
          'A booking page with this slug already exists in your org',
        );
      }

      const page = await prisma.bookingPage.create({
        data: {
          orgId,
          userId,
          slug: req.body.slug,
          name: req.body.name,
          description: req.body.description ?? null,
          durationMinutes: req.body.durationMinutes,
          bufferBeforeMinutes: req.body.bufferBeforeMinutes,
          bufferAfterMinutes: req.body.bufferAfterMinutes,
          minNoticeHours: req.body.minNoticeHours,
          maxAdvanceDays: req.body.maxAdvanceDays,
          availabilityRules: req.body.availabilityRules as Prisma.InputJsonValue,
          isActive: req.body.isActive,
          customQuestions: req.body.customQuestions as Prisma.InputJsonValue,
          redirectUrl: req.body.redirectUrl ?? null,
        },
        select: { id: true, slug: true },
      });

      return reply.code(201).send({ id: page.id, slug: page.slug });
    },
  );

  // ── PUT /booking-pages/:id ─────────────────────────────────────────────
  server.put(
    '/booking-pages/:id',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: BookingPagePatch,
        response: { 200: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;

      const page = await prisma.bookingPage.findFirst({
        where: { id: req.params.id, orgId, deletedAt: null },
        select: { id: true },
      });
      if (!page) throw server.httpErrors.notFound('Booking page not found');

      if (req.body.slug) {
        const conflict = await prisma.bookingPage.findFirst({
          where: {
            orgId,
            slug: req.body.slug,
            deletedAt: null,
            id: { not: req.params.id },
          },
          select: { id: true },
        });
        if (conflict) throw server.httpErrors.conflict('Slug already taken in this org');
      }

      const updated = await prisma.bookingPage.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.slug !== undefined ? { slug: req.body.slug } : {}),
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.durationMinutes !== undefined
            ? { durationMinutes: req.body.durationMinutes }
            : {}),
          ...(req.body.bufferBeforeMinutes !== undefined
            ? { bufferBeforeMinutes: req.body.bufferBeforeMinutes }
            : {}),
          ...(req.body.bufferAfterMinutes !== undefined
            ? { bufferAfterMinutes: req.body.bufferAfterMinutes }
            : {}),
          ...(req.body.minNoticeHours !== undefined
            ? { minNoticeHours: req.body.minNoticeHours }
            : {}),
          ...(req.body.maxAdvanceDays !== undefined
            ? { maxAdvanceDays: req.body.maxAdvanceDays }
            : {}),
          ...(req.body.availabilityRules !== undefined
            ? { availabilityRules: req.body.availabilityRules as Prisma.InputJsonValue }
            : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
          ...(req.body.customQuestions !== undefined
            ? { customQuestions: req.body.customQuestions as Prisma.InputJsonValue }
            : {}),
          ...(req.body.redirectUrl !== undefined ? { redirectUrl: req.body.redirectUrl } : {}),
        },
        select: { id: true },
      });

      return reply.send({ id: updated.id });
    },
  );

  // ── GET /booking-pages ────────────────────────────────────────────────
  server.get(
    '/booking-pages',
    {
      schema: {
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                slug: z.string(),
                name: z.string(),
                isActive: z.boolean(),
                durationMinutes: z.number(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const pages = await prisma.bookingPage.findMany({
        where: { orgId: req.auth.orgId, userId: req.auth.userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: BOOKING_PAGE_LIST_LIMIT,
        select: {
          id: true,
          slug: true,
          name: true,
          isActive: true,
          durationMinutes: true,
          createdAt: true,
        },
      });
      return {
        items: pages.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    },
  );
};
