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
import { useUploadFile, downloadFileUrl } from '@/hooks/useFiles';
import type {
  ContractAgreement,
  ContractKind,
  ContractStatus,
  RateCardLine,
  RateCardUnit,
} from '@bidstack/shared';

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

const UNIT_LABEL: Record<RateCardUnit, string> = {
  day: '/day',
  hour: '/hr',
  month: '/mo',
  year: '/yr',
  fixed: ' fixed',
};

function formatRate(rateMicros: number, currency: string, unit: RateCardUnit): string {
  let amount: string;
  try {
    amount = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(rateMicros / 1_000_000);
  } catch {
    amount = `${(rateMicros / 1_000_000).toLocaleString()} ${currency}`;
  }
  return `${amount}${UNIT_LABEL[unit]}`;
}

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
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                    {a.sourceFileId && (
                      <a
                        href={downloadFileUrl(a.sourceFileId)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[var(--brand-primary)] hover:underline"
                      >
                        View document
                      </a>
                    )}
                  </div>
                </div>
                {a.rateCard.length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--fg-tertiary)]">
                        <th scope="col" className="py-1 font-medium">
                          Role
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.rateCard.map((line, i) => (
                        <tr key={`${line.role}-${i}`} className="border-t border-[var(--border)]">
                          <td className="py-1 text-[var(--fg-secondary)]">{line.role}</td>
                          <td className="py-1 text-right text-[var(--fg-primary)]">
                            {formatRate(line.rateMicros, line.currency ?? a.currency, line.unit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
  const upload = useUploadFile(accountKey);
  // The hosted source document (uploaded MSA/rate-card PDF) linked to this agreement.
  const [sourceFile, setSourceFile] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({
    kind: 'msa' as ContractKind,
    reference: '',
    countries: '',
    globalRebatePct: '',
    currency: 'EUR',
    expiryDate: '',
    rateReviewSchedule: 'annual' as ContractAgreement['rateReviewSchedule'],
  });
  // Rate-card lines (role -> rate). Rate is entered in major units and converted
  // to micros on submit (money-in-micros convention).
  const [rateLines, setRateLines] = useState<{ role: string; rate: string; unit: RateCardUnit }[]>(
    [],
  );
  const addLine = () => setRateLines((ls) => [...ls, { role: '', rate: '', unit: 'day' }]);
  const updateLine = (i: number, patch: Partial<{ role: string; rate: string; unit: RateCardUnit }>) =>
    setRateLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setRateLines((ls) => ls.filter((_, idx) => idx !== i));

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
    const rateCard: RateCardLine[] = rateLines
      .filter((l) => l.role.trim() && l.rate.trim() && Number.isFinite(Number(l.rate)))
      .map((l) => ({
        role: l.role.trim(),
        rateMicros: Math.round(Number(l.rate) * 1_000_000),
        unit: l.unit,
      }));
    create.mutate(
      {
        accountKey,
        kind: form.kind,
        reference: form.reference.trim(),
        countries,
        globalRebateBps: pct ? Math.round(Number(pct) * 100) : null,
        currency: form.currency.trim().toUpperCase() || 'EUR',
        rateCard,
        sourceFileId: sourceFile?.id ?? null,
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
            currency: 'EUR',
            expiryDate: '',
            rateReviewSchedule: 'annual',
          });
          setRateLines([]);
          setSourceFile(null);
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
        <input
          value={form.currency}
          onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
          placeholder="Currency (EUR)"
          maxLength={3}
          className={inputCls}
          aria-label="Currency"
        />
      </div>

      {/* Hosted source document — upload + store the MSA/rate-card PDF */}
      <div className="space-y-1 border-t border-[var(--border)] pt-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          Source document
        </p>
        {sourceFile ? (
          <p className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
            <span className="truncate">{sourceFile.name}</span>
            <button
              type="button"
              onClick={() => setSourceFile(null)}
              className="text-xs text-[var(--fg-tertiary)] hover:text-[var(--danger)]"
              aria-label="Remove attached document"
            >
              remove
            </button>
          </p>
        ) : (
          <label className="flex min-h-[44px] cursor-pointer items-center text-sm text-[var(--brand-primary)] hover:underline">
            {upload.isPending ? 'Uploading…' : 'Attach MSA / rate-card document (PDF, image)'}
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/tiff,image/webp,.doc,.docx"
              className="sr-only"
              disabled={upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                upload.mutate(file, {
                  onSuccess: (att) => setSourceFile({ id: att.id, name: att.name }),
                  onError: (err: Error) =>
                    toast.error('Upload failed', { description: err.message }),
                });
              }}
            />
          </label>
        )}
      </div>

      {/* Rate card — negotiated role rates for this MSA/contract */}
      <div className="space-y-2 border-t border-[var(--border)] pt-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          Rate card
        </p>
        {rateLines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={line.role}
              onChange={(e) => updateLine(i, { role: e.target.value })}
              placeholder="Role / profile"
              className={`${inputCls} flex-1`}
              aria-label={`Rate line ${i + 1} role`}
            />
            <input
              type="number"
              min="0"
              step="1"
              value={line.rate}
              onChange={(e) => updateLine(i, { rate: e.target.value })}
              placeholder="Rate"
              className={`${inputCls} w-24`}
              aria-label={`Rate line ${i + 1} rate`}
            />
            <select
              value={line.unit}
              onChange={(e) => updateLine(i, { unit: e.target.value as RateCardUnit })}
              className={inputCls}
              aria-label={`Rate line ${i + 1} unit`}
            >
              <option value="day">/day</option>
              <option value="hour">/hr</option>
              <option value="month">/mo</option>
              <option value="year">/yr</option>
              <option value="fixed">fixed</option>
            </select>
            <button
              type="button"
              onClick={() => removeLine(i)}
              className="min-h-[44px] min-w-[44px] rounded text-[var(--fg-tertiary)] hover:text-[var(--danger)]"
              aria-label={`Remove rate line ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          className="min-h-[44px] rounded px-2 text-xs text-[var(--brand-primary)] hover:underline"
        >
          + Add rate line
        </button>
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
