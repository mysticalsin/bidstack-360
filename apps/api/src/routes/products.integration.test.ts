// Integration tests for /api/products/* and /api/products/categories.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) {
    for (const id of createdProductIds) {
      try {
        await prisma.product.deleteMany({ where: { id } });
      } catch {
        /* ignore */
      }
    }
    for (const id of createdCategoryIds) {
      try {
        await prisma.productCategory.deleteMany({ where: { id } });
      } catch {
        /* ignore */
      }
    }
    await prisma.$disconnect();
  }
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable) {
      console.warn(`[skip] ${name} — DATABASE_URL not reachable`);
      return;
    }
    await fn();
  });

describe('products routes', () => {
  skipIfNoDb('GET /api/products/categories returns list', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/products/categories' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(body[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
      });
    }
  });

  skipIfNoDb('POST /api/products/categories creates a category', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/products/categories',
      payload: { name: 'Audit Test Category' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Audit Test Category');
    createdCategoryIds.push(body.id);
  });

  skipIfNoDb('GET /api/products returns seeded products', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/products?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    if (body.items.length > 0) {
      expect(body.items[0]).toMatchObject({
        id: expect.any(String),
        sku: expect.any(String),
        name: expect.any(String),
        listPriceMicros: expect.any(String),
        currency: expect.any(String),
        active: expect.any(Boolean),
      });
    }
  });

  skipIfNoDb('GET /api/products supports search', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/products?search=Jamf&limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    // May be empty if no Jamf products in seed; just verify shape
  });

  skipIfNoDb('GET /api/products/:id returns detail', async () => {
    const list = (await server.inject({ method: 'GET', url: '/api/products?limit=1' })).json();
    if (list.items.length === 0) {
      console.warn('[skip] no products to get');
      return;
    }
    const id = list.items[0].id;
    const res = await server.inject({ method: 'GET', url: `/api/products/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.sku).toBeDefined();
  });

  skipIfNoDb('POST /api/products creates a product', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'AUDIT-001',
        name: 'Audit Test Product',
        listPriceMicros: 99_000_000,
        currency: 'CAD',
        active: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.sku).toBe('AUDIT-001');
    expect(body.listPriceMicros).toBe('99000000');
    createdProductIds.push(body.id);
  });

  skipIfNoDb('PATCH /api/products/:id updates fields', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'AUDIT-002',
        name: 'Patch Me',
        listPriceMicros: 10_000_000,
        currency: 'USD',
        active: true,
      },
    });
    const id = createRes.json().id;
    createdProductIds.push(id);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/products/${id}`,
      payload: { name: 'Patched Name', active: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ id, name: 'Patched Name', active: false });
  });

  skipIfNoDb('DELETE /api/products/:id soft-deletes', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'AUDIT-003',
        name: 'Delete Me',
        listPriceMicros: 5_000_000,
        currency: 'CAD',
        active: true,
      },
    });
    const id = createRes.json().id;
    createdProductIds.push(id);

    const del = await server.inject({ method: 'DELETE', url: `/api/products/${id}` });
    expect(del.statusCode).toBe(204);

    const get = await server.inject({ method: 'GET', url: `/api/products/${id}` });
    expect(get.statusCode).toBe(404);
  });

  skipIfNoDb('PATCH /api/products/:id returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/products/11111111-2222-3333-4444-555555555555',
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(404);
  });
});
