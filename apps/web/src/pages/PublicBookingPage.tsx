import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

interface AvailabilityResponse {
  slots: string[];
  durationMinutes: number;
  name: string;
  description: string | null;
  customQuestions: unknown[];
}

function isoDate(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatSlot(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function PublicBookingPage() {
  const { t } = useTranslation('crm');
  const { slug = '' } = useParams<{ slug: string }>();
  const [date, setDate] = useState(() => isoDate(1));
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(i + 1)), []);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAvailability() {
      setLoading(true);
      setError(null);
      setSelectedSlot(null);
      try {
        const params = new URLSearchParams({ date, tz: timezone });
        const res = await fetch(`/api/v1/booking-pages/${slug}/availability?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? t('publicBooking.errorNotFound', 'Booking page not found')
              : t('publicBooking.errorAvailabilityFailed', 'Availability failed'),
          );
        }
        const data = (await res.json()) as AvailabilityResponse;
        setAvailability(data);
      } catch (err) {
        if (!controller.signal.aborted) {
          setAvailability(null);
          setError(
            err instanceof Error
              ? err.message
              : t('publicBooking.errorUnavailable', 'Booking page unavailable'),
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadAvailability();
    return () => controller.abort();
  }, [date, slug, timezone, t]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitError(null);
    try {
      const res = await fetch(`/api/v1/booking-pages/${slug}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendeeName,
          attendeeEmail,
          startAt: selectedSlot,
          answers: {},
          tz: timezone,
        }),
      });
      if (!res.ok)
        throw new Error(
          t('publicBooking.errorSlotTaken', 'That time is no longer available.'),
        );
      setConfirmed(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : t('publicBooking.errorBookingFailed', 'Booking failed'),
      );
    }
  }

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--surface-page)] px-4">
        <section className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-[var(--fg-primary)]">
            {t('publicBooking.notFoundTitle', 'Booking page not found')}
          </h1>
          <p className="mt-2 text-sm text-[var(--fg-secondary)]">
            {t(
              'publicBooking.notFoundBody',
              'This scheduling link is invalid or no longer accepting meetings.',
            )}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--surface-page)] px-4 py-8">
      <section className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {t('publicBooking.eyebrow', 'Polo PreSales scheduling')}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--fg-primary)]">
            {loading ? t('publicBooking.loadingTitle', 'Loading booking page') : availability?.name}
          </h1>
          {availability?.description && (
            <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
              {availability.description}
            </p>
          )}
        </header>

        {confirmed ? (
          <section className="rounded-2xl border border-[var(--success)]/30 bg-[var(--success-tint)] p-6 text-center">
            <h2 className="text-xl font-semibold text-[var(--fg-primary)]">
              {t('publicBooking.confirmedTitle', 'Booking confirmed')}
            </h2>
            <p className="mt-2 text-sm text-[var(--fg-secondary)]">
              {t('publicBooking.confirmedBody', "You're booked. A confirmation email is on its way.")}
            </p>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <section
              className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4"
              role="grid"
              data-testid="booking-calendar"
              aria-label={t('publicBooking.calendarAriaLabel', 'Choose a booking date')}
            >
              <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
                {t('publicBooking.chooseDayHeading', 'Choose a day')}
              </h2>
              <div className="mt-3 grid gap-2">
                {days.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDate(day)}
                    className={cn(
                      'min-h-[44px] rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      date === day
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--fg-primary)]'
                        : 'border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]',
                    )}
                  >
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    }).format(new Date(`${day}T12:00:00Z`))}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
              <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
                {t('publicBooking.availableTimesHeading', 'Available times')}
              </h2>
              {loading ? (
                <div className="mt-4 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-11 rounded-lg bg-[var(--surface-sunken)] animate-pulse"
                    />
                  ))}
                </div>
              ) : availability?.slots.length ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {availability.slots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      data-testid="time-slot"
                      aria-label={t('publicBooking.slotAriaLabel', 'Available slot {{slot}}', {
                        slot: formatSlot(slot),
                      })}
                      onClick={() => setSelectedSlot(slot)}
                      className={cn(
                        'min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                        selectedSlot === slot
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                          : 'border-[var(--border-subtle)] text-[var(--fg-primary)] hover:bg-[var(--surface-hover)]',
                      )}
                    >
                      {formatSlot(slot)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-sm text-[var(--fg-secondary)]">
                  {t('publicBooking.noSlots', 'No available slots on this day. Try another date.')}
                </p>
              )}

              {selectedSlot && (
                <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                  <p className="text-sm text-[var(--fg-secondary)]">
                    {t('publicBooking.selectedLabel', 'Selected:')}{' '}
                    <strong>{formatSlot(selectedSlot)}</strong>
                  </p>
                  {submitError && (
                    <p role="alert" className="text-sm text-[var(--danger)]">
                      {submitError}
                    </p>
                  )}
                  <label className="block text-sm font-medium text-[var(--fg-primary)]">
                    {t('publicBooking.nameLabel', 'Name')}
                    <input
                      value={attendeeName}
                      onChange={(e) => setAttendeeName(e.target.value)}
                      required
                      className="input mt-1 w-full"
                    />
                  </label>
                  <label className="block text-sm font-medium text-[var(--fg-primary)]">
                    {t('publicBooking.emailLabel', 'Email')}
                    <input
                      type="email"
                      value={attendeeEmail}
                      onChange={(e) => setAttendeeEmail(e.target.value)}
                      required
                      className="input mt-1 w-full"
                    />
                  </label>
                  <button
                    type="submit"
                    className="min-h-[44px] w-full rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                  >
                    {t('publicBooking.confirmButton', 'Confirm booking')}
                  </button>
                </form>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
