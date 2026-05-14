import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { Badge } from '@/components/ui/Badge';
import { formatMoneyMicros } from '@/lib/format';
import {
  useProducts,
  useProductCategories,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from '@/hooks/useProducts';

import type { Product } from '@bidstack/shared';

export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);

  const filter = useMemo(() => {
    const search = params.get('search') ?? undefined;
    const categoryId = params.get('categoryId') ?? undefined;
    const activeOnly = (params.get('activeOnly') as 'true' | 'false' | undefined) ?? undefined;
    return { search, categoryId, activeOnly, limit: 50 };
  }, [params]);

  const products = useProducts(filter);
  const categories = useProductCategories();
  const createProduct = useCreateProduct();
  const deleteProduct = useDeleteProduct();

  const setQuery = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Manage your catalog, SKUs, categories, and list prices.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} />
          New product
        </Button>
      </header>

      <Card>
        <div className="card-body flex flex-wrap gap-3">
          <label className="account-filter" aria-label="Search products">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Search by name or SKU…"
              value={filter.search ?? ''}
              onChange={(e) => setQuery('search', e.target.value || null)}
            />
          </label>
          <label className="account-filter" aria-label="Category">
            <Icon name="briefcase" size={14} />
            <select
              value={filter.categoryId ?? ''}
              onChange={(e) => setQuery('categoryId', e.target.value || null)}
            >
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="account-filter" aria-label="Status">
            <Icon name="reports" size={14} />
            <select
              value={filter.activeOnly ?? ''}
              onChange={(e) => setQuery('activeOnly', e.target.value || null)}
            >
              <option value="">All statuses</option>
              <option value="true">Active only</option>
              <option value="false">Inactive only</option>
            </select>
          </label>
        </div>
      </Card>

      {showNew && (
        <NewProductDialog
          categories={categories.data ?? []}
          onClose={() => setShowNew(false)}
          onCreate={async (body) => {
            await createProduct.mutateAsync(body);
            setShowNew(false);
          }}
          isPending={createProduct.isPending}
        />
      )}

      {products.isLoading ? (
        <LoadingSkeleton rows={8} />
      ) : !products.data || products.data.items.length === 0 ? (
        <EmptyState title="No products found" />
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--fg-tertiary)]">
                  <th scope="col" className="px-4 py-3 font-medium">
                    SKU
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    List price
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.map((p) => (
                  <ProductRow key={p.id} product={p} onDelete={(id) => deleteProduct.mutate(id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductRow({ product, onDelete }: { product: Product; onDelete: (id: string) => void }) {
  const update = useUpdateProduct(product.id);

  return (
    <tr className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] transition-colors">
      <td className="px-4 py-3 font-medium text-[var(--fg-primary)]">{product.sku}</td>
      <td className="px-4 py-3 text-[var(--fg-primary)]">{product.name}</td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{product.categoryName ?? '—'}</td>
      <td className="px-4 py-3 font-medium text-[var(--fg-primary)]">
        {formatMoneyMicros(product.listPriceMicros, product.currency)}
      </td>
      <td className="px-4 py-3">
        <Badge tone={product.active ? 'jade' : 'gray'}>
          {product.active ? 'Active' : 'Inactive'}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update.mutate({ active: !product.active })}
          >
            {product.active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm(`Delete product "${product.name}"?`)) onDelete(product.id);
            }}
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

function NewProductDialog({
  categories,
  onClose,
  onCreate,
  isPending,
}: {
  categories: { id: string; name: string }[];
  onClose: () => void;
  onCreate: (body: {
    sku: string;
    name: string;
    categoryId?: string | null;
    listPriceMicros: number;
    currency: string;
    active: boolean;
  }) => void;
  isPending: boolean;
}) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('CAD');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const listPriceMicros = Math.round(parseFloat(price) * 1_000_000);
    if (!sku || !name || !price || isNaN(listPriceMicros)) return;
    onCreate({
      sku,
      name,
      categoryId: categoryId || null,
      listPriceMicros,
      currency,
      active: true,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">New product</h2>
          <button
            type="button"
            className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                SKU
              </label>
              <input
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="PROD-001"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                Currency
              </label>
              <select
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
              Name
            </label>
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Product name"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                Category
              </label>
              <select
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                List price
              </label>
              <input
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
