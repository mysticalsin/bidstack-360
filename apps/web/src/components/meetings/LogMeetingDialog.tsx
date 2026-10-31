// Manual meeting entry for one account. Attendees one per line:
// "Name, Title, Region, BU" (title drives the seniority the API classifies).
import './meetings.css';

import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { useCreateMeeting } from '@/hooks/useMeetingIntel';
import { ApiError } from '@/lib/api';
import { lines, parseAttendees } from '@/lib/meeting-intel/client';

const today = () => new Date().toISOString().slice(0, 10);

export function LogMeetingDialog({ open, onOpenChange, companyId, companyName, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; companyId: string; companyName?: string; onCreated?: (id: string) => void;
}) {
  const id = useId();
  const create = useCreateMeeting();
  const [f, setF] = useState({ title: '', date: today(), attendees: '', summary: '', challenges: '', opportunities: '', nextSteps: '', org: false });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? Boolean(e.target.checked) : e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await create.mutateAsync({
        companyId,
        title: f.title.trim(),
        heldAt: new Date(`${f.date}T12:00:00.000Z`).toISOString(),
        attendees: parseAttendees(f.attendees),
        ...(f.summary.trim() ? { summary: f.summary.trim() } : {}),
        challenges: lines(f.challenges),
        opportunities: lines(f.opportunities),
        nextSteps: lines(f.nextSteps),
        similarProjects: [],
        visibility: f.org ? 'org' : 'account_team',
      });
      onCreated?.(r.id);
      onOpenChange(false);
      setF({ title: '', date: today(), attendees: '', summary: '', challenges: '', opportunities: '', nextSteps: '', org: false });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? 'This meeting is already recorded for that day.' : err instanceof ApiError && err.status === 403 ? 'You need meetings:write to log a meeting.' : "Couldn't save the meeting. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!create.isPending) onOpenChange(o); }}>
      <DialogContent title="Log a meeting" description={companyName ? `With ${companyName}. No transcript is stored for manual entries.` : 'No transcript is stored for manual entries.'}>
        <form className="mi-form" onSubmit={submit} data-testid="log-meeting-form">
          <label>Title<input required maxLength={300} value={f.title} onChange={set('title')} /></label>
          <div className="row">
            <label>Date<input type="date" required value={f.date} max={today()} onChange={set('date')} /></label>
            <label className="mi-check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={f.org} onChange={set('org')} /> Visible to the whole organisation
            </label>
          </div>
          <label htmlFor={`${id}-att`}>Attendees, one per line: Name, Title, Region, BU</label>
          <textarea id={`${id}-att`} rows={3} value={f.attendees} onChange={set('attendees')} placeholder={'Emma Clarke, VP Technology, GB\nOliver Grant, Head of Data Protection, GB, Legal'} />
          <label>Summary<textarea rows={3} maxLength={20000} value={f.summary} onChange={set('summary')} /></label>
          <div className="row">
            <label>Challenges (one per line)<textarea rows={2} value={f.challenges} onChange={set('challenges')} /></label>
            <label>Opportunities (one per line)<textarea rows={2} value={f.opportunities} onChange={set('opportunities')} /></label>
          </div>
          <label>Next steps (one per line)<textarea rows={2} value={f.nextSteps} onChange={set('nextSteps')} /></label>
          {error ? <p className="mi-caption" role="alert" style={{ color: 'var(--status-danger-fg, #b91c1c)' }}>{error}</p> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !f.title.trim()}>{create.isPending ? 'Saving…' : 'Save meeting'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
