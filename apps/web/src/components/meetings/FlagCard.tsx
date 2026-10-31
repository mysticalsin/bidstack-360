// One cross-region flag: "a colleague met someone at a sister account; here is
// why it matters to yours". Restricted accounts are named "Restricted company"
// by the API and never link to the meeting.
import './meetings.css';

import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { agoLabel, type CrossRegionFlagOut } from '@/lib/meeting-intel/client';

export function FlagCard({ flag, focus, onDismiss, dismissing }: {
  flag: CrossRegionFlagOut; focus?: boolean; onDismiss?: (id: string) => void; dismissing?: boolean;
}) {
  return (
    <li className="mi-flag" data-focus={focus ? 'true' : undefined} data-testid="meeting-flag" id={`flag-${flag.id}`}>
      <span className="mi-row-meta">
        <span className="mi-chip" data-tone="senior">Opportunity</span>
        <span>{flag.parentCompanyName} group</span>
        <span aria-hidden>·</span>
        <time dateTime={flag.createdAt}>{agoLabel(flag.createdAt)}</time>
        {flag.status === 'dismissed' ? <span className="mi-chip">Dismissed</span> : null}
      </span>
      <p className="mi-row-title" style={{ margin: 0 }}>{flag.reason}</p>
      {flag.talkingPoints.length ? (
        <ul aria-label="Talking points">{flag.talkingPoints.map((t) => <li key={t}>{t}</li>)}</ul>
      ) : null}
      <div className="mi-flag-actions">
        {flag.companyRestricted ? (
          <Link className="mi-link" to={`/meetings/${flag.meetingId}?flag=${flag.id}`}>Open meeting (account details hidden)</Link>
        ) : (
          <Link className="mi-link" to={`/meetings/${flag.meetingId}?flag=${flag.id}`}>Open meeting at {flag.companyName}</Link>
        )}
        <Link className="mi-link" to={`/accounts/${flag.ownedCompanyId}`}>Your account: {flag.ownedCompanyName}</Link>
        {onDismiss && flag.status === 'open' ? (
          <Button variant="ghost" size="sm" onClick={() => onDismiss(flag.id)} disabled={dismissing}>Dismiss</Button>
        ) : null}
      </div>
    </li>
  );
}
