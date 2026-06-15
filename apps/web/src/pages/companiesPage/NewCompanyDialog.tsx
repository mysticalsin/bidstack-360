// Controlled dialog + form for creating a new CRM company record.
// Owns its own local form state; notifies parent via onCreate callback.
//
// WHY Input/Button over raw elements (P1 #21): the design-system primitives
// provide built-in label+htmlFor wiring, aria-invalid+aria-describedby for
// error linkage, loading indicators, dark mode, and 44px touch targets —
// zero extra lines vs the fieldClass approach but with all accessibility
// states included.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('crm');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t('newCompany.nameRequiredError', 'Company name is required.'));
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
        title={t('newCompany.title', 'New company')}
        description={t(
          'newCompany.description',
          'Create the account profile first. You can enrich firmographics and contacts after the record exists.',
        )}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            label={t('newCompany.nameLabel', 'Company name')}
            placeholder={t('newCompany.namePlaceholder', 'Acme Inc.')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            aria-required="true"
            isLoading={isPending}
            disabled={isPending}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('newCompany.domainLabel', 'Domain')}
              placeholder={t('newCompany.domainPlaceholder', 'acme.com')}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={isPending}
            />
            <Input
              label={t('newCompany.countryCodeLabel', 'Country code')}
              placeholder={t('newCompany.countryCodePlaceholder', 'CA')}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              disabled={isPending}
            />
          </div>
          <Input
            label={t('newCompany.industryLabel', 'Industry')}
            placeholder={t('newCompany.industryPlaceholder', 'Software')}
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            disabled={isPending}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={isPending}>
              {t('newCompany.cancelButton', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t('newCompany.creatingButton', 'Creating…')
                : t('newCompany.createButton', 'Create company')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
