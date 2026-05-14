import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  ProductCategoryCreate,
  ProductCategory,
  ProductCreate,
  ProductUpdate,
  ProductFilter,
  ProductPage,
  Product,
} from '@bidstack/shared';

export const productsRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── Categories ───────────────────────────────────────────────────────────
  server.get(
    '/products/categories',
    {
      schema: {
        response: { 200: z.array(ProductCategory) },
      },
    },
    async (req) => {
      const rows = await prisma.productCategory.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: { name: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        parentId: r.parentId,
        createdAt: r.createdAt.toISOString(),
      }));
    },
  );

  server.post(
    '/products/categories',
    {
      schema: {
        body: ProductCategoryCreate,
        response: { 201: ProductCategory },
      },
    },
    async (req, reply) => {
      const created = await prisma.productCategory.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          parentId: req.body.parentId ?? null,
        },
      });
      return reply.code(201).send({
        id: created.id,
        name: created.name,
        parentId: created.parentId,
        createdAt: created.createdAt.toISOString(),
      });
    },
  );

  // ─── Products list ────────────────────────────────────────────────────────
  server.get(
    '/products',
    {
      schema: {
        querystring: ProductFilter,
        response: { 200: ProductPage },
      },
    },
    async (req) => {
      const { search, categoryId, activeOnly, cursor, limit } = req.query;
      const where: Prisma.ProductWhereInput = {
        orgId: req.auth.orgId,
        ...(categoryId ? { categoryId } : {}),
        ...(activeOnly === 'true'
          ? { active: true }
          : activeOnly === 'false'
            ? { active: false }
            : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const rows = await prisma.product.findMany({
        where,
        include: { category: { select: { name: true } } },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: page.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          categoryId: p.categoryId,
          categoryName: p.category?.name ?? null,
          listPriceMicros: p.listPriceMicros.toString(),
          currency: p.currency,
          active: p.active,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  );

  // ─── Product detail ───────────────────────────────────────────────────────
  server.get(
    '/products/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: Product },
      },
    },
    async (req) => {
      const p = await prisma.product.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        include: { category: { select: { name: true } } },
      });
      if (!p) throw server.httpErrors.notFound('Product not found');
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
        listPriceMicros: p.listPriceMicros.toString(),
        currency: p.currency,
        active: p.active,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    },
  );

  // ─── Create product ───────────────────────────────────────────────────────
  server.post(
    '/products',
    {
      schema: {
        body: ProductCreate,
        response: { 201: Product },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const created = await prisma.product.create({
        data: {
          orgId: req.auth.orgId,
          sku: body.sku,
          name: body.name,
          categoryId: body.categoryId ?? null,
          listPriceMicros: BigInt(body.listPriceMicros),
          currency: body.currency,
          active: body.active,
        },
        include: { category: { select: { name: true } } },
      });
      return reply.code(201).send({
        id: created.id,
        sku: created.sku,
        name: created.name,
        categoryId: created.categoryId,
        categoryName: created.category?.name ?? null,
        listPriceMicros: created.listPriceMicros.toString(),
        currency: created.currency,
        active: created.active,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // ─── Update product ───────────────────────────────────────────────────────
  server.patch(
    '/products/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ProductUpdate,
        response: { 200: Product },
      },
    },
    async (req) => {
      const existing = await prisma.product.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!existing) throw server.httpErrors.notFound('Product not found');

      const b = req.body;
      const updated = await prisma.product.update({
        where: { id: existing.id },
        data: {
          ...(b.sku !== undefined ? { sku: b.sku } : {}),
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.categoryId !== undefined ? { categoryId: b.categoryId } : {}),
          ...(b.listPriceMicros !== undefined
            ? { listPriceMicros: BigInt(b.listPriceMicros) }
            : {}),
          ...(b.currency !== undefined ? { currency: b.currency } : {}),
          ...(b.active !== undefined ? { active: b.active } : {}),
        },
        include: { category: { select: { name: true } } },
      });
      return {
        id: updated.id,
        sku: updated.sku,
        name: updated.name,
        categoryId: updated.categoryId,
        categoryName: updated.category?.name ?? null,
        listPriceMicros: updated.listPriceMicros.toString(),
        currency: updated.currency,
        active: updated.active,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ─── Delete product ───────────────────────────────────────────────────────
  server.delete(
    '/products/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.product.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!existing) throw server.httpErrors.notFound('Product not found');
      await prisma.product.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );
};
