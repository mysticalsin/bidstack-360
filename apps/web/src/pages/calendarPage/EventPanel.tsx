/**
 * calendarPage/EventPanel.tsx — meeting card: time, place, the account,
 * contact and opportunity it was filed on, and meeting prep.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Briefcase, Building2, Clock, MapPin, User } from 'lucide-react';

import { MeetingPrepCard } from '@/components/ai/MeetingPrepCard';
import { Badge } from '@/components/ui/Badge';
import { Sheet, SheetContent } from '@/components/ui/Sheet';

import { eventDaySpan, formatDayLabel, formatTime, isLaneEvent, timeZoneLabel } from './layout';
import type { CalendarEvent } from './types';

interface EventPanelProps {
  event: CalendarEvent | null;
  tz: string;
  onClose: () => void;
}

const LINK =
  'flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]';

export function EventPanel({ event, tz, onClose }: EventPanelProps) {
  const { t } = useTranslation('crm');
  if (!event) return null;

  const [first, last] = eventDaySpan(event, tz);
  const dayOpts = { weekday: 'short', month: 'short', day: 'numeric' } as const;
  const days =
    first === last
      ? formatDayLabel(first, dayOpts)
      : t('calendar.timeRange', '{{start}} to {{end}}', {
          start: formatDayLabel(first, dayOpts),
          end: formatDayLabel(last, dayOpts),
        });
  const time = isLaneEvent(event)
    ? t('calendar.allDay', 'All day')
    : t('calendar.timeRange', '{{start}} to {{end}}', {
        start: formatTime(event.startAt, tz),
        end: formatTime(event.endAt, tz),
      });
  const hasLinks = Boolean(event.companyId || event.contactId || event.opportunityId);

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent size="md" title={<span className="block truncate" title={event.subject}>{event.subject}</span>}>
        <div className="space-y-5" data-testid="calendar-event-panel">
          <dl className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <dt className="sr-only">{t('calendar.when', 'When')}</dt>
              <Clock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--fg-tertiary)]" />
              <dd className="min-w-0 text-[var(--fg-primary)]">
                <span className="block">{days}</span>
                <span className="block text-[var(--fg-secondary)]">
                  {time}
                  {isLaneEvent(event) ? '' : `, ${timeZoneLabel(tz)}`}
                </span>
              </dd>
            </div>
            {event.location ? (
              <div className="flex items-start gap-2">
                <dt className="sr-only">{t('calendar.where', 'Where')}</dt>
                <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--fg-tertiary)]" />
                <dd className="min-w-0 break-words text-[var(--fg-primary)]">{event.location}</dd>
              </div>
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-2">
            <Badge tone={event.provider === 'microsoft_graph' ? 'purple' : 'blue'}>
              {event.provider === 'microsoft_graph'
                ? t('calendar.providerMicrosoft', 'Microsoft')
                : t('calendar.providerGoogle', 'Google')}
            </Badge>
            {event.localOnly ? <Badge tone="gray">{t('calendar.localOnly', 'Only in Polo')}</Badge> : null}
            {event.syncState === 'CONFLICT' ? (
              <Badge tone="amber">{t('calendar.syncConflict', 'Sync conflict')}</Badge>
            ) : null}
          </div>

          <section aria-label={t('calendar.filedOn', 'Filed on')}>
            <h3 className="mb-1 text-xs font-semibold text-[var(--fg-secondary)]">
              {t('calendar.filedOn', 'Filed on')}
            </h3>
            {hasLinks ? (
              <div className="-mx-3">
                {event.companyId ? (
                  <Link to={`/companies/${event.companyId}`} className={LINK}>
                    <Building2 size={16} aria-hidden="true" className="shrink-0" />
                    {t('calendar.openAccount', 'Open account')}
                  </Link>
                ) : null}
                {event.contactId ? (
                  <Link to={`/contacts/${event.contactId}`} className={LINK}>
                    <User size={16} aria-hidden="true" className="shrink-0" />
                    {t('calendar.openContact', 'Open contact')}
                  </Link>
                ) : null}
                {event.opportunityId ? (
                  <Link to={`/opportunities/${event.opportunityId}`} className={LINK}>
                    <Briefcase size={16} aria-hidden="true" className="shrink-0" />
                    {t('calendar.openOpportunity', 'Open opportunity')}
                  </Link>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-[var(--fg-tertiary)]">{t('calendar.notFiled', 'Not filed yet')}</p>
            )}
          </section>

          <MeetingPrepCard calendarEventId={event.id} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
