// Schedule a review meeting (Go/No-Go gate, RFP/proposal review) on a connected
// calendar. Reuses the existing /api/calls/schedule infra: TEAMS (Microsoft),
// Google Meet, or Zoom. The meeting is created in the connected provider and
// recorded as a CallSession against the entity, so it shows up in the Calls tab.
// If no provider is connected the server returns 503 and we tell the user where
// to connect one.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { useScheduleCall, type CallEntityType, type CallProvider } from '@/hooks/useCalls';

type ScheduleProvider = Exclude<CallProvider, 'TWILIO_VOICE'>;

const PROVIDERS: { value: ScheduleProvider; label: string }[] = [
  { value: 'TEAMS', label: 'Microsoft Teams' },
  { value: 'GOOGLE_MEET', label: 'Google Meet' },
  { value: 'ZOOM', label: 'Zoom' },
];

interface Props {
  entityType: CallEntityType;
  entityId: string;
  /** Pre-filled meeting topic, e.g. "Go/No-Go review — Acme RFP". */
  defaultTopic?: string;
  trigger?: React.ReactNode;
}

export function ScheduleReviewDialog({ entityType, entityId, defaultTopic, trigger }: Props) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const schedule = useScheduleCall();

  const [provider, setProvider] = useState<ScheduleProvider>('TEAMS');
  const [startsAt, setStartsAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [attendees, setAttendees] = useState('');
  const [topic, setTopic] = useState(defaultTopic ?? '');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setProvider('TEAMS');
    setStartsAt('');
    setDurationMinutes(60);
    setAttendees('');
    setTopic(defaultTopic ?? '');
    setError(null);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!startsAt) {
      setError(t('scheduleReview.errorPickDateTime', 'Pick a date and time'));
      return;
    }
    const attendeeEmails = attendees
      .split(/[,\n]/)
      .map((a) => a.trim())
      .filter(Boolean);
    try {
      const res = await schedule.mutateAsync({
        entityType,
        entityId,
        provider,
        // datetime-local is local wall-clock; convert to a real ISO instant.
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes,
        attendeeEmails,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
      });
      setOpen(false);
      reset();
      toast.success(t('scheduleReview.toastScheduledTitle', 'Review scheduled'), {
        description: res.joinUrl
          ? t('scheduleReview.toastScheduledWithLink', 'Meeting link added to the Calls tab.')
          : t('scheduleReview.toastScheduledNoLink', 'Added to the Calls tab.'),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('scheduleReview.errorServerRejected', 'The server rejected the request.');
      // The provider call fails (503) when no account is connected.
      const friendly = /schedule call via/i.test(msg)
        ? t(
            'scheduleReview.errorProviderUnreachable',
            "Couldn't reach {{provider}}. Connect it in Settings → Integrations, or pick another provider.",
            { provider: PROVIDERS.find((p) => p.value === provider)?.label },
          )
        : msg;
      setError(friendly);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <button type="button" className="btn btn-secondary">
            {t('scheduleReview.triggerButton', 'Schedule review')}
          </button>
        )}
      </DialogTrigger>
      {open ? (
        <DialogContent
          title={t('scheduleReview.dialogTitle', 'Schedule a review')}
          description={t(
            'scheduleReview.dialogDescription',
            'Create a Go/No-Go or RFP review meeting on a connected calendar.',
          )}
        >
          <form onSubmit={submit} className="space-y-3">
            <Field label={t('scheduleReview.fieldTopic', 'Topic')} htmlFor="rev-topic">
              <input
                id="rev-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={200}
                placeholder={t('scheduleReview.placeholderTopic', 'Go/No-Go review')}
                autoFocus
                className="dialog-input"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('scheduleReview.fieldProvider', 'Provider')} htmlFor="rev-provider">
                <Select
                  id="rev-provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as ScheduleProvider)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('scheduleReview.fieldDuration', 'Duration (min)')} htmlFor="rev-duration">
                <input
                  id="rev-duration"
                  type="number"
                  min={15}
                  max={480}
                  step={15}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="dialog-input"
                />
              </Field>
            </div>

            <Field label={t('scheduleReview.fieldStart', 'Start')} htmlFor="rev-start" required>
              <input
                id="rev-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
                className="dialog-input"
              />
            </Field>

            <Field
              label={t('scheduleReview.fieldAttendees', 'Attendees (comma-separated emails)')}
              htmlFor="rev-attendees"
            >
              <input
                id="rev-attendees"
                type="text"
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="ceo@acme.com, bid.lead@mantu.com"
                className="dialog-input"
              />
            </Field>

            {error ? (
              <p role="alert" className="text-xs text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={schedule.isPending}
              >
                {t('scheduleReview.cancel', 'Cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={schedule.isPending}>
                {schedule.isPending
                  ? t('scheduleReview.submitting', 'Scheduling…')
                  : t('scheduleReview.submit', 'Schedule')}
              </Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </span>
      {children}
    </label>
  );
}
