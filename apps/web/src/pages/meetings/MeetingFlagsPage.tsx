// /meetings/flags (and /meeting-intel/flags/:id from notifications): meetings
// at sister accounts that matter to the accounts you own.
import '@/components/drill/drill.css';
import '@/components/meetings/meetings.css';

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { FlagCard } from '@/components/meetings/FlagCard';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useDismissFlag, useMeetingFlags } from '@/hooks/useMeetingIntel';

import { MeetingsTabs } from './MeetingsTabs';

type Status = 'open' | 'dismissed';

export default function MeetingFlagsPage() {
  const { flagId } = useParams();
  const [status, setStatus] = useState<Status>('open');
  const flags = useMeetingFlags(flagId ? 'all' : status);
  const dismiss = useDismissFlag();
  const items = (flags.data?.items ?? []).filter((f) => (flagId ? true : f.status === status));
  const ordered = flagId ? [...items].sort((a, b) => Number(b.id === flagId) - Number(a.id === flagId)) : items;

  useEffect(() => {
    if (flagId && flags.data) document.getElementById(`flag-${flagId}`)?.scrollIntoView?.({ block: 'center' });
  }, [flagId, flags.data]);

  return (
    <div className="mi-page" data-testid="meeting-flags-page">
      <header className="mi-head">
        <div>
          <h1>Meetings</h1>
          <p className="mi-caption" style={{ marginTop: 8 }}>Colleagues met people at sister accounts of yours. Each flag says why it matters and what to ask.</p>
        </div>
      </header>
      <MeetingsTabs />
      {!flagId ? (
        <div className="drill-seg" role="group" aria-label="Flag status" style={{ width: 'fit-content' }}>
          {(['open', 'dismissed'] as Status[]).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'open' ? 'Open' : 'Dismissed'}</button>
          ))}
        </div>
      ) : null}
      {flags.isLoading ? <LoadingSkeleton rows={3} /> : flags.isError ? (
        <ErrorState title="Couldn't load flags" action={<Button variant="secondary" onClick={() => void flags.refetch()}>Retry</Button>} />
      ) : ordered.length === 0 ? (
        <p className="mi-empty">{status === 'open' ? 'No open flags. When a colleague meets someone at a sister account, it shows up here.' : 'Nothing dismissed.'}</p>
      ) : (
        <ul className="mi-flags">
          {ordered.map((f) => (
            <FlagCard key={f.id} flag={f} focus={f.id === flagId} onDismiss={(id) => dismiss.mutate(id)} dismissing={dismiss.isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}
