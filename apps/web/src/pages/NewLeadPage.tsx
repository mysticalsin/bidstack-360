import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useCreateLead } from '@/hooks/useLeads';
import type { LeadCreate } from '@bidstack/shared';

export function NewLeadPage() {
  const { t } = useTranslation('crm');
  const nav = useNavigate();
  const create = useCreateLead();
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ firstName?: boolean; lastName?: boolean }>({});
  const [form, setForm] = useState<LeadCreate>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    companyName: '',
    title: '',
    source: 'website',
    priority: 'medium',
    score: 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = { firstName: !form.firstName.trim(), lastName: !form.lastName.trim() };
    if (next.firstName || next.lastName) {
      setErrors(next);
      // Move focus to the first invalid field so a keyboard/SR user lands on
      // the problem, not just hears a transient toast.
      (next.firstName ? firstNameRef : lastNameRef).current?.focus();
      toast.error(t('newLead.toastNameRequired', 'First and last name are required'));
      return;
    }
    setErrors({});
    // Omit empty optional strings — the server schema rejects "" for fields like
    // email (.email()), so blank optionals must be undefined, not "".
    const opt = (v: string | undefined): string | undefined => {
      const trimmed = v?.trim();
      return trimmed ? trimmed : undefined;
    };
    const payload: LeadCreate = {
      ...form,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: opt(form.email),
      phone: opt(form.phone),
      // companyName is required (schema min(1)) — keep it a string, just trimmed.
      companyName: form.companyName.trim(),
      title: opt(form.title),
    };
    create.mutate(payload, {
      onError: () => toast.error(t('newLead.toastCreateFailed', 'Failed to create lead')),
    });
  };

  const field =
    (key: keyof LeadCreate) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((s) => ({ ...s, [key]: e.target.value }));
    };

  return (
    <div className="mx-auto max-w-2xl">
      <nav aria-label={t('newLead.breadcrumbLabel', 'Breadcrumb')} className="mb-4">
        <ol className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
          <li>
            <Link to="/leads" className="hover:text-[var(--fg-primary)]">
              {t('newLead.breadcrumbLeads', 'Leads')}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-[var(--fg-primary)]">
            {t('newLead.breadcrumbCurrent', 'New lead')}
          </li>
        </ol>
      </nav>

      <Card>
        <form onSubmit={handleSubmit} className="p-6">
          <h1 className="text-xl font-semibold text-[var(--fg-primary)]">
            {t('newLead.heading', 'New lead')}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t('newLead.subtitle', 'Add a new prospect to your pipeline.')}
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="lead-first-name"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelFirstName', 'First name')}{' '}
                <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                id="lead-first-name"
                ref={firstNameRef}
                required
                aria-invalid={errors.firstName || undefined}
                value={form.firstName}
                onChange={(e) => {
                  field('firstName')(e);
                  if (errors.firstName) setErrors((s) => ({ ...s, firstName: false }));
                }}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20 aria-[invalid=true]:border-[var(--danger)] aria-[invalid=true]:ring-[var(--danger)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-last-name"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelLastName', 'Last name')}{' '}
                <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                id="lead-last-name"
                ref={lastNameRef}
                required
                aria-invalid={errors.lastName || undefined}
                value={form.lastName}
                onChange={(e) => {
                  field('lastName')(e);
                  if (errors.lastName) setErrors((s) => ({ ...s, lastName: false }));
                }}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20 aria-[invalid=true]:border-[var(--danger)] aria-[invalid=true]:ring-[var(--danger)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-email"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelEmail', 'Email')}
              </label>
              <input
                id="lead-email"
                type="email"
                value={form.email}
                onChange={field('email')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-phone"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelPhone', 'Phone')}
              </label>
              <input
                id="lead-phone"
                type="tel"
                value={form.phone}
                onChange={field('phone')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-company"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelCompany', 'Company')}
              </label>
              <input
                id="lead-company"
                value={form.companyName}
                onChange={field('companyName')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-title"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelTitle', 'Title')}
              </label>
              <input
                id="lead-title"
                value={form.title}
                onChange={field('title')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-source"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelSource', 'Source')}
              </label>
              <select
                id="lead-source"
                value={form.source}
                onChange={field('source')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
              >
                <option value="website">{t('newLead.sourceWebsite', 'Website')}</option>
                <option value="referral">{t('newLead.sourceReferral', 'Referral')}</option>
                <option value="event">{t('newLead.sourceEvent', 'Event')}</option>
                <option value="cold_outreach">
                  {t('newLead.sourceColdOutreach', 'Cold outreach')}
                </option>
                <option value="partner">{t('newLead.sourcePartner', 'Partner')}</option>
                <option value="social">{t('newLead.sourceSocial', 'Social')}</option>
                <option value="other">{t('newLead.sourceOther', 'Other')}</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="lead-priority"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelPriority', 'Priority')}
              </label>
              <select
                id="lead-priority"
                value={form.priority}
                onChange={field('priority')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
              >
                <option value="low">{t('newLead.priorityLow', 'Low')}</option>
                <option value="medium">{t('newLead.priorityMedium', 'Medium')}</option>
                <option value="high">{t('newLead.priorityHigh', 'High')}</option>
                <option value="critical">{t('newLead.priorityCritical', 'Critical')}</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="lead-score"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('newLead.labelScore', 'Score')}
              </label>
              <input
                id="lead-score"
                type="number"
                min={0}
                max={100}
                value={form.score}
                onChange={(e) => setForm((s) => ({ ...s, score: Number(e.target.value) }))}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending
                ? t('newLead.submitPending', 'Creating…')
                : t('newLead.submit', 'Create lead')}
            </Button>
            <Button variant="ghost" onClick={() => nav('/leads')}>
              {t('newLead.cancel', 'Cancel')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
