// Self-contained "create calendar event" modal: owns its own form state.
import { zonedWallTimeToUtc } from '@bidstack/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Modal } from '@/components/ui/Modal';
import { dayKey, timeZoneLabel, userTimeZone } from './layout';
import type { CreateEventBody } from './types';

interface CreateEventModalProps {
  /** Day the user picked (YYYY-MM-DD in timeZone). Defaults to today. */
  initialDayKey?: string;
  /** Hour the user picked, 0 to 23. */
  initialHour?: number;
  /** Time zone the wall times are entered in. Defaults to the browser's. */
  timeZone?: string;
  onClose: () => void;
  onSave: (body: CreateEventBody) => void;
  loading: boolean;
  error?: string | null;
}

const FIELD =
  'w-full rounded-lg border border-(--border-default) bg-(--surface-page) px-3 py-2 text-sm text-(--fg-primary) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)';
const LABEL = 'block text-sm font-medium text-(--fg-secondary) mb-1';

function hhmm(minutes: number): string {
  const m = Math.min(Math.max(minutes, 0), 23 * 60 + 59);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function CreateEventModal({
  initialDayKey,
  initialHour,
  timeZone,
  onClose,
  onSave,
  loading,
  error,
}: CreateEventModalProps) {
  const { t } = useTranslation('crm');
  const tz = timeZone ?? userTimeZone();
  const startHour = initialHour ?? 9;
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(() => initialDayKey ?? dayKey(new Date(), tz));
  const [startTime, setStartTime] = useState(hhmm(startHour * 60));
  const [endTime, setEndTime] = useState(hhmm(startHour * 60 + 30));
  const [location, setLocation] = useState('');
  const [provider, setProvider] = useState<'google_workspace' | 'microsoft_graph'>(
    'google_workspace',
  );
  const [formError, setFormError] = useState<string | null>(null);
  // One key per dialog, so a double submit or a network retry creates one event.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (endTime <= startTime) {
      setFormError(t('createEvent.endBeforeStart', 'End time must be after the start time.'));
      return;
    }
    setFormError(null);
    onSave({
      subject,
      startAt: zonedWallTimeToUtc(`${date}T${startTime}:00`, tz).toISOString(),
      endAt: zonedWallTimeToUtc(`${date}T${endTime}:00`, tz).toISOString(),
      location: location || undefined,
      provider,
      clientRequestId,
    });
  }

  const shownError = formError ?? error ?? null;

  return (
    <Modal open onClose={onClose} title={t('createEvent.modalLabel', 'Create calendar event')}>
      <div className="bg-(--surface-card) rounded-2xl p-6 shadow-xl w-full max-w-md mx-4 focus:outline-none">
        <h2 className="text-lg font-semibold mb-4 text-(--fg-primary)">
          {t('createEvent.heading', 'New event')}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {shownError ? (
            <p
              role="alert"
              className="rounded-lg border border-(--danger) px-3 py-2 text-sm text-(--danger)"
            >
              {shownError}
            </p>
          ) : null}
          <div>
            <label htmlFor="evt-subject" className={LABEL}>
              {t('createEvent.titleLabel', 'Title')}
            </label>
            <input
              id="evt-subject"
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={FIELD}
              placeholder={t('createEvent.titlePlaceholder', 'Event title')}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="evt-date" className={LABEL}>
                {t('createEvent.dateLabel', 'Date')}
              </label>
              <input
                id="evt-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="evt-provider" className={LABEL}>
                {t('createEvent.calendarLabel', 'Calendar')}
              </label>
              <select
                id="evt-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
                className={FIELD}
              >
                <option value="google_workspace">{t('createEvent.providerGoogle', 'Google')}</option>
                <option value="microsoft_graph">
                  {t('createEvent.providerMicrosoft', 'Microsoft')}
                </option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="evt-start" className={LABEL}>
                {t('createEvent.startLabel', 'Start')}
              </label>
              <input
                id="evt-start"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="evt-end" className={LABEL}>
                {t('createEvent.endLabel', 'End')}
              </label>
              <input
                id="evt-end"
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={FIELD}
              />
            </div>
          </div>
          <p className="text-xs text-(--fg-tertiary)">{timeZoneLabel(tz)}</p>

          <div>
            <label htmlFor="evt-location" className={LABEL}>
              {t('createEvent.locationLabel', 'Location (optional)')}
            </label>
            <input
              id="evt-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={FIELD}
              placeholder={t('createEvent.locationPlaceholder', 'Room, video link, address')}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 px-4 py-2 rounded-lg text-sm font-medium text-(--fg-secondary) hover:bg-(--surface-hover) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
            >
              {t('createEvent.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="min-h-11 px-4 py-2 rounded-lg text-sm font-medium bg-(--brand-primary) text-(--fg-on-brand) hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {loading
                ? t('createEvent.saving', 'Saving…')
                : t('createEvent.submit', 'Create event')}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
