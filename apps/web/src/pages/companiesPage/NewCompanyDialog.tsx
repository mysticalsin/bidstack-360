// Controlled dialog + form for creating a new CRM company record.
// Owns its own local form state; notifies parent via onCreate callback.
import { useState, type FormEvent } from 'react';

import { Dialog, DialogContent } from '@/components/ui/Dialog';

interface NewCompanyBody {
  name: string;
  domain?: string | null;
  industry?: string | null;
  countryCode?: string | null;
}

interface NewCompanyDialogProps {
  onClose: () => void;
  onCreate: (body: NewCompanyBody) => void;
  isPending: boolean;
}

const fieldClass =
  'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';

export function NewCompanyDialog({ onClose, onCreate, isPending }: NewCompanyDialogProps) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [countryCode, setCountryCode] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name) return;
    onCreate({
      name,
      domain: domain || null,
      industry: industry || null,
      countryCode: countryCode || null,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="New company"
        description="Create the account profile first. You can enrich firmographics and contacts after the record exists."
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="new-company-name"
              className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Company name
            </label>
            <input
              id="new-company-name"
              className="input w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              required
              aria-required="true"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="new-company-domain"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Domain
              </label>
              <input
                id="new-company-domain"
                className={fieldClass}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
              />
            </div>
            <div>
              <label
                htmlFor="new-company-country"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Country
              </label>
              <input
                id="new-company-country"
                className={fieldClass}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.slice(0, 2).toUpperCase())}
                placeholder="CA"
                maxLength={2}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="new-company-industry"
              className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Industry
            </label>
            <input
              id="new-company-industry"
              className={fieldClass}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Software"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              className="btn btn-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              disabled={isPending}
            >
              {isPending ? 'Creating…' : 'Create company'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
