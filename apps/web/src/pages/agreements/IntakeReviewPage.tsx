import '@/components/agreements/agreements.css';

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { formatMicrosAmount, LOW_CONFIDENCE_BPS, type MsaExtractedField } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCompanies } from '@/hooks/useCompanies';
import { useConfirmMsaIntake, useMsaIntakeDraft } from '@/hooks/useMsaIntake';
import { useSigningEntities } from '@/hooks/useSigningEntities';

/** A contract amount in micros. An unsafe number is not printed as a nearby figure. */
export function formatExtractedMicros(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros < 0) return 'amount not readable';
  return formatMicrosAmount(micros);
}

function cite(field: MsaExtractedField): string {
  if (!field.found) return 'not found';
  if (!field.citation) return 'found, no clause cite';
  const bits = [field.citation.clause, field.citation.page ? `page ${field.citation.page}` : null].filter(Boolean);
  return bits.length ? bits.join(', ') : field.citation.excerpt;
}

function display(field: MsaExtractedField): string {
  if (!field.found || field.value == null || field.value === '') return 'not found';
  if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
  if (typeof field.value === 'number') return String(field.value);
  if (typeof field.value === 'string') return field.value;
  if (field.key === 'liabilityCap' && typeof field.value === 'object') {
    const cap = field.value as { amountMicros?: number; currency?: string };
    if (cap.amountMicros != null) return `${formatExtractedMicros(cap.amountMicros)} ${cap.currency ?? ''}`.trim();
  }
  if (Array.isArray(field.value)) {
    return field.value
      .map((row) => {
        if (!row || typeof row !== 'object') return JSON.stringify(row);
        const item = row as { name?: string; role?: string; rateMicros?: number; unit?: string };
        if (item.role && item.rateMicros == null) return `${item.role}: amount not readable`;
        if (item.role && item.rateMicros != null) {
          return `${item.role}: ${formatExtractedMicros(item.rateMicros)} / ${item.unit ?? 'day'}`;
        }
        if (item.name) return item.name;
        return JSON.stringify(row);
      })
      .join(' · ');
  }
  return JSON.stringify(field.value);
}

const REVIEW_KEYS: Array<[string, keyof import('@bidstack/shared').MsaExtractedFields]> = [
  ['Client party', 'clientParty'],
  ['Our party', 'ourParty'],
  ['Effective date', 'effectiveDate'],
  ['Term (months)', 'termMonths'],
  ['Term', 'termText'],
  ['Auto-renewal', 'autoRenew'],
  ['Renewal terms', 'renewalTerms'],
  ['Expiry', 'expiryDate'],
  ['Governing law', 'governingLaw'],
  ['Liability cap', 'liabilityCap'],
  ['Payment terms', 'paymentTerms'],
  ['Termination notice (days)', 'noticePeriodDays'],
  ['Intellectual property', 'ip'],
  ['Confidentiality', 'confidentiality'],
  ['Non-solicit', 'nonSolicit'],
  ['Exclusivity', 'exclusivity'],
  ['Insurance', 'insurance'],
  ['Rate card', 'rateCard'],
  ['Indexation', 'indexation'],
  ['Scope of services', 'scopeOfServices'],
  ['Affiliates', 'affiliatesClause'],
];

