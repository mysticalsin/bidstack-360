// Watchdog task 5: fold MeetingIntelWatchdogItem rows (cross-region meeting
// flags) into an account's watchdog signals, newest first. Only rows whose
// companyId is this account (the recipient's own account) are shown.
import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

import type { MeetingIntelWatchdogItem } from './client';

export function mergeMeetingSignals(data: AccountWatchdog, items: MeetingIntelWatchdogItem[] | undefined, companyId: string): AccountWatchdog {
  const mine = (Array.isArray(items) ? items : []).filter((i) => i.companyId === companyId && i.kind === 'MEETING_CROSS_REGION');
  if (!mine.length) return data;
  const have = new Set(data.events.map((e) => e.id));
  const extra: AccountWatchdog['events'] = mine
    .filter((i) => !have.has(`mi:${i.externalId}`))
    .map((i) => ({
      id: `mi:${i.externalId}`,
      source: 'meeting_intel',
      kind: i.kind,
      title: i.title,
      summary: i.summary,
      sourceUrl: i.url,
      occurredAt: i.occurredAt,
      implication: 'OPPORTUNITY',
      implicationRationale: 'A colleague met this group in another region. Check whether the same topics apply here.',
      severity: 2,
      status: 'NEW',
    }));
  return { ...data, events: [...data.events, ...extra].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) };
}
