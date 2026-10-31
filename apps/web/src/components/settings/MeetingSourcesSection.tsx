// Settings → Meeting sources. Métis is per user and consent first: summaries
// only unless you also tick transcripts; the ingest token is shown ONCE and
// only its hash is stored. ABC is org-wide; this tab can trigger a sync (the
// ABC adapter is mocked until its API details are known).
import '@/components/meetings/meetings.css';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useConnectMetis, useMeetingSources, useRevokeMetis, useSyncAbc } from '@/hooks/useMeetingIntel';
import { ApiError } from '@/lib/api';
import { agoLabel, type MeetingSourceStatus } from '@/lib/meeting-intel/client';

const STATUS: Record<MeetingSourceStatus['status'], string> = {
  connected: 'Connected', not_connected: 'Not connected', revoked: 'Revoked', error: 'Error', not_configured: 'Not configured',
};

function Counts({ s }: { s: MeetingSourceStatus }) {
  return (
    <span className="mi-row-meta">
      <span className="mi-chip" data-tone={s.status === 'connected' ? 'senior' : s.status === 'error' ? 'amber' : undefined}>{STATUS[s.status]}</span>
      {s.lastSyncAt ? <span>Last sync {agoLabel(s.lastSyncAt)}</span> : <span>Never synced</span>}
      <span>· {s.itemsReceived} received · {s.pending} pending · {s.unmatched} unmatched</span>
    </span>
  );
}

function MetisCard({ s, canWrite }: { s: MeetingSourceStatus | undefined; canWrite: boolean }) {
  const connect = useConnectMetis();
  const revoke = useRevokeMetis();
  const [consent, setConsent] = useState(false);
  const [transcripts, setTranscripts] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const connected = s?.status === 'connected';
  return (
    <section className="mi-section" aria-labelledby="mi-metis-h" data-testid="metis-source">
      <div className="mi-head">
        <h2 id="mi-metis-h">Métis (your second brain)</h2>
        {s ? <Counts s={s} /> : null}
      </div>
      <p className="mi-caption">Share meetings from your own Métis with Polo so your account teams see who you met and what was raised. Only you can connect or revoke it. Meetings marked confidential in Métis are never accepted.</p>
      {token ? (
        <div role="status" data-testid="metis-token" style={{ display: 'grid', gap: 8 }}>
          <p className="mi-row-title" style={{ margin: 0 }}>Copy this token now. It is shown once and Polo keeps only its fingerprint.</p>
          <code className="mi-token">{token}</code>
          <div className="mi-flag-actions">
            <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(token).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy token'}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setToken(null); setCopied(false); }}>I have saved it</Button>
          </div>
          <p className="mi-caption" style={{ fontSize: 13 }}>Paste it into Métis as the Polo ingest token (POST /api/v1/meeting-intel/ingest/metis with Authorization: Bearer).</p>
        </div>
      ) : connected ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p className="mi-caption">
            Sharing summaries{s?.shareTranscript ? ' and transcripts' : ' only (no transcripts)'}. Token {s?.tokenPrefix ? <code>{s.tokenPrefix}…</code> : null}
          </p>
          <div className="mi-flag-actions">
            <Button variant="destructive" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate()}>{revoke.isPending ? 'Revoking…' : 'Revoke access'}</Button>
            <span className="mi-row-meta">The token stops working immediately. Meetings already shared stay.</span>
          </div>
        </div>
      ) : (
        <form className="mi-form" onSubmit={async (e) => {
          e.preventDefault();
          const r = await connect.mutateAsync(transcripts).catch(() => null);
          if (r) setToken(r.token);
        }}>
          <label className="mi-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
            <span>I agree to share meeting titles, dates, attendees and summaries for accounts in Polo.</span></label>
          <label className="mi-check"><input type="checkbox" checked={transcripts} onChange={(e) => setTranscripts(e.target.checked)} disabled={!consent} />
            <span>Also share full transcripts (optional, off by default). Visible to people who can open the meeting.</span></label>
          {connect.isError ? <p className="mi-caption" role="alert">{connect.error instanceof ApiError && connect.error.status === 403 ? 'You need meetings:write to connect Métis.' : "Couldn't connect. Try again."}</p> : null}
          <div><Button type="submit" disabled={!consent || !canWrite || connect.isPending} title={canWrite ? undefined : 'You need meetings:write'}>{connect.isPending ? 'Connecting…' : s?.status === 'revoked' ? 'Reconnect Métis' : 'Connect Métis'}</Button></div>
        </form>
      )}
    </section>
  );
}

function AbcCard({ s, canWrite }: { s: MeetingSourceStatus | undefined; canWrite: boolean }) {
  const sync = useSyncAbc();
  return (
    <section className="mi-section" aria-labelledby="mi-abc-h" data-testid="abc-source">
      <div className="mi-head">
        <h2 id="mi-abc-h">ABC CRM (organisation)</h2>
        {s ? <Counts s={s} /> : null}
      </div>
      <p className="mi-caption">Pulls meetings, notes and next steps from ABC for the whole organisation, hourly. The ABC connector is a mock until its API and account ids are confirmed, so a sync may bring nothing in yet.</p>
      {s?.lastError ? <p className="mi-caption" role="status">Last error: {s.lastError}</p> : null}
      <div className="mi-flag-actions">
        <Button variant="secondary" size="sm" onClick={() => sync.mutate()} disabled={!canWrite || sync.isPending} data-testid="abc-sync" title={canWrite ? undefined : 'You need meetings:write'}>
          {sync.isPending ? 'Starting…' : 'Sync now'}
        </Button>
        {sync.isSuccess ? <span className="mi-row-meta" role="status">{sync.data.queued ? 'Sync queued. Results appear as the worker processes them.' : 'Sync requested, but the queue is unavailable right now.'}</span> : null}
        {sync.isError ? <span className="mi-row-meta" role="alert">Couldn&apos;t start a sync.</span> : null}
      </div>
    </section>
  );
}

export function MeetingSourcesSection() {
  const q = useMeetingSources();
  const canWrite = useHasPermission('meetings:write');
  if (q.isLoading) return <p className="mi-empty">Loading sources…</p>;
  if (q.isError) return <p className="mi-empty" role="alert">Meeting sources are unavailable{q.error instanceof ApiError && q.error.status === 403 ? ': you need meetings:read.' : '.'}</p>;
  const items = q.data?.items ?? [];
  return (
    <div style={{ display: 'grid', gap: 24 }} id="meeting-sources">
      <MetisCard s={items.find((i) => i.source === 'metis')} canWrite={canWrite} />
      <AbcCard s={items.find((i) => i.source === 'abc')} canWrite={canWrite} />
    </div>
  );
}
