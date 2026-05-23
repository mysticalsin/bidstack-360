import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useCreateInvoice } from '@/hooks/useInvoices';

export function NewInvoicePage() {
  const navigate = useNavigate();
  const create = useCreateInvoice();
  const [customerName, setCustomerName] = useState('');
  const [currency, setCurrency] = useState('CAD');
  const [dueDate, setDueDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!customerName || !dueDate) return;
    try {
      const invoice = await create.mutateAsync({
        customerName,
        currency,
        netDays: Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        lines: [],
      });
      navigate(`/sales/invoices/${invoice.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Create failed');
      toast.error('Could not create invoice', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">New Invoice</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Create a draft invoice and add line items on the next screen.
        </p>
      </header>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
              Customer name
            </label>
            <input
              className="input w-full"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Acme Inc."
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
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
              <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
                Due date
              </label>
              <input
                className="input w-full"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          </div>
          {formError ? (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {formError}
            </p>
          ) : null}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/sales/invoices')}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
