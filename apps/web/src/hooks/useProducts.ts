import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  Product,
  ProductCategory,
  ProductCategoryCreate,
  ProductCreate,
  ProductFilter,
  ProductPage,
  ProductUpdate,
} from '@bidstack/shared';

export function useProductCategories() {
  return useQuery({
    queryKey: ['product-categories'],
    queryFn: ({ signal }) => api<ProductCategory[]>('/api/products/categories', { signal }),
  });
}

export function useCreateProductCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductCategoryCreate) =>
      api<ProductCategory>('/api/products/categories', {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  });
}

export function useProducts(filter: ProductFilter) {
  const qs = new URLSearchParams();
  if (filter.search) qs.set('search', filter.search);
  if (filter.categoryId) qs.set('categoryId', filter.categoryId);
  if (filter.activeOnly) qs.set('activeOnly', filter.activeOnly);
  if (filter.cursor) qs.set('cursor', filter.cursor);
  qs.set('limit', String(filter.limit ?? 50));
  return useQuery({
    queryKey: ['products', filter],
    queryFn: ({ signal }) => api<ProductPage>(`/api/products?${qs}`, { signal }),
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: ({ signal }) => api<Product>(`/api/products/${id}`, { signal }),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductCreate) =>
      api<Product>('/api/products', {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductUpdate) =>
      api<Product>(`/api/products/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', id] });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
