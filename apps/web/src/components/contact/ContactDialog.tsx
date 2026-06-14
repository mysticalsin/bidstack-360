// CRM-style record dialog for creating or editing a Contact. Shows all
// fields in one form; PATCH endpoint accepts partials, so only changed
// fields hit the wire (the diff is what audit log captures).
//
// Re-seeding strategy: rather than calling setState inside an effect (which
// triggers cascading renders and trips react-hooks/set-state-in-effect),
// the form body is a separate component keyed on `contact?.id`. When the
// user edits a different contact through the same dialog instance, the key
// changes and React unmounts/remounts the form, naturally re-seeding state
// from useState initializers.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { useCreateContact, useUpdateContact } from '@/hooks/useContacts';
import type { Contact, Sentiment } from '@bidstack/shared';

interface Props {
  /** Edit mode if provided. Omitted = create mode. */
  contact?: Contact;
  /** Optional default customer when creating from an account's contacts tab. */
  defaultCustomer?: string;
  /** Optional custom trigger; defaults to a primary button. */
  trigger?: React.ReactNode;
  /** External open state (for menu-triggered edits). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const SENTIMENT_OPTIONS: ReadonlyArray<{ value: Sentiment | ''; label: string }> = [
  { value: '', label: '—' },
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'cold', label: 'Cold' },
];

export function ContactDialog({
  contact,
  defaultCustomer,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const { t } = useTranslation('crm');
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (o: boolean) => {
    if (isControlled) onOpenChange?.(o);
    else setInternalOpen(o);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <button type="button" className="btn btn-primary">
              {t('contact.newContactTrigger', '+ New contact')}
            </button>
          )}
        </DialogTrigger>
      ) : null}
      {open ? (
        <DialogContent
          title={
            contact
              ? t('contact.editTitle', 'Edit {{name}}', { name: contact.name })
              : t('contact.newTitle', 'New contact')
          }
          description={
            contact
              ? t('contact.editDescription', 'Patch updates the record and writes an audit entry.')
              : t('contact.newDescription', 'Add a person to the decision unit.')
          }
        >
          <ContactForm
            key={contact?.id ?? 'new'}
            contact={contact}
            defaultCustomer={defaultCustomer}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function ContactForm({
  contact,
  defaultCustomer,
  onDone,
}: {
  contact?: Contact;
  defaultCustomer?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation('crm');
  const create = useCreateContact();
  const update = useUpdateContact();

  const [customer, setCustomer] = useState(contact?.customer ?? defaultCustomer ?? '');
  const [name, setName] = useState(contact?.name ?? '');
  const [role, setRole] = useState(contact?.role ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [influence, setInfluence] = useState<string>(
    contact?.influence ? String(contact.influence) : '',
  );
  const [sentiment, setSentiment] = useState<Sentiment | ''>(contact?.sentiment ?? '');
  const [error, setError] = useState<string | null>(null);

  const isPending = create.isPending || update.isPending;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!customer.trim() || !name.trim()) {
      setError(t('contact.errorRequired', 'Customer and name are required'));
      return;
    }
    const influenceNum = influence ? Math.min(5, Math.max(1, Number(influence))) : null;
    const payload = {
      customer: customer.trim(),
      name: name.trim(),
      role: role.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      influence: influenceNum,
      sentiment: sentiment || null,
    };
    try {
      if (contact) {
        await update.mutateAsync({ id: contact.id, patch: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('contact.errorSaveFailed', 'Save failed'));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('contact.fieldCustomer', 'Customer / account')} htmlFor="contact-customer" required>
          <input
            id="contact-customer"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            required
            className="dialog-input"
          />
        </Field>
        <Field label={t('contact.fieldName', 'Name')} htmlFor="contact-name" required>
          <input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="dialog-input"
          />
        </Field>
      </div>

      <Field label={t('contact.fieldRole', 'Role')} htmlFor="contact-role">
        <input
          id="contact-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder={t('contact.rolePlaceholder', 'e.g. CTO, Director of Infrastructure')}
          className="dialog-input"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('contact.fieldEmail', 'Email')} htmlFor="contact-email">
          <input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="dialog-input"
          />
        </Field>
        <Field label={t('contact.fieldPhone', 'Phone')} htmlFor="contact-phone">
          <input
            id="contact-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="dialog-input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('contact.fieldInfluence', 'Influence (1–5)')} htmlFor="contact-influence">
          <input
            id="contact-influence"
            type="number"
            min={1}
            max={5}
            value={influence}
            onChange={(e) => setInfluence(e.target.value)}
            className="dialog-input"
          />
        </Field>
        <Field label={t('contact.fieldSentiment', 'Sentiment')} htmlFor="contact-sentiment">
          <select
            id="contact-sentiment"
            value={sentiment}
            onChange={(e) => setSentiment(e.target.value as Sentiment | '')}
            className="dialog-input"
          >
            {SENTIMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === ''
                  ? o.label
                  : t(`contact.sentiment.${o.value}`, o.label)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="secondary" onClick={onDone} disabled={isPending}>
          {t('contact.cancel', 'Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending
            ? t('contact.saving', 'Saving…')
            : contact
              ? t('contact.saveChanges', 'Save changes')
              : t('contact.createContact', 'Create contact')}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </span>
      {children}
    </label>
  );
}
