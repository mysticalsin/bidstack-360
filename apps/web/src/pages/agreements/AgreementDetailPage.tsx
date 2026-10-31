// One agreement (/agreements/:id): key terms first, then the document, its
// versions, linked SOWs/amendments and the timeline. The trail keeps the path
// back shallow: Agreements › Account › Parent › This agreement.
import '@/components/drill/drill.css';
import '@/components/agreements/agreements.css';

import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { SampleBanner } from '@/components/agreements/SampleBanner';
import { MsaStatusBadge } from '@/components/agreements/StatusBadge';
import { UploadDialog } from '@/components/agreements/UploadDialog';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useMsaDetail, useMsaDownloadUrl, useMsaTimeline } from '@/hooks/useMsa';
import { ApiError } from '@/lib/api';
import { actionLabel, fmtBytes, fmtDate, fmtDays, fmtMoneyMicros, KIND_LABEL, urgency } from '@/lib/msa/labels';
import type { MsaDetail, MsaFileVersion } from '@/lib/msa/types';

function usePdfBlob(url: string | undefined, enabled: boolean) {
  // The download response is `attachment` with a sandbox CSP, so an iframe on
  // the raw URL would just download. Fetch the bytes once and preview a local
  // blob instead; this needs CORS on the download host, so fall back to links.
  const [state, setState] = useState<{ src: string | null; failed: boolean }>({ src: null, failed: false });
  useEffect(() => {
    if (!enabled || !url) return;
    let revoked: string | null = null;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal, credentials: 'omit' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
        revoked = URL.createObjectURL(blob);
        setState({ src: revoked, failed: false });
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setState({ src: null, failed: true });
      });
    return () => {
      ctrl.abort();
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [url, enabled]);
  return state;
}

