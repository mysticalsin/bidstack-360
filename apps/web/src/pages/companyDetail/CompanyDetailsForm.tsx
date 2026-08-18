/**
 * CompanyDetailsForm — the "detailed" (editable) account view. Edits all
 * CompanyPatch-backed fields (not just the old 3), client-validates url/email/
 * number before PATCH, and sends only changed keys via useUpdateCompany.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useHasAdminPermission } from '@/hooks/useCapabilities';
import { useUpdateCompany } from '@/hooks/useCompanies';
import type { CompanyDetail, CompanyPatch } from '@bidstack/shared';

const TIERS = ['key', 'top', 'standard'] as const;

export function CompanyDetailsForm({ company, onDone }: { company: CompanyDetail; onDone: () => void }) {
  const update = useUpdateCompany();
  // PATCH /companies/:id is admin-only (companies:write) — surface that up
  // front so non-admins don't fill out the whole form only to have it
  // rejected on submit.
  const canWrite = useHasAdminPermission('companies:write');
  const [form, setForm] = useState({
    name: company.name,
    legalName: company.legalName ?? '',
    domain: company.domain ?? '',
    website: company.website ?? '',
    industry: company.industry ?? '',
    employeeCount: company.employeeCount?.toString() ?? '',
    countryCode: company.countryCode ?? '',
    tier: company.tier ?? 'standard',
    taxId: company.taxId ?? '',
    billingEmail: company.billingEmail ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Company name is required';
    if (form.website && !/^https?:\/\/.+\..+/.test(form.website)) e.website = 'Enter a full URL (https://…)';
    if (form.billingEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.billingEmail)) e.billingEmail = 'Enter a valid email';
    if (form.employeeCount && !/^\d{1,6}$/.test(form.employeeCount)) e.employeeCount = 'Numbers only (0–999999)';
    if (form.countryCode && form.countryCode.length !== 2) e.countryCode = 'Use the 2-letter code';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = () => {
    if (!validate()) return;
    const c = company;
    const patch: CompanyPatch = {};
    if (form.name.trim() !== c.name) patch.name = form.name.trim();
    if (form.legalName !== (c.legalName ?? '')) patch.legalName = form.legalName || null;
    if (form.domain !== (c.domain ?? '')) patch.domain = form.domain || null;
    if (form.website !== (c.website ?? '')) patch.website = form.website || null;
    if (form.industry !== (c.industry ?? '')) patch.industry = form.industry || null;
    const ec = form.employeeCount ? Number(form.employeeCount) : null;
    if (ec !== (c.employeeCount ?? null)) patch.employeeCount = ec;
    if (form.countryCode.toUpperCase() !== (c.countryCode ?? '')) patch.countryCode = form.countryCode ? form.countryCode.toUpperCase() : null;
    if (form.tier !== (c.tier ?? 'standard')) patch.tier = form.tier;
    if (form.taxId !== (c.taxId ?? '')) patch.taxId = form.taxId || null;
    if (form.billingEmail !== (c.billingEmail ?? '')) patch.billingEmail = form.billingEmail || null;
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    update.mutate({ id: c.id, patch }, { onSuccess: onDone });
  };

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] p-4">
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">Edit account details</h2>
        <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">Only changed fields are saved.</p>
        {!canWrite && (
          <p className="mt-1 text-xs text-[var(--danger)]">
            You don&apos;t have permission to save changes to company details. Only admins can edit this form.
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <Field label="Company name" error={errors.name} required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Legal name">
          <Input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </Field>
        <Field label="Domain">
          <Input value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="acme.com" />
        </Field>
        <Field label="Website" error={errors.website}>
          <Input
            type="url"
            value={form.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://acme.com"
            aria-invalid={!!errors.website}
          />
        </Field>
        <Field label="Industry">
          <Input value={form.industry} onChange={(e) => set('industry', e.target.value)} />
        </Field>
        <Field label="Employees" error={errors.employeeCount}>
          <Input
            inputMode="numeric"
            value={form.employeeCount}
            onChange={(e) => set('employeeCount', e.target.value)}
            aria-invalid={!!errors.employeeCount}
          />
        </Field>
        <Field label="Country code" error={errors.countryCode}>
          <Input
            value={form.countryCode}
            onChange={(e) => set('countryCode', e.target.value)}
            maxLength={2}
            placeholder="FR"
            aria-invalid={!!errors.countryCode}
          />
        </Field>
        <Field label="Account tier">
          <select
            value={form.tier}
            onChange={(e) => set('tier', e.target.value)}
            className="min-h-11 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            {TIERS.map((tierOpt) => (
              <option key={tierOpt} value={tierOpt}>
                {tierOpt}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tax ID">
          <Input value={form.taxId} onChange={(e) => set('taxId', e.target.value)} />
        </Field>
        <Field label="Billing email" error={errors.billingEmail}>
          <Input
            type="email"
            value={form.billingEmail}
            onChange={(e) => set('billingEmail', e.target.value)}
            aria-invalid={!!errors.billingEmail}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={update.isPending || !canWrite}
          title={canWrite ? undefined : "You don't have permission to save changes to company details"}
          aria-label={
            canWrite
              ? undefined
              : "Save changes — You don't have permission to save changes to company details"
          }
          onClick={save}
        >
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
        {label}
        {required && <span className="text-[var(--danger)]"> *</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-[var(--danger)]">{error}</span>}
    </label>
  );
}
