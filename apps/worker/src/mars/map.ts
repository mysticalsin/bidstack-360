/**
 * MARS entry to the adapter-neutral NormalizedMeeting used by the meeting
 * intel pipeline. Account matching happens before mapping (strict, see
 * matchMarsAccount), so the meeting always carries companyId.
 */
import type { MarsEntry, NormalizedMeeting } from '@bidstack/shared';

/** One ingest item per entry version: an edit in MARS is a new version. */
export const marsExternalId = (e: Pick<MarsEntry, 'id' | 'version'>) => `${e.id}:v${e.version}`;
export const marsEntryIdOf = (externalId: string) => externalId.replace(/:v\d+$/, '');

const clip = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) : undefined);
const TYPE_LABEL: Record<MarsEntry['meetingType'], string> = {
  in_person: 'Meeting',
  video: 'Video call',
  phone: 'Call',
  event: 'Event',
  meal: 'Lunch or dinner',
  other: 'Meeting',
};

export function mapMarsEntry(e: MarsEntry, companyId: string, opts: { webBaseUrl?: string | null } = {}): NormalizedMeeting {
  const title = clip(e.topic, 300) || `${TYPE_LABEL[e.meetingType]} with ${e.client.name}`.slice(0, 300);
  const internal = [{ name: e.loggedBy.name, email: e.loggedBy.email, ...(e.loggedBy.region ? { region: e.loggedBy.region.slice(0, 100) } : {}) }, ...e.internalAttendees.map((a) => ({ name: a.name, email: a.email }))];
  const seen = new Set<string>();
  const attendees = [
    ...internal,
    ...e.contacts.map((p) => ({
      name: p.fullName.slice(0, 200),
      ...(p.email ? { email: p.email } : {}),
      ...(p.jobTitle ? { title: p.jobTitle.slice(0, 200) } : {}),
      ...(p.country ? { region: p.country.slice(0, 100) } : {}),
      ...(p.department ? { businessUnit: p.department.slice(0, 200) } : {}),
      ...(p.linkedinUrl ? { linkedinUrl: p.linkedinUrl } : {}),
      ...(p.reportsTo ? { reportsTo: { name: p.reportsTo.fullName, ...(p.reportsTo.email ? { email: p.reportsTo.email } : {}) } } : {}),
    })),
  ].filter((a) => {
    const k = a.email?.toLowerCase() ?? `n:${a.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const base = opts.webBaseUrl?.replace(/\/+$/, '');
  return {
    externalId: marsExternalId(e),
    title,
    heldAt: new Date(e.meetingDate).toISOString(),
    ...(base && /^https:\/\//.test(base) ? { url: `${base}/entries/${encodeURIComponent(e.id)}` } : {}),
    companyId,
    accountName: e.client.name.slice(0, 300),
    attendees: attendees.slice(0, 100),
    ...(e.notes ? { summary: e.notes.slice(0, 20_000) } : {}),
    challenges: [...new Set(e.challenges)].slice(0, 30),
    similarProjects: [],
    opportunities: [],
    nextSteps: [...new Set(e.nextSteps)].slice(0, 30),
    visibility: 'account_team',
    confidential: e.confidential,
  };
}
