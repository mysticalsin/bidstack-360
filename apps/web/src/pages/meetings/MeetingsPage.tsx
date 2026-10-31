// /meetings: every meeting you can open, newest first. Filters live in the URL
// so the account card's "All meetings" and coverage drills deep-link here.
import '@/components/drill/drill.css';
import '@/components/meetings/meetings.css';

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { LogMeetingDialog } from '@/components/meetings/LogMeetingDialog';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useCompany } from '@/hooks/useCompanies';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useMeetingList } from '@/hooks/useMeetingIntel';
import {
  fmtMeetingDate, SENIOR_LEVELS, SENIORITY_LABEL, SENIORITY_SHORT, SOURCE_LABEL,
  type MeetingListQuery, type MeetingSource, type SeniorityLevel,
} from '@/lib/meeting-intel/client';

import { MeetingsTabs } from './MeetingsTabs';

const LEVELS: SeniorityLevel[] = ['c_level', 'vp', 'director', 'manager', 'ic', 'unknown'];
const SOURCES: MeetingSource[] = ['manual', 'metis', 'abc'];
const PAGE = 50;

export default function MeetingsPage() {
  const [params, setParams] = useSearchParams();
  const groupId = params.get('groupId') ?? undefined;
  const companyId = params.get('companyId') ?? undefined;
  const scopeId = groupId ?? companyId;
  const company = useCompany(scopeId);
  const [qText, setQText] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(qText.trim(), 300);
  const cursor = Number(params.get('cursor') ?? 0) || 0;
  const query: MeetingListQuery = {
    groupId, companyId,
    source: (params.get('source') as MeetingSource) || undefined,
    seniority: (params.get('seniority') as SeniorityLevel) || undefined,
    q: q.length ? q : undefined,
    limit: PAGE,
    cursor,
  };
  const list = useMeetingList(query);
  const canWrite = useHasPermission('meetings:write');
  const [logOpen, setLogOpen] = useState(false);
  const setParam = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    next.delete('cursor');
    setParams(next, { replace: true });
  };
  const rows = list.data?.items ?? [];
  const companyName = company.data?.name;

  return (
    <div className="mi-page" data-testid="meetings-page">
      <header className="mi-head">
        <div>
          <h1>Meetings</h1>
          <p className="mi-caption" style={{ marginTop: 8 }}>Who we met, what they raised, and what we promised next.</p>
        </div>
        {companyId || groupId ? (
          <Button onClick={() => setLogOpen(true)} disabled={!canWrite} title={canWrite ? undefined : 'You need meetings:write'}>Log a meeting</Button>
        ) : null}
      </header>
      <MeetingsTabs />
      <div className="mi-filters">
        <input type="search" aria-label="Search meetings" placeholder="Search title, summary or challenge" value={qText}
          onChange={(e) => { setQText(e.target.value); }} maxLength={200} />
        <select aria-label="Seniority" value={params.get('seniority') ?? ''} onChange={(e) => setParam('seniority', e.target.value || undefined)}>
          <option value="">Any seniority</option>
          {LEVELS.map((l) => <option key={l} value={l}>{SENIORITY_LABEL[l]}</option>)}
        </select>
        <select aria-label="Source" value={params.get('source') ?? ''} onChange={(e) => setParam('source', e.target.value || undefined)}>
          <option value="">Any source</option>
          {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
        {scopeId ? (
          <span className="mi-chip" data-tone="senior">
            {groupId ? 'Group' : 'Account'}: {companyName ?? '…'}
            <button type="button" aria-label="Clear account filter" style={{ marginLeft: 8 }} onClick={() => { const n = new URLSearchParams(params); n.delete('groupId'); n.delete('companyId'); setParams(n, { replace: true }); }}>×</button>
          </span>
        ) : null}
      </div>

      {list.isLoading ? <LoadingSkeleton rows={5} /> : list.isError ? (
        <ErrorState title="Couldn't load meetings" message="Check your connection, or that you have meetings:read." action={<Button variant="secondary" onClick={() => void list.refetch()}>Retry</Button>} />
      ) : rows.length === 0 ? (
        <p className="mi-empty">
          {q || params.get('seniority') || params.get('source') ? 'No meetings match these filters.' : 'No meetings yet. Log one from an account page, or connect Métis or ABC in Settings.'}{' '}
          <Link to="/settings?tab=meeting-sources">Meeting sources</Link>
        </p>
      ) : (
        <section className="mi-section" aria-label="Meetings">
          <table className="mi-table" data-testid="meetings-table">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Meeting</th><th scope="col">Most senior</th><th scope="col" className="mi-hide-sm">People</th><th scope="col" className="mi-hide-sm">Source</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><time dateTime={m.heldAt}>{fmtMeetingDate(m.heldAt)}</time></td>
                  <td>
                    <Link to={`/meetings/${m.id}`}>{m.title}</Link>
                    <span className="drill-sub">{m.companyName}{m.challenges.length ? ` · ${m.challenges.slice(0, 2).join(', ')}` : ''}</span>
                  </td>
                  <td><span className="mi-chip" data-tone={SENIOR_LEVELS.has(m.topSeniority) ? 'senior' : undefined}>{SENIORITY_SHORT[m.topSeniority]}</span></td>
                  <td className="mi-hide-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{m.attendeeCount}</td>
                  <td className="mi-hide-sm">{m.sources.map((s) => SOURCE_LABEL[s]).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mi-flag-actions">
            {cursor > 0 ? <button type="button" className="mi-link" onClick={() => { const n = new URLSearchParams(params); n.set('cursor', String(Math.max(0, cursor - PAGE))); setParams(n); }}>Previous</button> : null}
            {list.data?.nextCursor != null ? <button type="button" className="mi-link" onClick={() => { const n = new URLSearchParams(params); n.set('cursor', String(list.data!.nextCursor)); setParams(n); }}>Next {PAGE}</button> : null}
          </div>
        </section>
      )}
      {scopeId ? <LogMeetingDialog open={logOpen} onOpenChange={setLogOpen} companyId={scopeId} companyName={companyName} /> : null}
    </div>
  );
}
