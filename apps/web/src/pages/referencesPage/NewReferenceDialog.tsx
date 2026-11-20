// Controlled dialog + form for creating a reusable customer reference.
// Mirrors NewCompanyDialog's design-system approach (Dialog + Input + Button)
// so label/htmlFor wiring, aria-invalid linkage, dark mode, and 44px touch
// targets come for free. Wired to the existing POST /references endpoint.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export interface NewReferenceBody {
  title: string;
  description?: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
  valueMicros?: number;
  documentUrl?: string;
  tags?: string[];
}

interface Props {
  onClose: () => void;
  onCreate: (body: NewReferenceBody) => void;
  isPending: boolean;
}

export function NewReferenceDialog({ onClose, onCreate, isPending }: Props) {
  const { t } = useTranslation('crm');
  const [title, setTitle] = useState('');
  const [industry, setIndustry] = useState('');
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [value, setValue] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [tags, setTags] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(t('newReference.titleRequired', 'A reference title is required.'));
      return;
    }
    setTitleError(undefined);
    // Value is entered in major units; the API + DB store micros (×1e6).
    const major = value.trim() ? Number.parseFloat(value) : NaN;
    const valueMicros = Number.isFinite(major) ? Math.round(major * 1_000_000) : undefined;
    onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      industry: industry.trim() || undefined,
      contactName: contactName.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      valueMicros,
      documentUrl: documentUrl.trim() || undefined,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
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
        title={t('newReference.dialogTitle', 'New reference')}
        description={t(
          'newReference.dialogDescription',
          'Capture a reusable customer reference — case study, testimonial, or win story — for proposals and bids.',
        )}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            label={t('newReference.titleLabel', 'Title')}
            placeholder={t('newReference.titlePlaceholder', 'Acme Corp — 40% faster onboarding')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={titleError}
            aria-required="true"
            disabled={isPending}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="ref-desc" className="text-xs font-medium text-[var(--fg-secondary)]">
              {t('newReference.descriptionLabel', 'Description')}
            </label>
            <textarea
              id="ref-desc"
              className="input w-full min-h-[88px]"
              placeholder={t(
                'newReference.descriptionPlaceholder',
                "What was delivered, the outcome, and why it's quotable…",
              )}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('newReference.industryLabel', 'Industry')}
              placeholder={t('newReference.industryPlaceholder', 'Software')}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              disabled={isPending}
            />
            <Input
              label={t('newReference.dealValueLabel', 'Deal value')}
              type="number"
              min={0}
              placeholder={t('newReference.dealValuePlaceholder', '250000')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('newReference.contactNameLabel', 'Contact name')}
              placeholder={t('newReference.contactNamePlaceholder', 'Jane Doe')}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              disabled={isPending}
            />
            <Input
              label={t('newReference.contactEmailLabel', 'Contact email')}
              type="email"
              placeholder={t('newReference.contactEmailPlaceholder', 'jane@acme.com')}
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              disabled={isPending}
            />
          </div>
          <Input
            label={t('newReference.documentUrlLabel', 'Document URL')}
            type="url"
            placeholder="https://…"
            value={documentUrl}
            onChange={(e) => setDocumentUrl(e.target.value)}
            disabled={isPending}
          />
          <Input
            label={t('newReference.tagsLabel', 'Tags')}
            helper={t('newReference.tagsHelper', 'Comma-separated')}
            placeholder={t('newReference.tagsPlaceholder', 'case-study, enterprise, emea')}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            disabled={isPending}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={isPending}>
              {t('newReference.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t('newReference.creating', 'Creating…')
                : t('newReference.create', 'Create reference')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
