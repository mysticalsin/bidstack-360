/**
 * Contractual management for the open account — MSAs / framework agreements,
 * the countries each covers, global rebate terms, and the rate re-evaluation
 * schedule. Pre-sales-owned, internal data. Demo feedback (Marc + Marie-Benoît).
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import {
  useContractAgreements,
  useCreateContractAgreement,
  useExtractContract,
  useContractExtraction,
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
  const { t } = useTranslation('crm');
  const agreements = useContractAgreements(accountKey);
  const canWrite = useIsAdmin();

  return (
    <Card role="region" aria-label={t('contractAgreements.regionLabel', 'Contractual agreements')}>
      <SectionHeader
        title={t('contractAgreements.title', 'Contractual agreements')}
        caption={t(
          'contractAgreements.caption',
          'MSAs & framework agreements, coverage, rebates, and rate-review schedule',
        )}
        action={canWrite ? <CreateAgreement accountKey={accountKey} /> : undefined}
      />
      <div className="px-5 pb-5">
        {agreements.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : agreements.isError ? (
          <ErrorState
            title={t('contractAgreements.loadErrorTitle', 'Could not load contractual agreements')}
            message={agreements.error?.message ?? t('contractAgreements.tryAgainShortly', 'Try again shortly.')}
          />
        ) : (agreements.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--fg-tertiary)]">
            {t(
              'contractAgreements.empty',
              'No MSAs or framework agreements recorded for this account yet.',
            )}
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
                      {a.countries.length > 0
                        ? a.countries.join(', ')
                        : t('contractAgreements.noCountriesSet', 'No countries set')}
                      {a.globalRebateBps != null
                        ? t('contractAgreements.rebateSuffix', ' · rebate {{pct}}%', {
                            pct: (a.globalRebateBps / 100).toFixed(2),
                          })
                        : ''}
                      {t('contractAgreements.rateReviewSuffix', ' · rate review {{schedule}}', {
                        schedule: a.rateReviewSchedule,
                      })}
                      {a.nextRateReviewAt
                        ? t('contractAgreements.nextReviewSuffix', ' (next {{date}})', {
                            date: a.nextRateReviewAt.slice(0, 10),
                          })
                        : ''}
                      {a.expiryDate
                        ? t('contractAgreements.expiresSuffix', ' · expires {{date}}', {
                            date: a.expiryDate.slice(0, 10),
                          })
                        : ''}
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
                        {t('contractAgreements.viewDocument', 'View document')}
                      </a>
                    )}
                  </div>
                </div>
                {a.rateCard.length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--fg-tertiary)]">
                        <th scope="col" className="py-1 font-medium">
                          {t('contractAgreements.tableRole', 'Role')}
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          {t('contractAgreements.tableRate', 'Rate')}
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
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const create = useCreateContractAgreement();
  const upload = useUploadFile(accountKey);
  const extract = useExtractContract();
  // The hosted source document (uploaded MSA/rate-card PDF) linked to this agreement.
  const [sourceFile, setSourceFile] = useState<{ id: string; name: string } | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const extraction = useContractExtraction(extractionId);

  // OCR/extraction is best-effort — the user explicitly APPLIES the draft into
  // the editable form, then reviews/edits before saving (never auto-committed).
  function applyDraft() {
    const d = extraction.data?.draft;
    if (!d) return;
    setForm((f) => ({
      ...f,
      kind: d.kind ?? f.kind,
      reference: d.reference ?? f.reference,
      countries: d.countries.length ? d.countries.join(', ') : f.countries,
      globalRebatePct: d.globalRebateBps != null ? String(d.globalRebateBps / 100) : f.globalRebatePct,
      currency: d.currency ?? f.currency,
      expiryDate: d.expiryDate ? d.expiryDate.slice(0, 10) : f.expiryDate,
      rateReviewSchedule: d.rateReviewSchedule ?? f.rateReviewSchedule,
    }));
    if (d.rateCard.length) {
      setRateLines(
        d.rateCard.map((l) => ({
          role: l.role,
          rate: String(l.rateMicros / 1_000_000),
          unit: l.unit,
        })),
      );
    }
    toast.success(
      t('contractAgreements.toastExtractApplied', 'Extracted fields applied — review before saving'),
    );
  }
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
      toast.error(t('contractAgreements.toastMissingReferenceTitle', 'Missing reference'), {
        description: t(
          'contractAgreements.toastMissingReferenceDesc',
          'A contract reference is required.',
        ),
      });
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
          toast.success(t('contractAgreements.toastAgreementRecorded', 'Agreement recorded'));
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
          setExtractionId(null);
        },
        onError: (err: Error) =>
          toast.error(t('contractAgreements.toastCouldNotSave', 'Could not save'), {
            description: err.message,
          }),
      },
    );
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('contractAgreements.addAgreement', 'Add agreement')}
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
          aria-label={t('contractAgreements.fieldAgreementType', 'Agreement type')}
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
          placeholder={t('contractAgreements.placeholderReference', 'Reference (e.g. MSA-2026-001)')}
          className={inputCls}
          aria-label={t('contractAgreements.fieldReference', 'Contract reference')}
        />
        <input
          value={form.countries}
          onChange={(e) => setForm((f) => ({ ...f, countries: e.target.value }))}
          placeholder={t('contractAgreements.placeholderCountries', 'Countries (FR, DE, ES)')}
          className={inputCls}
          aria-label={t('contractAgreements.fieldCountries', 'Countries covered')}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={form.globalRebatePct}
          onChange={(e) => setForm((f) => ({ ...f, globalRebatePct: e.target.value }))}
          placeholder={t('contractAgreements.placeholderRebate', 'Global rebate %')}
          className={inputCls}
          aria-label={t('contractAgreements.fieldRebate', 'Global rebate percent')}
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
          aria-label={t('contractAgreements.fieldRateReviewSchedule', 'Rate review schedule')}
        >
          <option value="annual">{t('contractAgreements.scheduleAnnual', 'Annual rate review')}</option>
          <option value="biannual">{t('contractAgreements.scheduleBiannual', 'Biannual rate review')}</option>
          <option value="quarterly">{t('contractAgreements.scheduleQuarterly', 'Quarterly rate review')}</option>
          <option value="adhoc">{t('contractAgreements.scheduleAdhoc', 'Ad-hoc rate review')}</option>
        </select>
        <input
          type="date"
          value={form.expiryDate}
          onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
          className={inputCls}
          aria-label={t('contractAgreements.fieldExpiryDate', 'Expiry date')}
        />
        <input
          value={form.currency}
          onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
          placeholder={t('contractAgreements.placeholderCurrency', 'Currency (EUR)')}
          maxLength={3}
          className={inputCls}
          aria-label={t('contractAgreements.fieldCurrency', 'Currency')}
        />
      </div>

      {/* Hosted source document — upload + store the MSA/rate-card PDF */}
      <div className="space-y-1 border-t border-[var(--border)] pt-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          {t('contractAgreements.sourceDocument', 'Source document')}
        </p>
        {sourceFile ? (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
              <span className="truncate">{sourceFile.name}</span>
              <button
                type="button"
                onClick={() => {
                  setSourceFile(null);
                  setExtractionId(null);
                }}
                className="text-xs text-[var(--fg-tertiary)] hover:text-[var(--danger)]"
                aria-label={t('contractAgreements.removeAttachedDocument', 'Remove attached document')}
              >
                {t('contractAgreements.remove', 'remove')}
              </button>
            </p>
            {/* OCR + extraction → reviewable prefill */}
            {!extractionId ? (
              <button
                type="button"
                className="min-h-[44px] rounded px-2 text-xs text-[var(--brand-primary)] hover:underline disabled:opacity-50"
                disabled={extract.isPending}
                onClick={() =>
                  extract.mutate(sourceFile.id, {
                    onSuccess: (r) => setExtractionId(r.id),
                    onError: (err: Error) =>
                      toast.error(
                        t('contractAgreements.toastExtractStartFailed', 'Could not start extraction'),
                        { description: err.message },
                      ),
                  })
                }
              >
                {extract.isPending
                  ? t('contractAgreements.starting', 'Starting…')
                  : t('contractAgreements.extractFields', 'Extract fields from document')}
              </button>
            ) : extraction.data?.status === 'done' && extraction.data.draft ? (
              <div className="space-y-1">
                <button
                  type="button"
                  className="min-h-[44px] rounded px-2 text-xs font-medium text-[var(--brand-primary)] hover:underline"
                  onClick={applyDraft}
                >
                  {t(
                    'contractAgreements.applyExtractedFields',
                    'Apply extracted fields (review before saving)',
                  )}
                </button>
                {extraction.data.draft.warnings.slice(0, 2).map((w, i) => (
                  <p key={i} className="text-[11px] text-[var(--fg-tertiary)]">
                    {w}
                  </p>
                ))}
              </div>
            ) : extraction.data?.status === 'error' ? (
              <p className="text-xs text-[var(--danger)]">
                {extraction.data.error
                  ? t(
                      'contractAgreements.extractionFailedWithReason',
                      'Extraction failed: {{reason}}. Enter fields manually.',
                      { reason: extraction.data.error },
                    )
                  : t(
                      'contractAgreements.extractionFailed',
                      'Extraction failed. Enter fields manually.',
                    )}
              </p>
            ) : (
              <p className="text-xs text-[var(--fg-tertiary)]">
                {t('contractAgreements.extracting', 'Extracting… (OCR + parsing)')}
              </p>
            )}
          </div>
        ) : (
          <label className="flex min-h-[44px] cursor-pointer items-center text-sm text-[var(--brand-primary)] hover:underline">
            {upload.isPending
              ? t('contractAgreements.uploading', 'Uploading…')
              : t(
                  'contractAgreements.attachDocument',
                  'Attach MSA / rate-card document (PDF, image)',
                )}
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
                    toast.error(t('contractAgreements.toastUploadFailed', 'Upload failed'), {
                      description: err.message,
                    }),
                });
              }}
            />
          </label>
        )}
      </div>

      {/* Rate card — negotiated role rates for this MSA/contract */}
      <div className="space-y-2 border-t border-[var(--border)] pt-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          {t('contractAgreements.rateCard', 'Rate card')}
        </p>
        {rateLines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={line.role}
              onChange={(e) => updateLine(i, { role: e.target.value })}
              placeholder={t('contractAgreements.placeholderRoleProfile', 'Role / profile')}
              className={`${inputCls} flex-1`}
              aria-label={t('contractAgreements.rateLineRole', 'Rate line {{n}} role', { n: i + 1 })}
            />
            <input
              type="number"
              min="0"
              step="1"
              value={line.rate}
              onChange={(e) => updateLine(i, { rate: e.target.value })}
              placeholder={t('contractAgreements.placeholderRate', 'Rate')}
              className={`${inputCls} w-24`}
              aria-label={t('contractAgreements.rateLineRate', 'Rate line {{n}} rate', { n: i + 1 })}
            />
            <select
              value={line.unit}
              onChange={(e) => updateLine(i, { unit: e.target.value as RateCardUnit })}
              className={inputCls}
              aria-label={t('contractAgreements.rateLineUnit', 'Rate line {{n}} unit', { n: i + 1 })}
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
              aria-label={t('contractAgreements.removeRateLine', 'Remove rate line {{n}}', { n: i + 1 })}
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
          {t('contractAgreements.addRateLine', '+ Add rate line')}
        </button>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending
            ? t('contractAgreements.saving', 'Saving…')
            : t('contractAgreements.save', 'Save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t('contractAgreements.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}
