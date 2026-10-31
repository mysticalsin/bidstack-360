// Turn meeting details into the distinct external people behind one coverage cell.
import type { MeetingIntelDetail, SeniorityLevel } from './client';

export interface CellRef { region: string; seniority: SeniorityLevel }

export interface Person {
  key: string; name: string; title: string | null; businessUnit: string | null; contactId: string | null;
  reportsToContactId: string | null; lastMet: string; meetingId: string; meetingTitle: string; meetings: number;
}

export function collectPeople(details: MeetingIntelDetail[], cell: CellRef): Person[] {
  const byKey = new Map<string, Person>();
  for (const m of details) {
    for (const a of m.attendees) {
      if (a.isInternal || a.seniority !== cell.seniority || (a.region ?? '') !== cell.region) continue;
      const key = a.contactId ?? a.email ?? a.name.toLowerCase();
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, { key, name: a.name, title: a.title, businessUnit: a.businessUnit, contactId: a.contactId, reportsToContactId: a.reportsToContactId, lastMet: m.heldAt, meetingId: m.id, meetingTitle: m.title, meetings: 1 });
      else {
        prev.meetings += 1;
        if (m.heldAt > prev.lastMet) Object.assign(prev, { lastMet: m.heldAt, meetingId: m.id, meetingTitle: m.title });
      }
    }
  }
  return [...byKey.values()].sort((x, y) => y.lastMet.localeCompare(x.lastMet));
}

