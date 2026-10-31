// The people behind one coverage cell: who, their title and BU, who they report
// to (org chart, when the contact is linked) and when and where we last met them.
import './meetings.css';

import { Link } from 'react-router-dom';

import { useMeetingDetails, useMeetingList } from '@/hooks/useMeetingIntel';
import { fmtMeetingDate, SENIORITY_LABEL, type MeetingIntelDetail } from '@/lib/meeting-intel/client';
import { collectPeople, type CellRef } from '@/lib/meeting-intel/people';


const MAX_MEETINGS = 12;

export function PeopleDrill({ groupId, cell, onLog }: { groupId: string; cell: CellRef; onLog?: () => void }) {
  const list = useMeetingList({ groupId, seniority: cell.seniority, limit: MAX_MEETINGS });
  const ids = (list.data?.items ?? []).map((r) => r.id);
  const details = useMeetingDetails(ids);
  const loaded = details.map((d) => d.data).filter((d): d is MeetingIntelDetail => Boolean(d));
  const people = collectPeople(loaded, cell);
  const loading = list.isLoading || details.some((d) => d.isLoading);
  const names = new Map(loaded.flatMap((m) => m.attendees).filter((a) => a.contactId).map((a) => [a.contactId!, a.name]));
  const label = `${SENIORITY_LABEL[cell.seniority]} in ${cell.region}`;
  return (
    <div data-testid="people-drill" aria-live="polite">
      <h3 className="mi-row-title" style={{ margin: '0 0 8px' }}>{label}</h3>
      {loading ? <p className="mi-empty">Loading people…</p> : list.isError ? (
        <p className="mi-empty" role="alert">Couldn&apos;t load these meetings.</p>
      ) : people.length === 0 ? (
        <p className="mi-empty">
          Nobody at this level met in {cell.region} yet.{' '}
          {onLog ? <button type="button" className="mi-link" onClick={onLog}>Log a meeting</button> : null}
        </p>
      ) : (
        <ul className="mi-list">
          {people.map((p, i) => (
            <li key={p.key} className="mi-arrive" style={{ '--i': Math.min(i, 5) } as React.CSSProperties}>
              {p.contactId ? <Link className="mi-row-title" to={`/contacts/${p.contactId}`}>{p.name}</Link> : <span className="mi-row-title">{p.name}</span>}
              <span className="mi-row-meta">
                {[p.title, p.businessUnit].filter(Boolean).join(' · ') || SENIORITY_LABEL[cell.seniority]}
                {p.reportsToContactId ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>Reports to <Link to={`/contacts/${p.reportsToContactId}`}>{names.get(p.reportsToContactId) ?? 'manager'}</Link></span>
                  </>
                ) : null}
              </span>
              <span className="mi-row-meta">
                Last met {fmtMeetingDate(p.lastMet)} in <Link to={`/meetings/${p.meetingId}`}>{p.meetingTitle}</Link>
                {p.meetings > 1 ? <span>· {p.meetings} meetings</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
