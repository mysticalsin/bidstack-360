import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
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
        where: { orgId: req.auth.orgId, deletedAt: null },
        orderBy: { name: 'asc' },
        take: 500,
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
      preHandler: server.requirePermission('products:write'),
      schema: {
        body: ProductCategoryCreate,
        response: { 201: ProductCategory },
      },
    },
    async (req, reply) => {
      if (req.body.parentId) {
        await assertCategoryInOrg(req.body.parentId, req.auth.orgId, server);
      }
      const name = req.body.name.trim();
      let created;
      try {
        created = await prisma.$transaction(async (tx) => {
          const row = await tx.productCategory.create({
            data: {
              orgId: req.auth.orgId,
              name,
              parentId: req.body.parentId ?? null,
            },
          });
          await tx.auditLog.create({
            data: {
              orgId: req.auth.orgId,
              userId: req.auth.userId,
              action: 'product_category.create',
              targetType: 'product_category',
              targetId: row.id,
              diff: { name, parentId: row.parentId },
            },
          });
          return row;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw server.httpErrors.conflict('Product category name already exists');
        }
        throw err;
      }
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
        deletedAt: null,
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
          imageUrl: p.imageUrl,
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
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
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
        imageUrl: p.imageUrl,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    },
  );

  // ─── Create product ───────────────────────────────────────────────────────
  server.post(
    '/products',
    {
      preHandler: server.requirePermission('products:write'),
      schema: {
        body: ProductCreate,
        response: { 201: Product },
      },
    },
    async (req, reply) => {
      const body = req.body;
      if (body.categoryId) {
        await assertCategoryInOrg(body.categoryId, req.auth.orgId, server);
      }
      let created;
      try {
        created = await prisma.$transaction(async (tx) => {
          const row = await tx.product.create({
            data: {
              orgId: req.auth.orgId,
              sku: normalizeSku(body.sku),
              name: body.name.trim(),
              categoryId: body.categoryId ?? null,
              listPriceMicros: BigInt(body.listPriceMicros),
              currency: normalizeCurrency(body.currency),
              active: body.active,
              imageUrl: body.imageUrl ?? null,
            },
            include: { category: { select: { name: true } } },
          });
          await tx.auditLog.create({
            data: {
              orgId: req.auth.orgId,
              userId: req.auth.userId,
              action: 'product.create',
              targetType: 'product',
              targetId: row.id,
              diff: {
                sku: row.sku,
                name: row.name,
                categoryId: row.categoryId,
                listPriceMicros: row.listPriceMicros.toString(),
                currency: row.currency,
                active: row.active,
                imageUrl: row.imageUrl,
              },
            },
          });
          return row;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw server.httpErrors.conflict('Product SKU already exists');
        }
        throw err;
      }
      return reply.code(201).send({
        id: created.id,
        sku: created.sku,
        name: created.name,
        categoryId: created.categoryId,
        categoryName: created.category?.name ?? null,
        listPriceMicros: created.listPriceMicros.toString(),
        currency: created.currency,
        active: created.active,
        imageUrl: created.imageUrl,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // ─── Update product ───────────────────────────────────────────────────────
  server.patch(
    '/products/:id',
    {
      preHandler: server.requirePermission('products:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ProductUpdate,
        response: { 200: Product },
      },
    },
    async (req) => {
      const existing = await prisma.product.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Product not found');

      const b = req.body;
      if (b.categoryId) {
        await assertCategoryInOrg(b.categoryId, req.auth.orgId, server);
      }
      const data = {
        ...(b.sku !== undefined ? { sku: normalizeSku(b.sku) } : {}),
        ...(b.name !== undefined ? { name: b.name.trim() } : {}),
        ...(b.categoryId !== undefined ? { categoryId: b.categoryId } : {}),
        ...(b.listPriceMicros !== undefined ? { listPriceMicros: BigInt(b.listPriceMicros) } : {}),
        ...(b.currency !== undefined ? { currency: normalizeCurrency(b.currency) } : {}),
        ...(b.active !== undefined ? { active: b.active } : {}),
        ...(b.imageUrl !== undefined ? { imageUrl: b.imageUrl } : {}),
      };
      let updated;
      try {
        updated = await prisma.$transaction(async (tx) => {
          const row = await tx.product.update({
            where: { id: existing.id },
            data,
            include: { category: { select: { name: true } } },
          });
          await tx.auditLog.create({
            data: {
              orgId: req.auth.orgId,
              userId: req.auth.userId,
              action: 'product.update',
              targetType: 'product',
              targetId: existing.id,
              diff: {
                before: {
                  sku: existing.sku,
                  name: existing.name,
                  categoryId: existing.categoryId,
                  listPriceMicros: existing.listPriceMicros.toString(),
                  currency: existing.currency,
                  active: existing.active,
                  imageUrl: existing.imageUrl,
                },
                after: {
                  sku: row.sku,
                  name: row.name,
                  categoryId: row.categoryId,
                  listPriceMicros: row.listPriceMicros.toString(),
                  currency: row.currency,
                  active: row.active,
                  imageUrl: row.imageUrl,
                },
              },
            },
          });
          return row;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw server.httpErrors.conflict('Product SKU already exists');
        }
        throw err;
      }
      return {
        id: updated.id,
        sku: updated.sku,
        name: updated.name,
        categoryId: updated.categoryId,
        categoryName: updated.category?.name ?? null,
        listPriceMicros: updated.listPriceMicros.toString(),
        currency: updated.currency,
        active: updated.active,
        imageUrl: updated.imageUrl,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ─── Delete product ───────────────────────────────────────────────────────
  server.delete(
    '/products/:id',
    {
      preHandler: server.requirePermission('products:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.product.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Product not found');
      await prisma.$transaction([
        prisma.product.update({ where: { id: existing.id }, data: { deletedAt: new Date() } }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'product.delete',
            targetType: 'product',
            targetId: existing.id,
            diff: { sku: existing.sku, name: existing.name },
          },
        }),
      ]);
      return reply.code(204).send();
    },
  );
};

async function assertCategoryInOrg(
  categoryId: string,
  orgId: string,
  server: FastifyInstance,
): Promise<void> {
  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!category) {
    throw server.httpErrors.badRequest('Product category does not belong to this org');
  }
}

function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
