// Controlled dialog + form for creating a new CRM company record.
// Owns its own local form state; notifies parent via onCreate callback.
//
// WHY Input/Button over raw elements (P1 #21): the design-system primitives
// provide built-in label+htmlFor wiring, aria-invalid+aria-describedby for
// error linkage, loading indicators, dark mode, and 44px touch targets —
// zero extra lines vs the fieldClass approach but with all accessibility
// states included.
import { useState, type FormEvent } from 'react';

import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

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

export function NewCompanyDialog({ onClose, onCreate, isPending }: NewCompanyDialogProps) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Company name is required.');
      return;
    }
    setNameError(undefined);
    onCreate({
      name: name.trim(),
      domain: domain.trim() || null,
      industry: industry.trim() || null,
      countryCode: countryCode.trim().toUpperCase().slice(0, 2) || null,
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
          <Input
            label="Company name"
            placeholder="Acme Inc."
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            aria-required="true"
            isLoading={isPending}
            disabled={isPending}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Domain"
              placeholder="acme.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={isPending}
            />
            <Input
              label="Country code"
              placeholder="CA"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              disabled={isPending}
            />
          </div>
          <Input
            label="Industry"
            placeholder="Software"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            disabled={isPending}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create company'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
