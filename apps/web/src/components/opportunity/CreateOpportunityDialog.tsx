import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { LookupFieldPicker, type LookupOption } from '@/components/ui/LookupFieldPicker';
import { Select } from '@/components/ui/Select';
import { useCreateOpportunity } from '@/hooks/useOpportunities';
import { api } from '@/lib/api';
import {
  INDUSTRIES,
  type OpportunityCreate,
  OpportunityCreate as OpportunityCreateSchema,
  OpportunityStage,
} from '@bidstack/shared';

const STAGES = OpportunityStage.options;

type FieldErrors = Partial<Record<keyof OpportunityCreate, string[]>>;

interface Props {
  /** Optional override for the trigger button (defaults to "+ New opportunity"). */
  trigger?: React.ReactNode;
  /** Default customer to pre-fill (e.g. when launched from an account page). */
  defaultCustomer?: string;
  /**
   * Controlled open state. When provided, the caller owns open/close.
   * Used by the quick-add menu (same Twenty pattern A3 as CreateTaskDialog).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateOpportunityDialog({
  trigger,
  defaultCustomer,
  open: controlledOpen,
  onOpenChange,
}: Props = {}) {
  const { t } = useTranslation('crm');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Force form remount on every open so uncontrolled inputs clear stale DOM values.
  const [formKey, setFormKey] = useState(0);

  // Company lookup (Twenty pattern A4 — LookupFieldPicker).
  // We track the selected company separately so we can pass its name as the
  // `customer` field value while also storing the UUID for the API.
  const [selectedCompany, setSelectedCompany] = useState<LookupOption | null>(
    defaultCustomer ? { id: '', label: defaultCustomer } : null,
  );

  // Search companies by name via the existing /api/companies endpoint.
  const searchCompanies = useCallback(async (q: string): Promise<LookupOption[]> => {
    const data = await api<{ items: { id: string; name: string; domain?: string }[] }>(
      `/api/companies?search=${encodeURIComponent(q)}&limit=8`,
    );
    return (data.items ?? []).map((c) => ({
      id: c.id,
      label: c.name,
      hint: c.domain,
    }));
  }, []);

  // Recent company options — empty for now; could be wired to accountHistory.
  const recentCompanies = useMemo<LookupOption[]>(() => [], []);

  // P2 #31: create mutation lives in useCreateOpportunity (shared hook).
  // Cache invalidation happens there; dialog-local state resets are passed as
  // per-call callbacks in create.mutate(data, { onSuccess, onError }).
  const create = useCreateOpportunity();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const fd = new FormData(e.currentTarget);
    // A4: customer name comes from the LookupFieldPicker selection; fall back to
    // the hidden input value so FormData serialisation also works.
    const candidate = {
      customer: (selectedCompany?.label ?? String(fd.get('customer') ?? '')).trim(),
      name: String(fd.get('name') ?? '').trim(),
      stage: fd.get('stage'),
      value: Number(fd.get('value') ?? 0),
      probability: Number(fd.get('probability') ?? 0),
      dueDate: (fd.get('dueDate') as string) || null,
      owner: null,
      industry: (fd.get('industry') as string) || null,
      logo: null,
      country: (fd.get('country') as string)?.toUpperCase() || null,
    };

    // Client-side validation against the canonical Zod schema. The server
    // also re-validates — this is for fast inline feedback, not security.
    const parsed = OpportunityCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: () => {
        setOpen(false);
        setError(null);
        setFieldErrors({});
        setSelectedCompany(defaultCustomer ? { id: '', label: defaultCustomer } : null);
      },
      onError: (err: Error) => setError(err.message),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Increment key so the form remounts with fresh uncontrolled inputs.
          setFormKey((k) => k + 1);
        }
        // Reset picker when dialog closes without submitting.
        if (!next) {
          setSelectedCompany(defaultCustomer ? { id: '', label: defaultCustomer } : null);
          setError(null);
          setFieldErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">{t('createOpportunity.triggerButton', '+ New opportunity')}</Button>}
      </DialogTrigger>
      <DialogContent
        title={t('createOpportunity.dialogTitle', 'New opportunity')}
        description={t(
          'createOpportunity.dialogDescription',
          'Add a bid to your pipeline. You can refine intel after Dust data verification runs.',
        )}
      >
        <form key={formKey} onSubmit={submit} className="space-y-4">
          {/* A4 — LookupFieldPicker replaces plain text input for company relation field.
              Hidden input carries the selected label for FormData fallback. */}
          <Field
            label={t('createOpportunity.customerLabel', 'Customer')}
            htmlFor="customer-picker"
            error={fieldErrors.customer?.[0]}
          >
            <LookupFieldPicker
              value={selectedCompany}
              onChange={setSelectedCompany}
              onSearch={searchCompanies}
              recentOptions={recentCompanies}
              placeholder={t('createOpportunity.customerPlaceholder', 'Search companies…')}
              label={t('createOpportunity.customerLabel', 'Customer')}
            />
            {/* Hidden input feeds the customer name into FormData for the submit handler's fallback path */}
            <input
              type="hidden"
              name="customer"
              value={selectedCompany?.label ?? ''}
              aria-hidden="true"
            />
          </Field>
          <Field
            label={t('createOpportunity.nameLabel', 'Opportunity name')}
            htmlFor="name"
            error={fieldErrors.name?.[0]}
          >
            <Input
              id="name"
              name="name"
              required
              placeholder={t('createOpportunity.namePlaceholder', 'Acme — IT Modernization')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('createOpportunity.stageLabel', 'Stage')}
              htmlFor="stage"
              error={fieldErrors.stage?.[0]}
            >
              <Select id="stage" name="stage" defaultValue="s1_ongoing">
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('createOpportunity.industryLabel', 'Industry')}
              htmlFor="industry"
              error={fieldErrors.industry?.[0]}
            >
              <Select id="industry" name="industry" defaultValue="">
                <option value="">—</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field
              label={t('createOpportunity.valueLabel', 'Value (EUR)')}
              htmlFor="value"
              error={fieldErrors.value?.[0]}
            >
              <Input id="value" name="value" type="number" min={0} step="100" defaultValue="0" />
            </Field>
            <Field
              label={t('createOpportunity.probabilityLabel', 'Probability %')}
              htmlFor="probability"
              error={fieldErrors.probability?.[0]}
            >
              <Input
                id="probability"
                name="probability"
                type="number"
                min={0}
                max={100}
                step="5"
                defaultValue="20"
              />
            </Field>
            <Field
              label={t('createOpportunity.dueDateLabel', 'Due date')}
              htmlFor="dueDate"
              error={fieldErrors.dueDate?.[0]}
            >
              <Input id="dueDate" name="dueDate" type="date" />
            </Field>
            <Field
              label={t('createOpportunity.countryLabel', 'Country')}
              htmlFor="country"
              error={fieldErrors.country?.[0]}
            >
              <Input id="country" name="country" maxLength={2} placeholder="DE" />
            </Field>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="md">
                {t('createOpportunity.cancel', 'Cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending
                ? t('createOpportunity.submitting', 'Creating…')
                : t('createOpportunity.submit', 'Create opportunity')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
  error,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  error?: string;
}) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </span>
      {children}
      {error ? (
        <span
          id={errorId}
          role="alert"
          className="mt-1 block text-[10px] font-medium text-[var(--danger)]"
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 text-sm text-[var(--fg-primary)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-focus)] transition-colors"
    />
  );
}
