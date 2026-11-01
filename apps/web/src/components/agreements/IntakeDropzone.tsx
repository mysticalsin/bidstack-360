import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useHasPermission } from '@/hooks/useCapabilities';
import { useUploadMsaIntake } from '@/hooks/useMsaIntake';
import { validateMsaFile, type UploadStage } from '@/lib/msa/client';

const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function IntakeDropzone({ disabledReason }: { disabledReason?: string }) {
  const id = useId();
  const navigate = useNavigate();
  const canWrite = useHasPermission('msa:write');
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const upload = useUploadMsaIntake((s) => setStage(s));
  const blocked = disabledReason || !canWrite;

  const take = async (files: FileList | File[]) => {
    if (blocked) return;
    const list = [...files];
    if (list.length === 0) return;
    setError(null);
    const ids: string[] = [];
    try {
      for (const file of list) {
        const v = validateMsaFile(file);
        if ('error' in v) {
          setError(v.error);
          return;
        }
        const draft = await upload.mutateAsync(file);
        ids.push(draft.id);
      }
      setQueue(ids);
      navigate(`/agreements/intake/${ids[0]}${ids.length > 1 ? `?queue=${ids.slice(1).join(',')}` : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setStage(null);
    }
  };

  return (
    <section className="agr-section agr-intake" aria-labelledby={`${id}-h`} data-testid="msa-intake-dropzone">
      <h2 id={`${id}-h`}>Drop signed MSAs</h2>
      <p className="agr-caption">PDF or Word. Several files at once. We extract the text layer, match the client, and wait for your review. Nothing is saved until you confirm.</p>
      <div
        className="agr-drop agr-drop-lg"
        data-over={over || undefined}
        onDragOver={(e) => { e.preventDefault(); if (!blocked) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!blocked) void take(e.dataTransfer.files); }}
      >
        <label htmlFor={`${id}-file`} style={{ cursor: blocked ? 'not-allowed' : 'pointer' }}>
          <strong style={{ fontWeight: 500, display: 'block', fontSize: 16 }}>Drop PDF or DOCX files here</strong>
          <span>or choose files. Up to 25 MB each.</span>
        </label>
        <input
          id={`${id}-file`}
          type="file"
          className="sr-only"
          accept={ACCEPT}
          multiple
          disabled={Boolean(blocked) || upload.isPending}
          onChange={(e) => { if (e.target.files) void take(e.target.files); e.target.value = ''; }}
        />
      </div>
      {blocked ? <p className="agr-sample">{disabledReason ?? 'You can view agreements but not upload them.'}</p> : null}
      {stage ? <p className="agr-caption" aria-live="polite">Working: {stage}{queue.length ? ` · ${queue.length} ready` : ''}</p> : null}
      {error ? <p className="agr-error" role="alert">{error}</p> : null}
      {upload.isPending ? <p className="agr-caption">Reading the file and extracting fields…</p> : null}
    </section>
  );
}
