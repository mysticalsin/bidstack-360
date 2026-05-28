import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useCreateLead } from '@/hooks/useLeads';
import type { LeadCreate } from '@bidstack/shared';

export function NewLeadPage() {
  const nav = useNavigate();
  const create = useCreateLead();
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
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First and last name are required');
      return;
    }
    create.mutate(form, {
      onError: () => toast.error('Failed to create lead'),
    });
  };

  const field =
    (key: keyof LeadCreate) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((s) => ({ ...s, [key]: e.target.value }));
    };

  return (
    <div className="mx-auto max-w-2xl">
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
          <li>
            <Link to="/leads" className="hover:text-[var(--fg-primary)]">
              Leads
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-[var(--fg-primary)]">
            New lead
          </li>
        </ol>
      </nav>

      <Card>
        <form onSubmit={handleSubmit} className="p-6">
          <h1 className="text-xl font-semibold text-[var(--fg-primary)]">New lead</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Add a new prospect to your pipeline.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="lead-first-name"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                First name <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                id="lead-first-name"
                required
                value={form.firstName}
                onChange={field('firstName')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-last-name"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Last name <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                id="lead-last-name"
                required
                value={form.lastName}
                onChange={field('lastName')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="lead-email"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Email
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
                Phone
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
                Company
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
                Title
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
                Source
              </label>
              <select
                id="lead-source"
                value={form.source}
                onChange={field('source')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
              >
                <option value="website">Website</option>
                <option value="referral">Referral</option>
                <option value="event">Event</option>
                <option value="cold_outreach">Cold outreach</option>
                <option value="partner">Partner</option>
                <option value="social">Social</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="lead-priority"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Priority
              </label>
              <select
                id="lead-priority"
                value={form.priority}
                onChange={field('priority')}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="lead-score"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                Score
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
              {create.isPending ? 'Creating…' : 'Create lead'}
            </Button>
            <Button variant="ghost" onClick={() => nav('/leads')}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
