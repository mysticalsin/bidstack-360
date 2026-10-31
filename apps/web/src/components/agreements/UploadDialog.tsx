// Upload flow for a new agreement or a new version of an existing one:
// pick or drop a PDF/DOCX (≤25 MB) → [create the agreement] → upload-url →
// PUT the bytes → finalize. Each step is shown so a slow upload never looks
// stuck, and a failure says which step failed.
import './agreements.css';

import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { useCompanies } from '@/hooks/useCompanies';
import { useCreateMsa, useUploadMsaVersion } from '@/hooks/useMsa';
import { validateMsaFile, type UploadStage } from '@/lib/msa/client';
import { fmtBytes, KIND_LABEL, STATUS_LABEL } from '@/lib/msa/labels';
import { MSA_KINDS, MSA_STATUSES, type MsaKind, type MsaStatus } from '@/lib/msa/types';

const STEPS: Array<{ id: UploadStage | 'creating'; label: string }> = [
  { id: 'creating', label: 'Create record' },
  { id: 'requesting', label: 'Prepare upload' },
  { id: 'uploading', label: 'Upload file' },
  { id: 'finalizing', label: 'Verify and save' },
];

type Target = { mode: 'version'; agreementId: string; title: string } | { mode: 'new'; companyId?: string; parentId?: string; kind?: MsaKind };

export function UploadDialog({ open, onOpenChange, target, disabledReason }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  /** When set (e.g. Sample mode or no msa:write), the form explains why it is off. */
  disabledReason?: string;
}) {
  const id = useId();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<UploadStage | 'creating' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isNew = target.mode === 'new';
  const [title, setTitle] = useState('');
  const [companyId, setCompanyId] = useState(isNew ? target.companyId ?? '' : '');
  const [kind, setKind] = useState<MsaKind>(isNew ? target.kind ?? 'msa' : 'msa');
  const [status, setStatus] = useState<MsaStatus>('draft');
  const [effective, setEffective] = useState('');
  const [expiry, setExpiry] = useState('');
  const [notice, setNotice] = useState('');
  const companies = useCompanies();
  const create = useCreateMsa();
  const upload = useUploadMsaVersion((s) => setStage(s));
  const busy = stage !== null && stage !== 'done' && !error;

  const pick = (f: File | undefined) => {
    if (!f) return;
    const v = validateMsaFile(f);
    setFile('error' in v ? null : f);
    setFileError('error' in v ? v.error : null);
  };

  const reset = () => { setFile(null); setFileError(null); setNote(''); setStage(null); setError(null); setTitle(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (disabledReason || busy) return;
    setError(null);
    try {
      let agreementId = target.mode === 'version' ? target.agreementId : '';
      if (target.mode === 'new') {
        setStage('creating');
        const row = await create.mutateAsync({
          companyId, kind, title: title.trim(), status, parentId: target.parentId ?? null,
          effectiveDate: effective ? new Date(`${effective}T00:00:00Z`).toISOString() : null,
          expiryDate: expiry ? new Date(`${expiry}T00:00:00Z`).toISOString() : null,
          noticePeriodDays: notice ? Number(notice) : null,
        });
        agreementId = row.id;
      }
      if (file) await upload.mutateAsync({ id: agreementId, file, note: note.trim() || null });
      setStage('done');
      onOpenChange(false);
      reset();
      if (target.mode === 'new') navigate(`/agreements/${agreementId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const canSubmit = !disabledReason && !busy && (target.mode === 'version' ? Boolean(file) : Boolean(title.trim() && companyId));
  const steps = STEPS.filter((s) => (isNew ? true : s.id !== 'creating')).filter((s) => file || s.id === 'creating');
  const order = steps.map((s) => s.id);
  const at = stage ? order.indexOf(stage === 'validating' ? 'requesting' : stage) : -1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent
        title={target.mode === 'version' ? 'Upload a new version' : 'New agreement'}
        description={target.mode === 'version' ? target.title : 'Add an MSA, framework, SOW or amendment, with its signed file.'}
        data-testid="agreement-upload-dialog"
      >
        <form className="agr-form" onSubmit={submit} aria-describedby={disabledReason ? `${id}-off` : undefined}>
          {disabledReason ? <p id={`${id}-off`} className="agr-sample">{disabledReason}</p> : null}
          {isNew ? (
            <>
              <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} disabled={Boolean(disabledReason)} /></label>
              <div className="row">
                <label>Account
                  <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required disabled={Boolean(disabledReason) || Boolean(target.companyId)}>
                    <option value="">Choose an account</option>
                    {(companies.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label>Type
                  <select value={kind} onChange={(e) => setKind(e.target.value as MsaKind)} disabled={Boolean(disabledReason)}>
                    {MSA_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </label>
              </div>
              <div className="row">
                <label>Status
                  <select value={status} onChange={(e) => setStatus(e.target.value as MsaStatus)} disabled={Boolean(disabledReason)}>
                    {MSA_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
                <label>Notice period (days)<input type="number" min={0} max={3650} inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} disabled={Boolean(disabledReason)} /></label>
              </div>
              <div className="row">
                <label>Effective date<input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} disabled={Boolean(disabledReason)} /></label>
                <label>Expiry date<input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={Boolean(disabledReason)} /></label>
              </div>
            </>
          ) : null}
          <div
            className="agr-drop"
            data-over={over || undefined}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabledReason) pick(e.dataTransfer.files[0]); }}
          >
            <label htmlFor={`${id}-file`} style={{ cursor: 'pointer' }}>
              {file ? (
                <span><strong style={{ fontWeight: 500 }}>{file.name}</strong> · {fmtBytes(file.size)}</span>
              ) : (
                <span>Drop a PDF or Word file here, or <u>choose a file</u>. Up to 25 MB.</span>
              )}
            </label>
            <input
              id={`${id}-file`}
              type="file"
              className="sr-only"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => pick(e.target.files?.[0])}
              disabled={Boolean(disabledReason)}
              aria-describedby={fileError ? `${id}-ferr` : undefined}
            />
          </div>
          {fileError ? <p id={`${id}-ferr`} className="agr-error" role="alert">{fileError}</p> : null}
          {file ? <label>Version note (optional)<textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label> : null}
          {stage ? (
            <ol className="agr-steps" aria-label="Upload progress" aria-live="polite">
              {steps.map((s, i) => (
                <li key={s.id} data-state={stage === 'done' || i < at ? 'done' : i === at ? 'active' : 'todo'}>
                  {stage === 'done' || i < at ? '✓ ' : ''}{s.label}
                </li>
              ))}
            </ol>
          ) : null}
          {error ? <p className="agr-error" role="alert">{error}</p> : null}
          <div className="agr-actions">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {busy ? 'Uploading…' : target.mode === 'version' ? 'Upload version' : file ? 'Create and upload' : 'Create agreement'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
