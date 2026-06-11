// Self-contained "create calendar event" modal — owns its own form state.
import { useState } from 'react';

import { Modal } from '@/components/ui/Modal';
import type { CreateEventBody } from './types';

interface CreateEventModalProps {
  initialDate?: Date;
  onClose: () => void;
  onSave: (body: CreateEventBody) => void;
  loading: boolean;
  error?: string | null;
}

export function CreateEventModal({
  initialDate,
  onClose,
  onSave,
  loading,
  error,
}: CreateEventModalProps) {
  // WHY: derive baseDateStr inline — avoids importing toIso from the parent module
  const baseDateStr = (initialDate ?? new Date()).toISOString().slice(0, 10);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(baseDateStr);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [location, setLocation] = useState('');
  const [provider, setProvider] = useState<'google_workspace' | 'microsoft_graph'>(
    'google_workspace',
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      subject,
      startAt: `${date}T${startTime}:00Z`,
      endAt: `${date}T${endTime}:00Z`,
      location: location || undefined,
      provider,
    });
  }

  return (
    <Modal open onClose={onClose} label="Create calendar event">
      <div className="bg-(--color-surface) rounded-2xl p-6 shadow-xl w-full max-w-md mx-4 focus:outline-none">
        <h2 className="text-lg font-semibold mb-4 text-(--color-text-primary)">New event</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-(--color-danger) bg-(--color-danger)/10 px-3 py-2 text-sm text-(--color-danger)"
            >
              {error}
            </p>
          ) : null}
          <div>
            <label
              htmlFor="evt-subject"
              className="block text-sm font-medium text-(--color-text-secondary) mb-1"
            >
              Title
            </label>
            <input
              id="evt-subject"
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              placeholder="Event title"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="evt-date"
                className="block text-sm font-medium text-(--color-text-secondary) mb-1"
              >
                Date
              </label>
              <input
                id="evt-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              />
            </div>
            <div>
              <label
                htmlFor="evt-provider"
                className="block text-sm font-medium text-(--color-text-secondary) mb-1"
              >
                Calendar
              </label>
              <select
                id="evt-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              >
                <option value="google_workspace">Google</option>
                <option value="microsoft_graph">Microsoft</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="evt-start"
                className="block text-sm font-medium text-(--color-text-secondary) mb-1"
              >
                Start
              </label>
              <input
                id="evt-start"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              />
            </div>
            <div>
              <label
                htmlFor="evt-end"
                className="block text-sm font-medium text-(--color-text-secondary) mb-1"
              >
                End
              </label>
              <input
                id="evt-end"
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="evt-location"
              className="block text-sm font-medium text-(--color-text-secondary) mb-1"
            >
              Location (optional)
            </label>
            <input
              id="evt-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              placeholder="Room, Zoom link, address…"
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium text-(--color-text-secondary) hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-(--color-accent) text-white hover:bg-(--color-accent-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-2 disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Create event'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
