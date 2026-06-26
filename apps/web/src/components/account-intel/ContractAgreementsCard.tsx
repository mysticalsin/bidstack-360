/**
 * Contractual management for the open account — MSAs / framework agreements,
 * the countries each covers, global rebate terms, and the rate re-evaluation
 * schedule. Pre-sales-owned, internal data. Demo feedback (Marc + Marie-Benoît).
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useState, type DragEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { SourceBadge, type CockpitSourceState } from '@/components/cockpit/SourceBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useIsAdmin } from '@/lib/auth';
import { staggerChild } from '@/lib/motion';
import {
  useContractAgreements,
  useCreateContractAgreement,
  useApproveContractExtraction,
  useExtractContract,
  useContractExtraction,
} from '@/hooks/useContractAgreements';
import { useUploadFile, downloadFileUrl } from '@/hooks/useFiles';
import {
  FILE_INPUT_ACCEPT,
  type ContractAgreement,
  type ContractFieldProvenance,
  type ContractExtractionApproval,
  type ContractKind,
  type ContractStatus,
  type RateCardLine,
  type RateCardUnit,
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

function formatRebate(bps: number | null): string {
  return bps == null ? '0.00%' : `${(bps / 100).toFixed(2)}%`;
}

function confidenceTone(bps: number | null): 'jade' | 'amber' | 'gray' {
  if (bps == null) return 'gray';
  return bps >= 8000 ? 'jade' : 'amber';
}

const inputCls =
  'rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm';

type ContractFieldKey =
  | 'reference'
  | 'countries'
  | 'globalRebateBps'
  | 'rateReviewSchedule'
  | 'nextRateReviewAt'
  | 'expiryDate'
  | 'status'
  | 'rateCard';

function sourceState(source: ContractFieldProvenance['source']): CockpitSourceState {
  if (source === 'manual' || source === 'derived:llm') return 'verified';
  if (source === 'document' || source === 'derived:deterministic') return 'crm';
  return 'missing';
}

function fieldSource(
  agreement: ContractAgreement,
  field: ContractFieldKey,
): ContractFieldProvenance {
  const source = agreement.fieldSources?.[field] ?? agreement.fieldSources?.reference;
  return (
    source ?? {
      source: 'manual',
      label: 'Manual',
      hint: `Manually maintained in BidStack CRM. Saved ${agreement.updatedAt.slice(0, 10)}.`,
      confidence: 1,
      sourceFileId: null,
      sourceFileName: null,
      sourceExtractionId: null,
      updatedAt: agreement.updatedAt,
    }
  );
}

function ContractSourceBadge({
  agreement,
  field,
  testId,
}: {
  agreement: ContractAgreement;
  field: ContractFieldKey;
  testId: string;
}) {
  const source = fieldSource(agreement, field);
  return (
    <SourceBadge
      label={source.label}
      state={sourceState(source.source)}
      hint={source.hint}
      className="shrink-0"
      data-testid={testId}
    />
  );
}

function summarizeFieldSources(
  agreements: ContractAgreement[],
  fields: ContractFieldKey[],
  label: string,
): { label: string; state: CockpitSourceState; hint: string } {
  const sources = agreements
    .flatMap((agreement) => fields.map((field) => fieldSource(agreement, field)))
    .filter(Boolean);
  const agreementCount = agreements.length;
  const humanReviewed = sources.filter((source) => source.source.startsWith('derived:')).length;
  const documentLinked = sources.filter((source) => source.source === 'document').length;
  const manual = sources.filter((source) => source.source === 'manual').length;
  const latest = sources
    .map((source) => source.updatedAt)
    .sort()
    .at(-1);

  if (humanReviewed > 0) {
    return {
      label: 'Reviewed extraction',
      state: 'verified',
      hint: `${label} is derived from ${agreementCount} agreement record(s); ${humanReviewed} source field(s) were human-reviewed extraction output. Latest update ${latest?.slice(0, 10) ?? 'unknown'}.`,
    };
  }
  if (documentLinked > 0) {
    return {
      label: 'Linked documents',
      state: 'crm',
      hint: `${label} is derived from ${agreementCount} agreement record(s); ${documentLinked} source field(s) are linked to uploaded contract documents. Latest update ${latest?.slice(0, 10) ?? 'unknown'}.`,
    };
  }
  return {
    label: 'Manual CRM',
    state: manual > 0 ? 'crm' : 'missing',
    hint: `${label} is derived from ${agreementCount} manually maintained agreement record(s). Latest update ${latest?.slice(0, 10) ?? 'unknown'}.`,
  };
}

function ContractMetricTile({
  label,
  value,
  source,
  testId,
}: {
  label: string;
  value: string | number;
  source: { label: string; state: CockpitSourceState; hint: string };
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
      <p className="text-[10px] font-medium uppercase text-[var(--fg-tertiary)]">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-[var(--fg-primary)]">{value}</p>
      <SourceBadge
        label={source.label}
        state={source.state}
        hint={source.hint}
        className="mt-1 max-w-full"
        data-testid={testId}
      />
    </div>
  );
}

export function ContractAgreementsCard({ accountKey }: { accountKey: string }) {
  const { t } = useTranslation('crm');
  const agreements = useContractAgreements(accountKey);
  const canWrite = useIsAdmin();
  const items = agreements.data ?? [];
  const activeCount = items.filter((item) => item.status === 'active').length;
  const coveredCountries = new Set(items.flatMap((item) => item.countries)).size;
  const nextReview = items
    .map((item) => item.nextRateReviewAt ?? item.expiryDate)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const activeSource = summarizeFieldSources(items, ['status'], 'Active agreement count');
  const coverageSource = summarizeFieldSources(items, ['countries'], 'Country coverage');
  const nextSource = summarizeFieldSources(
    items,
    ['nextRateReviewAt', 'expiryDate'],
    'Next legal review date',
  );

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
        {!agreements.isLoading && !agreements.isError && items.length > 0 && (
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ContractMetricTile
              label={t('contractAgreements.metricActive', 'Active')}
              value={activeCount}
              source={activeSource}
              testId="contract-summary-source-active"
            />
            <ContractMetricTile
              label={t('contractAgreements.metricCoverage', 'Coverage')}
              value={coveredCountries}
              source={coverageSource}
              testId="contract-summary-source-coverage"
            />
            <ContractMetricTile
              label={t('contractAgreements.metricNext', 'Next')}
              value={nextReview ? nextReview.slice(0, 10) : t('contractAgreements.none', 'None')}
              source={nextSource}
              testId="contract-summary-source-next"
            />
          </div>
        )}
        {agreements.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : agreements.isError ? (
          <ErrorState
            title={t('contractAgreements.loadErrorTitle', 'Could not load contractual agreements')}
            message={agreements.error?.message ?? t('contractAgreements.tryAgainShortly', 'Try again shortly.')}
          />
        ) : items.length === 0 ? (
          <p className="text-sm text-[var(--fg-tertiary)]">
            {t(
              'contractAgreements.empty',
              'No MSAs or framework agreements recorded for this account yet.',
            )}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((a) => (
              <li key={a.id} className="rounded-lg px-2 py-3 transition-colors hover:bg-[var(--surface-sunken)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--fg-primary)]">
                      <Badge tone="teal">{KIND_LABEL[a.kind]}</Badge>
                      <span className="min-w-0 truncate font-medium">{a.reference}</span>
                      <ContractSourceBadge
                        agreement={a}
                        field="reference"
                        testId={`contract-source-${a.id}-reference`}
                      />
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
                      {a.countries.length > 0
                        ? a.countries.join(', ')
                        : t('contractAgreements.noCountriesSet', 'No countries set')}
                      {a.globalRebateBps != null
                        ? t('contractAgreements.rebateSuffix', ' · rebate {{pct}}%', {
                            pct: formatRebate(a.globalRebateBps).replace('%', ''),
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
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ContractSourceBadge
                        agreement={a}
                        field="countries"
                        testId={`contract-source-${a.id}-countries`}
                      />
                      <ContractSourceBadge
                        agreement={a}
                        field="globalRebateBps"
                        testId={`contract-source-${a.id}-rebate`}
                      />
                      <ContractSourceBadge
                        agreement={a}
                        field="rateReviewSchedule"
                        testId={`contract-source-${a.id}-rate-review`}
                      />
                      {a.nextRateReviewAt && (
                        <ContractSourceBadge
                          agreement={a}
                          field="nextRateReviewAt"
                          testId={`contract-source-${a.id}-next-review`}
                        />
                      )}
                      {a.expiryDate && (
                        <ContractSourceBadge
                          agreement={a}
                          field="expiryDate"
                          testId={`contract-source-${a.id}-expiry`}
                        />
                      )}
                    </div>
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
                    <caption className="pb-1 text-left">
                      <span className="inline-flex w-full items-center justify-between gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
                          {t('contractAgreements.rateCard', 'Rate card')}
                        </span>
                        <ContractSourceBadge
                          agreement={a}
                          field="rateCard"
                          testId={`contract-source-${a.id}-rate-card`}
                        />
                      </span>
                    </caption>
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
  const approve = useApproveContractExtraction();
  const upload = useUploadFile(accountKey);
  const extract = useExtractContract();
  const reducedMotion = useReducedMotion();
  const [dragActive, setDragActive] = useState(false);
  // The hosted source document (uploaded MSA/rate-card PDF) linked to this agreement.
  const [sourceFile, setSourceFile] = useState<{ id: string; name: string } | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const extraction = useContractExtraction(extractionId);
  const extractionDraft = extraction.data?.draft ?? null;
  const extractionBusy =
    extractionId !== null &&
    extraction.data?.status !== 'done' &&
    extraction.data?.status !== 'error';
  const saveBusy = create.isPending || approve.isPending;

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

  const resetForm = () => {
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
    setDragActive(false);
  };

  const uploadSelectedFile = (file: File) => {
    upload.mutate(file, {
      onSuccess: (att) => {
        setSourceFile({ id: att.id, name: att.name });
        setExtractionId(null);
        toast.success(t('contractAgreements.toastDocumentAttached', 'Document attached'));
      },
      onError: (err: Error) =>
        toast.error(t('contractAgreements.toastUploadFailed', 'Upload failed'), {
          description: err.message,
        }),
    });
  };

  const onDropDocument = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) uploadSelectedFile(file);
  };

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
    if (extractionBusy) {
      toast.error(t('contractAgreements.toastExtractionStillRunning', 'Extraction still running'), {
        description: t(
          'contractAgreements.toastExtractionStillRunningDesc',
          'Wait for the review draft, or remove the extraction and save manually.',
        ),
      });
      return;
    }

    const payload: ContractExtractionApproval = {
      accountKey,
      kind: form.kind,
      reference: form.reference.trim(),
      countries,
      globalRebateBps: pct ? Math.round(Number(pct) * 100) : null,
      currency: form.currency.trim().toUpperCase() || 'EUR',
      rateCard,
      expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : null,
      rateReviewSchedule: form.rateReviewSchedule,
      status: 'active',
    };
    const mutationOptions = {
      onSuccess: () => {
        toast.success(t('contractAgreements.toastAgreementRecorded', 'Agreement recorded'));
        resetForm();
      },
      onError: (err: Error) =>
        toast.error(t('contractAgreements.toastCouldNotSave', 'Could not save'), {
          description: err.message,
        }),
    };

    if (extractionId && extraction.data?.status === 'done' && extractionDraft) {
      approve.mutate({ id: extractionId, body: payload }, mutationOptions);
    } else {
      create.mutate({ ...payload, sourceFileId: sourceFile?.id ?? null }, mutationOptions);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />
        {t('contractAgreements.addAgreement', 'Add agreement')}
      </Button>
    );
  }
  return (
    <motion.form
      onSubmit={onSubmit}
      className="w-full space-y-3"
      variants={reducedMotion ? undefined : staggerChild}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

      {/* Hosted source document: upload + store the MSA/rate-card PDF. */}
      <div className="space-y-2 border-t border-[var(--border)] pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          {t('contractAgreements.sourceDocument', 'Source document')}
        </p>
        {sourceFile ? (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 text-sm text-[var(--fg-secondary)]">
                <Icon name="file" size={16} className="shrink-0 text-[var(--brand-primary)]" />
                <span className="truncate">{sourceFile.name}</span>
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSourceFile(null);
                  setExtractionId(null);
                }}
                aria-label={t('contractAgreements.removeAttachedDocument', 'Remove attached document')}
              >
                <Icon name="x" size={14} />
              </Button>
            </div>
            {/* OCR + extraction → reviewable prefill */}
            {!extractionId ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
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
                <Icon name={extract.isPending ? 'loader' : 'wand'} size={14} />
                {extract.isPending
                  ? t('contractAgreements.starting', 'Starting…')
                  : t('contractAgreements.extractFields', 'Extract fields from document')}
              </Button>
            ) : extraction.data?.status === 'done' && extractionDraft ? (
              <div className="mt-3 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={confidenceTone(extraction.data.confidenceBps)}>
                    {t('contractAgreements.extractionConfidence', '{{pct}}% confidence', {
                      pct: ((extraction.data.confidenceBps ?? 0) / 100).toFixed(0),
                    })}
                  </Badge>
                  <Badge tone={extraction.data.source === 'llm' ? 'purple' : 'gray'}>
                    {extraction.data.source === 'llm'
                      ? t('contractAgreements.aiAssisted', 'AI assisted')
                      : t('contractAgreements.rulesBased', 'Rules based')}
                  </Badge>
                  <Badge tone={extraction.data.reviewStatus === 'approved' ? 'jade' : 'amber'}>
                    {extraction.data.reviewStatus === 'approved'
                      ? t('contractAgreements.reviewApproved', 'Approved')
                      : t('contractAgreements.needsReview', 'Needs review')}
                  </Badge>
                </div>
                <Button type="button" variant="success" size="sm" onClick={applyDraft}>
                  <Icon name="checkCircle" size={14} />
                  {t(
                    'contractAgreements.applyExtractedFields',
                    'Apply extracted fields (review before saving)',
                  )}
                </Button>
                {extractionDraft.warnings.slice(0, 2).map((w, i) => (
                  <p key={i} className="flex gap-1 text-[11px] text-[var(--fg-tertiary)]">
                    <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            ) : extraction.data?.status === 'error' ? (
              <p className="mt-3 flex gap-2 text-xs text-[var(--danger)]">
                <Icon name="warning" size={14} className="shrink-0" />
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
              <p className="mt-3 flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
                <Icon name="loader" size={14} />
                {t('contractAgreements.extracting', 'Extracting… (OCR + parsing)')}
              </p>
            )}
          </div>
        ) : (
          <label
            data-testid="contract-source-dropzone"
            className={`flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-center text-sm transition-colors ${
              dragActive
                ? 'border-[var(--brand-primary)] bg-[var(--btn-brand-tint-hover)] text-[var(--brand-primary)]'
                : 'border-[var(--border-default)] bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDropDocument}
          >
            <Icon name="upload" size={20} />
            <span>
              {upload.isPending
                ? t('contractAgreements.uploading', 'Uploading…')
                : t(
                    'contractAgreements.attachDocument',
                    'Attach MSA / rate-card document (PDF, Office, text, image)',
                  )}
            </span>
            <input
              type="file"
              accept={FILE_INPUT_ACCEPT}
              className="sr-only"
              aria-label={t(
                'contractAgreements.uploadSourceDocument',
                'Upload source contract document',
              )}
              data-testid="contract-source-file-input"
              disabled={upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                uploadSelectedFile(file);
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeLine(i)}
              className="min-w-[44px] text-[var(--fg-tertiary)] hover:text-[var(--danger)]"
              aria-label={t('contractAgreements.removeRateLine', 'Remove rate line {{n}}', { n: i + 1 })}
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addLine}
          className="text-[var(--brand-primary)]"
        >
          <Icon name="plus" size={14} />
          {t('contractAgreements.addRateLine', 'Add rate line')}
        </Button>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saveBusy || extractionBusy}>
          <Icon name={saveBusy ? 'loader' : 'checkCircle'} size={14} />
          {saveBusy
            ? t('contractAgreements.saving', 'Saving…')
            : extractionId && extraction.data?.status === 'done' && extractionDraft
              ? t('contractAgreements.approveAndSave', 'Approve and save')
              : t('contractAgreements.save', 'Save')}
        </Button>
        <Button type="button" variant="ghost" onClick={resetForm}>
          {t('contractAgreements.cancel', 'Cancel')}
        </Button>
      </div>
    </motion.form>
  );
}