function Viewer({ agreement, version, sample }: { agreement: MsaDetail; version: MsaFileVersion | null; sample: boolean }) {
  // Download links are audited on every request, so nothing loads until asked
  // for, and the signed URL is reused while it is valid.
  const [want, setWant] = useState<'preview' | 'download' | null>(null);
  const isPdf = version?.contentType === 'application/pdf';
  const link = useMsaDownloadUrl(agreement.id, version?.id, Boolean(want) && !sample);
  const url = link.data?.url;
  const preview = usePdfBlob(url, want === 'preview' && isPdf);
  if (!version) return <div className="agr-viewer-empty">No file uploaded yet.</div>;
  if (sample) {
    return (
      <div className="agr-viewer-empty" data-testid="agreement-viewer-sample">
        <Icon name="file" size={24} />
        <span><strong style={{ fontWeight: 500 }}>{version.fileName}</strong> · {fmtBytes(version.bytes)}</span>
        <span>The document preview opens here once the Agreements service is live.</span>
      </div>
    );
  }
  const href = preview.src ?? url;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {preview.src ? (
        <iframe className="agr-viewer" src={preview.src} title={`Preview of ${version.fileName}`} data-testid="agreement-viewer-frame" />
      ) : (
        <div className="agr-viewer-empty">
          <Icon name="file" size={24} />
          <span><strong style={{ fontWeight: 500 }}>{version.fileName}</strong> · v{version.versionNo} · {fmtBytes(version.bytes)}</span>
          {link.isFetching || (want === 'preview' && url && !preview.failed) ? <span>Preparing a secure link…</span> : null}
          {link.isError ? <span className="agr-error" role="alert">Couldn&apos;t get a download link. {link.error instanceof Error ? link.error.message : ''}</span> : null}
          {preview.failed ? <span data-testid="agreement-viewer-fallback">Preview isn&apos;t available from this file server. Use Download to open it.</span> : null}
          {!want ? (
            <div className="agr-actions" style={{ justifyContent: 'center' }}>
              {isPdf ? <Button variant="primary" onClick={() => setWant('preview')}><Icon name="eye" size={16} /> Preview</Button> : null}
              <Button variant="secondary" onClick={() => setWant('download')}><Icon name="download" size={16} /> Get download link</Button>
            </div>
          ) : null}
          {!isPdf ? <span>Word files can&apos;t be previewed in the browser; download to open.</span> : null}
        </div>
      )}
      {href ? (
        <div className="agr-actions" style={{ justifyContent: 'flex-start' }}>
          <a className="drill-more" href={href} download={version.fileName} data-testid="agreement-download">Download</a>
          {!preview.src && link.data ? <span className="agr-caption" style={{ fontSize: 12 }}>Link valid until {new Date(link.data.expiresAt).toLocaleTimeString()}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function AgreementDetailPage() {
  const { id } = useParams();
  const detail = useMsaDetail(id);
  const timeline = useMsaTimeline(id);
  const canWrite = useHasPermission('msa:write');
  const [search] = useSearchParams();
  // ?version= comes from a document-search hit.
  const [versionId, setVersionId] = useState<string | null>(() => search.get('version'));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  // Fixed per mount: splits the timeline into past events and upcoming dates.
  const [now] = useState(() => Date.now());

  if (detail.isLoading) return <LoadingSkeleton rows={8} />;
  if (detail.isError || !detail.data) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="agr">
        <h1 className="sr-only">Agreement</h1>
        <ErrorState title={notFound ? 'Agreement not found' : "Couldn't load this agreement"} message={notFound ? 'It may have been archived, or the link is wrong.' : 'Try again in a moment.'} action={<Link className="drill-more" to="/agreements">Back to Agreements</Link>} />
      </div>
    );
  }
  const a = detail.data.data;
  const sample = detail.data.sample;
  const version = a.versions.find((v) => v.id === versionId) ?? a.versions[0] ?? null;
  const disabledReason = sample
    ? 'Uploading is off in this Sample preview. It turns on once the Agreements service is live on this server.'
    : !canWrite ? 'You can view this agreement but not change it. Ask an admin for the "Agreements: edit" permission.' : undefined;
  const terms: Array<[string, string]> = [
    ['Type', KIND_LABEL[a.kind]],
    ['Reference', a.reference],
    ['Counterparty', a.counterparty ?? '–'],
    ['Effective', fmtDate(a.effectiveDate)],
    ['Expires', a.expiryDate ? `${fmtDate(a.expiryDate)} (${fmtDays(a.daysToExpiry)})` : 'No end date'],
    ['Renewal', a.autoRenew ? 'Renews automatically' : 'Ends unless renewed'],
    ['Notice', a.noticePeriodDays != null ? `${a.noticePeriodDays} days${a.noticeDeadline ? ` · by ${fmtDate(a.noticeDeadline)}${new Date(a.noticeDeadline).getTime() < now ? ' (passed)' : ''}` : ''}` : '–'],
    ['Liability cap', a.liabilityCap ? fmtMoneyMicros(a.liabilityCap.amountMicros, a.liabilityCap.currency) : '–'],
    ['Payment terms', a.paymentTerms ?? '–'],
    ['Governing law', a.governingLaw ?? '–'],
    ['Countries', a.countries.length ? a.countries.join(', ') : '–'],
    ['Owner', a.owner?.name ?? a.owner?.email ?? '–'],
  ];

  return (
    <div className="agr" data-testid="agreement-detail">
      <header className="agr-head">
        <div>
          <h1>{a.title}</h1>
          <div className="meta">
            <MsaStatusBadge status={a.status} />
            <span>{KIND_LABEL[a.kind]}</span>
            {a.companyId ? <Link to={`/accounts/${a.companyId}`}>{a.companyName}</Link> : null}
            {a.parent ? <span>Under <Link to={`/agreements/${a.parent.id}`} data-testid="agreement-parent">{a.parent.title}</Link></span> : null}
            {a.daysToExpiry != null ? <span className="agr-days" data-u={urgency(a.daysToExpiry)}>Expires {fmtDays(a.daysToExpiry)}</span> : null}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setUploadOpen(true)} data-testid="agreement-upload-version"><Icon name="upload" size={16} /> Upload new version</Button>
      </header>
      {sample ? <SampleBanner what="details" /> : null}

      <section className="agr-section" aria-labelledby="agr-terms">
        <h2 id="agr-terms">Key terms</h2>
        <dl className="agr-terms">
          {terms.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {a.notes ? <p className="agr-caption">{a.notes}</p> : null}
      </section>

      <div className="agr-grid">
        <section className="agr-section" aria-labelledby="agr-doc">
          <h2 id="agr-doc">Document</h2>
          <Viewer key={version?.id ?? 'none'} agreement={a} version={version} sample={sample} />
        </section>
        <section className="agr-section" aria-labelledby="agr-versions">
          <h2 id="agr-versions">Versions</h2>
          {a.versions.length === 0 ? <p className="drill-empty">No versions yet.</p> : (
            <table className="drill-table" data-testid="agreement-versions">
              <thead><tr><th scope="col">Version</th><th scope="col">Uploaded</th><th scope="col" className="num">Size</th></tr></thead>
              <tbody>
                {a.versions.map((v) => (
                  <tr key={v.id} aria-current={v.id === version?.id ? 'true' : undefined}>
                    <td>
                      <button type="button" className="drill-link" onClick={() => setVersionId(v.id)} aria-pressed={v.id === version?.id}>v{v.versionNo}{v === a.versions[0] ? ' · latest' : ''}</button>
                      <span className="drill-sub">{v.note ?? v.fileName}</span>
                    </td>
                    <td>{fmtDate(v.createdAt)}<span className="drill-sub">{v.createdBy?.name ?? v.createdBy?.email ?? ''}</span></td>
                    <td className="num">{fmtBytes(v.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {a.kind === 'msa' || a.kind === 'framework' || a.children.length ? (
        <section className="agr-section" aria-labelledby="agr-children">
          <div className="agr-head" style={{ alignItems: 'center' }}>
            <h2 id="agr-children" style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>SOWs and amendments</h2>
            <button type="button" className="drill-more" onClick={() => setChildOpen(true)}>Add SOW or amendment</button>
          </div>
          {a.children.length === 0 ? <p className="drill-empty">Nothing linked under this agreement yet.</p> : (
            <table className="drill-table" data-testid="agreement-children">
              <thead><tr><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Expires</th></tr></thead>
              <tbody>
                {a.children.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/agreements/${c.id}`}>{c.title}</Link><span className="drill-sub">{KIND_LABEL[c.kind]} · {c.reference}</span></td>
                    <td><MsaStatusBadge status={c.status} /></td>
                    <td>{fmtDate(c.expiryDate)}{c.daysToExpiry != null ? <span className="drill-sub">{fmtDays(c.daysToExpiry)}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      <section className="agr-section" aria-labelledby="agr-timeline">
        <h2 id="agr-timeline">Timeline and audit</h2>
        <p className="agr-caption">Changes, uploads and downloads, plus upcoming dates.</p>
        {timeline.isLoading ? <LoadingSkeleton rows={3} /> : (timeline.data?.data ?? []).length === 0 ? <p className="drill-empty">No activity yet.</p> : (
          <ol className="agr-timeline" data-testid="agreement-timeline">
            {(timeline.data?.data ?? []).map((e) => (
              <li key={e.id} data-future={Date.parse(e.at) > now ? 'true' : undefined}>
                <time dateTime={e.at}>{fmtDate(e.at)}</time>
                <span>
                  <span className="w">{actionLabel(e.action, e.detail)}</span>
                  <span className="drill-sub">{e.kind === 'milestone' ? (Date.parse(e.at) > now ? 'Upcoming' : 'Date reached') : e.actor?.name ?? e.actor?.email ?? 'System'}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} target={{ mode: 'version', agreementId: a.id, title: a.title }} disabledReason={disabledReason} />
      <UploadDialog open={childOpen} onOpenChange={setChildOpen} target={{ mode: 'new', companyId: a.companyId ?? undefined, parentId: a.id, kind: 'sow' }} disabledReason={disabledReason} />
    </div>
  );
}