export default function IntakeReviewPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const draft = useMsaIntakeDraft(id);
  const companies = useCompanies();
  const entities = useSigningEntities();
  const confirm = useConfirmMsaIntake();
  const [companyId, setCompanyId] = useState('');
  const [createName, setCreateName] = useState('');
  const [signingEntityId, setSigningEntityId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suggestedCompany = draft.data?.accountMatches[0];
  const suggestedEntity = draft.data?.signingEntityMatches[0];
  const queue = useMemo(() => (params.get('queue') ?? '').split(',').filter(Boolean), [params]);

  const resolvedCompany = companyId || suggestedCompany?.companyId || '';
  const resolvedEntity = signingEntityId || suggestedEntity?.entityId || '';

  if (draft.isLoading) return <LoadingSkeleton rows={8} />;
  if (draft.isError || !draft.data) {
    return (
      <div className="agr">
        <ErrorState title="Intake not found" message="This review may have expired." action={<Link className="drill-more" to="/agreements">Back to Agreements</Link>} />
      </div>
    );
  }
  const d = draft.data;
  const clientGuess = typeof d.extractedFields.clientParty.value === 'string' ? d.extractedFields.clientParty.value : '';

  const submit = async () => {
    setError(null);
    try {
      const body = resolvedCompany
        ? { companyId: resolvedCompany, signingEntityId: resolvedEntity || null, status: 'active' as const, kind: 'msa' as const }
        : { createCompany: { name: createName.trim() || clientGuess || 'New account' }, signingEntityId: resolvedEntity || null, status: 'active' as const, kind: 'msa' as const };
      const out = await confirm.mutateAsync({ id: d.id, body });
      if (queue[0]) navigate(`/agreements/intake/${queue[0]}${queue.length > 1 ? `?queue=${queue.slice(1).join(',')}` : ''}`);
      else navigate(`/agreements/${out.contractId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm this MSA');
    }
  };

  return (
    <div className="agr" data-testid="msa-intake-review">
      <header className="agr-head">
        <div>
          <p className="agr-caption"><Link to="/agreements">Agreements</Link> · Review</p>
          <h1>Review extracted MSA</h1>
          <p className="agr-caption">{d.fileName} · nothing is saved until you confirm</p>
        </div>
      </header>

      {d.needsOcr ? (
        <p className="agr-sample" role="status" data-testid="msa-needs-ocr">
          This file looks scanned and needs OCR. Fields below stay blank. Confirm is blocked until a text layer exists.
        </p>
      ) : null}
      {d.warnings.map((w) => <p key={w} className="agr-caption">{w}</p>)}

      <section className="agr-section" aria-labelledby="rev-match">
        <h2 id="rev-match">Client and signing entity</h2>
        <div className="agr-form">
          <label>
            Existing account
            <select value={resolvedCompany} onChange={(e) => setCompanyId(e.target.value)} data-testid="msa-review-account">
              <option value="">No match · create a new account</option>
              {(companies.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          {suggestedCompany ? (
            <p className="agr-caption">Suggested: {suggestedCompany.name} ({Math.round(suggestedCompany.scoreBps / 100)}% · {suggestedCompany.reasons[0]})</p>
          ) : (
            <p className="agr-caption">No account matched. Create a new one to continue.</p>
          )}
          {!resolvedCompany ? (
            <label>
              New account name
              <input value={createName || clientGuess} onChange={(e) => setCreateName(e.target.value)} maxLength={200} data-testid="msa-review-new-account" />
            </label>
          ) : null}
          <label>
            Our signing entity
            <select value={resolvedEntity} onChange={(e) => setSigningEntityId(e.target.value)} data-testid="msa-review-entity">
              <option value="">Not confirmed</option>
              {(entities.data?.items ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.verificationStatus === 'unverified' ? ' (unverified)' : ''}</option>
              ))}
            </select>
          </label>
          {suggestedEntity ? (
            <p className="agr-caption">Detected {suggestedEntity.name}{suggestedEntity.alias ? ` as "${suggestedEntity.alias}"` : ''} ({Math.round(suggestedEntity.scoreBps / 100)}%)</p>
          ) : null}
        </div>
      </section>

      <section className="agr-section" aria-labelledby="rev-fields">
        <h2 id="rev-fields">Extracted terms</h2>
        <p className="agr-caption">Low-confidence values are highlighted. Blank means not found, never invented.</p>
        <dl className="agr-terms agr-review-terms">
          {REVIEW_KEYS.map(([label, key]) => {
            const field = d.extractedFields[key];
            const low = field.found && field.confidenceBps < LOW_CONFIDENCE_BPS;
            return (
              <div key={key} data-low={low || undefined} data-missing={!field.found || undefined}>
                <dt>{label}</dt>
                <dd>
                  {display(field)}
                  <span className="agr-cite">{cite(field)}{low ? ' · low confidence' : ''}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {error ? <p className="agr-error" role="alert">{error}</p> : null}
      <div className="agr-actions">
        <Button type="button" variant="secondary" onClick={() => navigate('/agreements')}>Discard</Button>
        <Button
          type="button"
          variant="primary"
          disabled={d.needsOcr || confirm.isPending || (!resolvedCompany && !(createName || clientGuess))}
          onClick={() => void submit()}
          data-testid="msa-review-confirm"
        >
          {confirm.isPending ? 'Saving…' : 'Confirm and save'}
        </Button>
      </div>
    </div>
  );
}
