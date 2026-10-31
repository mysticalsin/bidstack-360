// /meetings/:id: one meeting in depth. Summary and what was learned first,
// then who was there (with org-chart links), then sources and the transcript
// (only present when the Métis user consented).
import '@/components/meetings/meetings.css';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useFlagMeeting, useMeeting, usePatchMeeting } from '@/hooks/useMeetingIntel';
import { ApiError } from '@/lib/api';
import { fmtMeetingDate, SENIOR_LEVELS, SENIORITY_LABEL, SOURCE_LABEL, type MeetingIntelDetail } from '@/lib/meeting-intel/client';

function ListBlock({ title, items, testId }: { title: string; items: string[]; testId?: string }) {
  if (!items.length) return null;
  return (
    <div data-testid={testId}>
      <h3 style={{ fontSize: 14, fontWeight: 500, margin: '0 0 8px', color: 'var(--fg-primary)' }}>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4, fontSize: 14, color: 'var(--fg-secondary)' }}>
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

function Attendees({ m }: { m: Pick<MeetingIntelDetail, 'attendees'> }) {
  const ext = m.attendees.filter((a) => !a.isInternal);
  const ours = m.attendees.filter((a) => a.isInternal);
  const names = new Map(m.attendees.filter((a) => a.contactId).map((a) => [a.contactId!, a.name]));
  return (
    <section className="mi-section" aria-labelledby="mi-att-h">
      <h2 id="mi-att-h" style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Who was there</h2>
      {ext.length === 0 ? <p className="mi-empty">No client attendees recorded.</p> : (
        <table className="mi-table" data-testid="meeting-attendees">
          <thead><tr><th scope="col">Name</th><th scope="col">Seniority</th><th scope="col" className="mi-hide-sm">Region · BU</th><th scope="col" className="mi-hide-sm">Reports to</th></tr></thead>
          <tbody>
            {ext.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.contactId ? <Link to={`/contacts/${a.contactId}`}>{a.name}</Link> : a.name}
                  {a.title ? <span className="drill-sub" style={{ display: 'block', fontSize: 12, color: 'var(--fg-tertiary)' }}>{a.title}</span> : null}
                </td>
                <td><span className="mi-chip" data-tone={SENIOR_LEVELS.has(a.seniority) ? 'senior' : undefined}>{SENIORITY_LABEL[a.seniority]}</span></td>
                <td className="mi-hide-sm">{[a.region, a.businessUnit].filter(Boolean).join(' · ') || '–'}</td>
                <td className="mi-hide-sm">{a.reportsToContactId ? <Link to={`/contacts/${a.reportsToContactId}`}>{names.get(a.reportsToContactId) ?? 'View manager'}</Link> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ours.length ? <p className="mi-caption" style={{ fontSize: 13 }}>From our side: {ours.map((a) => a.name).join(', ')}</p> : null}
    </section>
  );
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const flagId = useSearchParams()[0].get('flag') ?? undefined;
  // From a flag: read through the flag grant (works even when the meeting is
  // team-only or in another region). Otherwise the normal visibility rules.
  const direct = useMeeting(flagId ? undefined : id);
  const viaFlag = useFlagMeeting(flagId);
  const q = flagId ? viaFlag : direct;
  const flagView = flagId ? viaFlag.data : undefined;
  const patch = usePatchMeeting(id ?? '');
  const [showTranscript, setShowTranscript] = useState(false);
  if (q.isLoading) return <LoadingSkeleton rows={6} />;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return <ErrorState title="Meeting not found" message="It may be archived, or visible only to its account team." action={<Link className="mi-link" to="/meetings">Back to meetings</Link>} />;
  }
  if (q.isError || !q.data) return <ErrorState title="Couldn't load this meeting" action={<Button variant="secondary" onClick={() => void q.refetch()}>Retry</Button>} />;
  const m = q.data;
  const nothingLearned = !m.challenges.length && !m.opportunities.length && !m.similarProjects.length && !m.nextSteps.length;
  return (
    <div className="mi-page" data-testid="meeting-detail">
      <header className="mi-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>{m.title}</h1>
          <p className="mi-meta" style={{ marginTop: 8 }}>
            <time dateTime={m.heldAt}>{fmtMeetingDate(m.heldAt)}</time>
            <span aria-hidden>·</span>
            {m.companyId ? <Link to={`/accounts/${m.companyId}`}>{m.companyName}</Link> : <span>{m.companyName}</span>}
            <span aria-hidden>·</span>
            <span>{m.sources.map((s) => SOURCE_LABEL[s]).join(', ')}</span>
            <span className="mi-chip">{m.visibility === 'org' ? 'Visible to the organisation' : 'Account team only'}</span>
            {flagView ? <span className="mi-chip" data-testid="meeting-flag-access">Shared with you by a flag</span> : null}
          </p>
          {flagView?.companyRestricted ? (
            <p className="mi-caption" style={{ marginTop: 8 }}>This account is outside your access, so its name, contacts, summary and transcript are hidden. Ask its account team for more.</p>
          ) : null}
        </div>
        {flagView ? null : <Button variant="secondary" size="sm" disabled={patch.isPending}
          onClick={() => patch.mutate({ visibility: m.visibility === 'org' ? 'account_team' : 'org' })}>
          {m.visibility === 'org' ? 'Limit to account team' : 'Share with organisation'}
        </Button>}
      </header>
      {patch.isError ? <p className="mi-caption" role="alert">Only the author or the account team can change this meeting.</p> : null}

      <section className="mi-section" aria-labelledby="mi-sum-h">
        <h2 id="mi-sum-h" style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>What we learned</h2>
        {m.summary ? <p className="mi-caption" style={{ color: 'var(--fg-primary)' }}>{m.summary}</p> : null}
        {nothingLearned && !m.summary ? <p className="mi-empty">No notes captured for this meeting.</p> : (
          <div className="mi-grid">
            <ListBlock title="Challenges" items={m.challenges} testId="meeting-challenges" />
            <ListBlock title="Opportunities" items={m.opportunities} />
            <ListBlock title="Similar projects" items={m.similarProjects} />
            <ListBlock title="Next steps" items={m.nextSteps} />
          </div>
        )}
      </section>

      <Attendees m={m} />

      <section className="mi-section" aria-labelledby="mi-src-h">
        <h2 id="mi-src-h" style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Sources</h2>
        <ul className="mi-list">
          {m.sourceLinks.map((s, i) => (
            <li key={`${s.source}-${s.externalId ?? ''}-${i}`}>
              <span className="mi-row-title">{SOURCE_LABEL[s.source]}</span>
              <span className="mi-row-meta">
                Added {fmtMeetingDate(s.ingestedAt)}
                {s.url ? <a className="mi-link" href={s.url} target="_blank" rel="noreferrer">Open in {SOURCE_LABEL[s.source]} <ExternalLink size={13} strokeWidth={1.5} aria-hidden /></a> : null}
              </span>
            </li>
          ))}
        </ul>
        {m.transcript ? (
          <div>
            <button type="button" className="mi-link" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
              {showTranscript ? 'Hide transcript' : 'Show transcript (shared with consent)'}
            </button>
            {showTranscript ? <pre className="mi-transcript" data-testid="meeting-transcript">{m.transcript}</pre> : null}
          </div>
        ) : (
          <p className="mi-caption" style={{ fontSize: 13 }}>No transcript stored. Transcripts are kept only when a Métis user opts in.</p>
        )}
      </section>
    </div>
  );
}
