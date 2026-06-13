/**
 * Contractual management for the open account — MSAs / framework agreements,
 * the countries each covers, global rebate terms, and the rate re-evaluation
 * schedule. Pre-sales-owned, internal data. Demo feedback (Marc + Marie-Benoît).
 */
import { useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import {
  useContractAgreements,
  useCreateContractAgreement,
} from '@/hooks/useContractAgreements';
import type { ContractAgreement, ContractKind, ContractStatus } from '@bidstack/shared';

const STATUS_TONE: Record<ContractStatus, 'jade' | 'amber' | 'gray' | 'tomato'> = {
  active: 'jade',
  pending: 'amber',
  expired: 'gray',
  terminated: 'tomato',
};
const KIND_LABEL: Record<ContractKind, string> = {
  msa: 'MSA',
  framework: 'Framework',
  sow: 'SOW',
  nda: 'NDA',
  other: 'Other',
};

const inputCls =
  'rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm';

export function ContractAgreementsCard({ accountKey }: { accountKey: string }) {
  const agreements = useContractAgreements(accountKey);
  const canWrite = useIsAdmin();

  return (
    <Card role="region" aria-label="Contractual agreements">
      <SectionHeader
        title="Contractual agreements"
        caption="MSAs & framework agreements, coverage, rebates, and rate-review schedule"
        action={canWrite ? <CreateAgreement accountKey={accountKey} /> : undefined}
      />
      <div className="px-5 pb-5">
        {agreements.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : agreements.isError ? (
          <ErrorState
            title="Could not load contractual agreements"
            message={agreements.error?.message ?? 'Try again shortly.'}
          />
        ) : (agreements.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--fg-tertiary)]">
            No MSAs or framework agreements recorded for this account yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {agreements.data!.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-[var(--fg-primary)]">
                      <Badge tone="teal">{KIND_LABEL[a.kind]}</Badge>
                      <span className="font-medium">{a.reference}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                      {a.countries.length > 0 ? a.countries.join(', ') : 'No countries set'}
                      {a.globalRebateBps != null
                        ? ` · rebate ${(a.globalRebateBps / 100).toFixed(2)}%`
                        : ''}
                      {` · rate review ${a.rateReviewSchedule}`}
                      {a.nextRateReviewAt ? ` (next ${a.nextRateReviewAt.slice(0, 10)})` : ''}
                      {a.expiryDate ? ` · expires ${a.expiryDate.slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CreateAgreement({ accountKey }: { accountKey: string }) {
  const [open, setOpen] = useState(false);
  const create = useCreateContractAgreement();
  const [form, setForm] = useState({
    kind: 'msa' as ContractKind,
    reference: '',
    countries: '',
    globalRebatePct: '',
    expiryDate: '',
    rateReviewSchedule: 'annual' as ContractAgreement['rateReviewSchedule'],
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.reference.trim()) {
      toast.error('Missing reference', { description: 'A contract reference is required.' });
      return;
    }
    const countries = form.countries
      .split(/[,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length === 2);
    const pct = form.globalRebatePct.trim();
    create.mutate(
      {
        accountKey,
        kind: form.kind,
        reference: form.reference.trim(),
        countries,
        globalRebateBps: pct ? Math.round(Number(pct) * 100) : null,
        currency: 'EUR',
        expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : null,
        rateReviewSchedule: form.rateReviewSchedule,
        status: 'active',
      },
      {
        onSuccess: () => {
          toast.success('Agreement recorded');
          setOpen(false);
          setForm({
            kind: 'msa',
            reference: '',
            countries: '',
            globalRebatePct: '',
            expiryDate: '',
            rateReviewSchedule: 'annual',
          });
        },
        onError: (err: Error) => toast.error('Could not save', { description: err.message }),
      },
    );
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add agreement
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="w-full space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ContractKind }))}
          className={inputCls}
          aria-label="Agreement type"
        >
          {(Object.keys(KIND_LABEL) as ContractKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          required
          value={form.reference}
          onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
          placeholder="Reference (e.g. MSA-2026-001)"
          className={inputCls}
          aria-label="Contract reference"
        />
        <input
          value={form.countries}
          onChange={(e) => setForm((f) => ({ ...f, countries: e.target.value }))}
          placeholder="Countries (FR, DE, ES)"
          className={inputCls}
          aria-label="Countries covered"
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={form.globalRebatePct}
          onChange={(e) => setForm((f) => ({ ...f, globalRebatePct: e.target.value }))}
          placeholder="Global rebate %"
          className={inputCls}
          aria-label="Global rebate percent"
        />
        <select
          value={form.rateReviewSchedule}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              rateReviewSchedule: e.target.value as ContractAgreement['rateReviewSchedule'],
            }))
          }
          className={inputCls}
          aria-label="Rate review schedule"
        >
          <option value="annual">Annual rate review</option>
          <option value="biannual">Biannual rate review</option>
          <option value="quarterly">Quarterly rate review</option>
          <option value="adhoc">Ad-hoc rate review</option>
        </select>
        <input
          type="date"
          value={form.expiryDate}
          onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
          className={inputCls}
          aria-label="Expiry date"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
