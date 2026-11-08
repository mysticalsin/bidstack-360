// Slice 22: the visible source chip under a company figure, the Edit form
// that saves a manual value with its source, and the empty-state actions.
import './figures.css';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { isHttpUrl, provenanceText, type CompanyFieldOverrideKey, type FigureProvenance } from '@bidstack/shared';

import { useHasPermission } from '@/hooks/useCapabilities';
import { isCompanyId, useRefreshPublicSources, useSaveFigureOverride } from '@/hooks/useSourcedFigures';

/** "Wikidata · 2024" under the value; a link when the source has one. */
export function SourceChip({ p, testId }: { p: FigureProvenance; testId?: string }) {
  const text = provenanceText(p);
  const title = `Source: ${text}${p.url ? `, ${p.url}` : ''}`;
  if (p.url && isHttpUrl(p.url)) {
    return (
      <a className="sf-chip" href={p.url} target="_blank" rel="noopener noreferrer" title={title} data-testid={testId}>
        {text}
      </a>
    );
  }
  return (
    <span className="sf-chip" title={title} data-testid={testId}>
      {text}
    </span>
  );
}

const VALUE_LABEL: Record<CompanyFieldOverrideKey, string> = {
  annualRevenueMicros: 'Revenue (EUR)',
  employeeCount: 'Employees',
  industry: 'Industry',
  registryId: 'Registration number',
  registryJurisdiction: 'Jurisdiction (country code, e.g. GB)',
};

function parseValue(fieldKey: CompanyFieldOverrideKey, raw: string): string | number | null {
  const v = raw.trim();
  if (!v) return null;
  if (fieldKey === 'annualRevenueMicros' || fieldKey === 'employeeCount') {
    const n = Number(v.replace(/[,\s]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return null;
    // Revenue is typed in currency units; the API stores micros.
    return fieldKey === 'annualRevenueMicros' ? Math.round(n * 1_000_000) : Math.round(n);
  }
  return v;
}

/** Value, source URL and source label. Escape or Cancel closes; Save calls the override API. */
export function FigureEditForm({ companyKey, fieldKey, label, onClose }: { companyKey: string; fieldKey: CompanyFieldOverrideKey; label: string; onClose: () => void }) {
  const id = useId();
  const [value, setValue] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useSaveFigureOverride(companyKey);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseValue(fieldKey, value);
    if (parsed === null) return setError(fieldKey === 'annualRevenueMicros' || fieldKey === 'employeeCount' ? 'Enter a positive number.' : 'Enter a value.');
    const url = sourceUrl.trim();
    if (url && !isHttpUrl(url)) return setError('The source must be an http or https link.');
    setError(null);
    save.mutate({ fieldKey, value: parsed, sourceUrl: url || null, sourceLabel: sourceLabel.trim() || null }, { onSuccess: onClose, onError: (err) => setError(err.message) });
  };
  return (
    <form
      className="sf-form"
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      aria-label={`Edit ${label}`}
      data-testid={`sf-form-${fieldKey}`}
    >
      <label htmlFor={`${id}-v`}>
        {VALUE_LABEL[fieldKey]}
        <input id={`${id}-v`} autoFocus value={value} onChange={(e) => setValue(e.target.value)} inputMode={fieldKey === 'annualRevenueMicros' || fieldKey === 'employeeCount' ? 'decimal' : 'text'} />
      </label>
      <label htmlFor={`${id}-u`}>
        Source URL
        <input id={`${id}-u`} type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" />
      </label>
      <label htmlFor={`${id}-l`}>
        Source label
        <input id={`${id}-l`} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Annual report 2025" maxLength={120} />
      </label>
      {error ? (
        <p className="sf-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sf-form-actions">
        <button type="submit" className="sf-btn" data-primary="true" disabled={save.isPending}>
          {save.isPending ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="sf-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface ActionsProps {
  /** Company id when known (refresh needs it); the name keys overrides otherwise. */
  companyId: string | null | undefined;
  companyName: string;
  fieldKey: CompanyFieldOverrideKey;
  label: string;
  /** When set, the figure is missing: show why, plus Refresh and Add manually. */
  missing?: string | null;
}

/** Edit for a known figure; for a missing one, the reason plus Refresh from public sources and Add manually. */
export function FigureActions({ companyId, companyName, fieldKey, label, missing }: ActionsProps) {
  const canEdit = useHasPermission('companies:write');
  const canIntel = useHasPermission('account-intel:write');
  const [editing, setEditing] = useState(false);
  const refocus = useRef(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const companyKey = isCompanyId(companyId) ? companyId : companyName;
  const refresh = useRefreshPublicSources(companyId ?? '', companyName);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      editRef.current?.focus();
    }
  }, [editing]);
  const close = () => {
    refocus.current = true;
    setEditing(false);
  };
  if (editing) return <FigureEditForm companyKey={companyKey} fieldKey={fieldKey} label={label} onClose={close} />;
  if (missing) {
    const canRefresh = isCompanyId(companyId) && (canEdit || canIntel);
    return (
      <div className="sf-empty" data-testid={`sf-empty-${fieldKey}`}>
        <p className="sf-empty-text">{missing}</p>
        {canRefresh || canEdit ? (
          <div className="sf-line">
            {canRefresh ? (
              <button type="button" className="sf-btn" data-primary="true" onClick={() => refresh.mutate()} disabled={refresh.isPending || refresh.isSuccess}>
                {refresh.isPending ? 'Refreshing' : 'Refresh from public sources'}
              </button>
            ) : null}
            {canEdit ? (
              <button ref={editRef} type="button" className="sf-btn" onClick={() => setEditing(true)} aria-label={`Add ${label} manually`}>
                Add manually
              </button>
            ) : null}
          </div>
        ) : null}
        {refresh.isSuccess ? (
          <p className="sf-status" role="status">
            Queued. Figures appear here when the public sources answer.
          </p>
        ) : null}
        {refresh.isError ? (
          <p className="sf-error" role="alert">
            {refresh.error.message}
          </p>
        ) : null}
      </div>
    );
  }
  if (!canEdit) return null;
  return (
    <button ref={editRef} type="button" className="sf-btn" onClick={() => setEditing(true)} aria-label={`Edit ${label}`} data-testid={`sf-edit-${fieldKey}`}>
      Edit
    </button>
  );
}
