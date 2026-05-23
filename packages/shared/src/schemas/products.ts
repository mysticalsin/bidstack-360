import { z } from 'zod';

export const ProductCategoryCreate = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().uuid().optional().nullable(),
});

export const ProductCategory = z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

export const ProductCreate = z.object({
  sku: z.string().min(1).max(120),
  name: z.string().min(1).max(255),
  categoryId: z.string().uuid().optional().nullable(),
  listPriceMicros: z.number().int().min(0).max(1_000_000_000_000_000),
  currency: z.string().length(3).default('CAD'),
  active: z.boolean().default(true),
});

export const ProductUpdate = z.object({
  sku: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(255).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  listPriceMicros: z.number().int().min(0).max(1_000_000_000_000_000).optional(),
  currency: z.string().length(3).optional(),
  active: z.boolean().optional(),
});

export const Product = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  listPriceMicros: z.string(),
  currency: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProductFilter = z.object({
  search: z.string().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  activeOnly: z.enum(['true', 'false']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ProductPage = z.object({
  items: z.array(Product),
  nextCursor: z.string().uuid().nullable(),
});

export type ProductCategoryCreate = z.infer<typeof ProductCategoryCreate>;
export type ProductCategory = z.infer<typeof ProductCategory>;
export type ProductCreate = z.infer<typeof ProductCreate>;
export type ProductUpdate = z.infer<typeof ProductUpdate>;
export type Product = z.infer<typeof Product>;
export type ProductFilter = z.infer<typeof ProductFilter>;
export type ProductPage = z.infer<typeof ProductPage>;
