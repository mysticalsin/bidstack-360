import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { useCreateSalesOrder } from '@/hooks/useSalesOrders';
import { useProducts } from '@/hooks/useProducts';
import { useUsers } from '@/hooks/useUsers';
import { useFormatMoney } from '@/hooks/useFormatMoney';

interface LineItemState {
  productId: string;
  quantity: string; // decimal string e.g. "1" or "2.5"
  unitPrice: string; // float string e.g. "12.50"
}

const COUNTRIES = [
  { code: 'CA', name: 'Canada' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'BR', name: 'Brazil' },
  { code: 'IN', name: 'India' },
  { code: 'AU', name: 'Australia' },
  { code: 'JP', name: 'Japan' },
  { code: 'MX', name: 'Mexico' },
];

export function NewSalesOrderPage() {
  const navigate = useNavigate();
  const create = useCreateSalesOrder();
  const { data: usersData, isLoading: isLoadingUsers } = useUsers();
  const { formatMoney } = useFormatMoney();

  // Load active products
  const { data: productsData, isLoading: isLoadingProducts } = useProducts({
    activeOnly: 'true',
    limit: 100,
  });

  const products = useMemo(() => productsData?.items ?? [], [productsData]);
  const salespeople = useMemo(() => usersData ?? [], [usersData]);

  // Form states
  const [customerName, setCustomerName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [currency, setCurrency] = useState('CAD');
  const [salespersonId, setSalespersonId] = useState('');
  const [lines, setLines] = useState<LineItemState[]>([
    { productId: '', quantity: '1', unitPrice: '0.00' },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  // Map productById for fast lookup
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const handleProductChange = (index: number, productId: string) => {
    const next = [...lines];
    const prod = productById.get(productId);
    next[index] = {
      productId,
      quantity: next[index]?.quantity ?? '1',
      unitPrice: prod ? String(Number(prod.listPriceMicros) / 1_000_000) : '0.00',
    };
    setLines(next);
  };

  const handleLineChange = (index: number, key: keyof LineItemState, value: string) => {
    const next = [...lines];
    const line = next[index];
    if (line) {
      next[index] = { ...line, [key]: value };
      setLines(next);
    }
  };

  const addLine = () => {
    setLines([...lines, { productId: '', quantity: '1', unitPrice: '0.00' }]);
  };

  const removeLine = (index: number) => {
    const next = [...lines];
    next.splice(index, 1);
    setLines(next);
  };

  // Grand total calculation
  const total = useMemo(() => {
    return lines.reduce((acc, line) => {
      const q = parseFloat(line.quantity) || 0;
      const p = parseFloat(line.unitPrice) || 0;
      return acc + q * p;
    }, 0);
  }, [lines]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!customerName.trim()) {
      setFormError('Customer name is required');
      return;
    }

    // Filter out invalid lines
    const validLines = lines.filter((l) => l.productId);
    if (validLines.length === 0) {
      setFormError('At least one valid line item is required');
      return;
    }

    // Validate quantities and prices
    for (const l of validLines) {
      const qty = parseFloat(l.quantity);
      if (isNaN(qty) || qty <= 0) {
        setFormError('Quantities must be positive numbers');
        return;
      }
      const price = parseFloat(l.unitPrice);
      if (isNaN(price) || price < 0) {
        setFormError('Prices must be non-negative numbers');
        return;
      }
    }

    try {
      const body = {
        customerName: customerName.trim(),
        countryCode: countryCode || undefined,
        currency,
        salespersonId: salespersonId || undefined,
        lines: validLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPriceMicros: String(Math.round(parseFloat(l.unitPrice) * 1_000_000)),
        })),
      };

      const result = await create.mutateAsync(body);
      toast.success(`Quotation ${result.number} created successfully`);
      navigate(`/sales/orders/${result.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'The server rejected the request.';
      setFormError(msg);
      toast.error('Could not create quotation', { description: msg });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
          <li>
            <Link to="/sales" className="hover:text-[var(--fg-primary)]">
              Sales
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link to="/sales/orders" className="hover:text-[var(--fg-primary)]">
              Quotations & Orders
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-[var(--fg-primary)]">
            New Quotation
          </li>
        </ol>
      </nav>

      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          New Quotation
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Draft a new pre-sales quote and configure line items.
        </p>
      </header>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-1">
                Customer Name
              </label>
              <input
                type="text"
                className="input w-full"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Client / Company name"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-1">
                Country
              </label>
              <select
                className="input w-full"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
              >
                <option value="">Select country...</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-1">
                Currency
              </label>
              <select
                className="input w-full"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-1">
                Salesperson
              </label>
              <select
                className="input w-full"
                value={salespersonId}
                onChange={(e) => setSalespersonId(e.target.value)}
                disabled={isLoadingUsers}
              >
                <option value="">Select salesperson...</option>
                {salespeople.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-[var(--fg-primary)] uppercase tracking-wider">
                Line Items
              </h2>
              <button
                type="button"
                className="btn btn-secondary text-xs flex items-center gap-1.5"
                onClick={addLine}
                disabled={isLoadingProducts}
              >
                <Icon name="plus" size={14} />
                Add Item
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--fg-tertiary)] border-b border-[var(--border-subtle)]">
                    <th scope="col" className="pb-2 font-medium w-1/2">
                      Product
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium w-20">
                      Quantity
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium w-32">
                      Unit Price
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium w-32">
                      Subtotal
                    </th>
                    <th scope="col" className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {lines.map((line, idx) => {
                    const sub =
                      (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0);
                    return (
                      <tr key={idx} className="align-middle">
                        <td className="py-3 pr-4">
                          <select
                            className="input w-full"
                            value={line.productId}
                            onChange={(e) => handleProductChange(idx, e.target.value)}
                            required
                          >
                            <option value="">Select product...</option>
                            {products
                              .filter((p) => p.currency === currency)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} · {p.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="py-3 pr-2">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            className="input w-full text-right font-mono"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                            required
                          />
                        </td>
                        <td className="py-3 pr-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input w-full text-right font-mono"
                            value={line.unitPrice}
                            onChange={(e) => handleLineChange(idx, 'unitPrice', e.target.value)}
                            required
                          />
                        </td>
                        <td className="py-3 text-right font-mono text-[var(--fg-secondary)] pr-4">
                          {formatMoney(sub, currency)}
                        </td>
                        <td className="py-3 text-center">
                          <button
                            type="button"
                            aria-label="Remove item"
                            disabled={lines.length === 1}
                            className="text-[var(--danger)] hover:text-red-700 disabled:opacity-30"
                            onClick={() => removeLine(idx)}
                          >
                            <Icon name="trash2" size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border-subtle)]">
                    <td
                      colSpan={3}
                      className="pt-4 text-right text-xs uppercase tracking-wider text-[var(--fg-tertiary)]"
                    >
                      Grand Total
                    </td>
                    <td className="pt-4 text-right text-lg font-bold font-mono text-[var(--fg-primary)] pr-4">
                      {formatMoney(total, currency)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {formError ? (
            <p role="alert" className="text-xs text-[var(--danger)] font-medium">
              {formError}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/sales/orders')}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create Quotation'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
