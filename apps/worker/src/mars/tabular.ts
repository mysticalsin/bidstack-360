/**
 * Flat MARS rows (one row per client person met, as a Power BI table or an
 * exported sheet usually looks) to MarsEntry objects, one per meeting.
 *
 * Shared by the Power BI source and the SharePoint/OneDrive export fallback,
 * so both follow the same MarsColumnMap and the same strict account filter.
 * Rows here are keyed by LOGICAL field (account, contactName, ...); each
 * source renames its real columns first.
 *
 * Versioning: with an updatedAt column the version is its epoch seconds, so
 * an edit is a newer version. Without one the version is a hash of the
 * meeting content, so an edit seen again inside the lookback window still
 * becomes a new ingest item while an unchanged re-read stays a no-op.
 */
import { createHash } from 'node:crypto';

import { type MarsEntry, type MarsTabularField, normalizeMarsAccountKey } from '@bidstack/shared';

export type MarsTabularRow = Partial<Record<MarsTabularField, unknown>>;

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function str(v: unknown, max = 500): string | null {
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim();
  return s ? s.slice(0, max) : null;
}

function email(v: unknown): string | null {
  const s = str(v, 320)?.toLowerCase().replace(/^mailto:/, '') ?? null;
  return s && EMAIL.test(s) ? s : null;
}

function url(v: unknown): string | null {
  const s = str(v, 300);
  return s && /^https?:\/\/\S+$/i.test(s) ? s : null;
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return ['true', 'yes', 'y', '1', 'x', 'oui', 'sim'].includes((str(v, 10) ?? '').toLowerCase());
}

/**
 * Dataset or sheet date to a Date. Power BI serialises datetimes without a
 * zone ("2026-10-20T00:00:00"); those are read as UTC. Excel serial numbers
 * (days since 1899-12-30) are accepted for sheets read without cellDates.
 */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 20_000 && v < 80_000) return new Date(Math.round((v - 25_569) * 86_400_000));
    return null;
  }
  const s = str(v, 40);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mondayOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** "Sam Lee <sam@x.com>", "sam@x.com" or "Sam Lee". Several people split on ; | or new line (never on comma: "Lee, Sam"). */
export function parsePeople(v: unknown): Array<{ name: string; email: string | null }> {
  const s = str(v, 4000);
  if (!s) return [];
  return s
    .split(/[;|\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(p);
      if (m) return { name: (m[1]!.replace(/^"|"$/g, '').trim() || m[2]!.split('@')[0]!).slice(0, 200), email: email(m[2]) };
      const e = email(p);
      return e ? { name: e.split('@')[0]!.slice(0, 200), email: e } : { name: p.slice(0, 200), email: null };
    });
}

const MEETING_TYPES: Record<string, MarsEntry['meetingType']> = {
  in_person: 'in_person', 'in person': 'in_person', 'face to face': 'in_person', onsite: 'in_person', 'on site': 'in_person', visit: 'in_person',
  video: 'video', teams: 'video', zoom: 'video', 'video call': 'video', virtual: 'video', online: 'video',
  phone: 'phone', call: 'phone', 'phone call': 'phone',
  event: 'event', conference: 'event',
  meal: 'meal', lunch: 'meal', dinner: 'meal', breakfast: 'meal',
};

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Group rows into entries. `accountKeys`, when given, is the strict filter:
 * a row is kept only when its account value equals one key (normalised,
 * whole value). Rows from other accounts never reach Polo.
 */
export function rowsToEntries(rows: readonly MarsTabularRow[], opts: { source: 'pbi' | 'file'; accountKeys?: readonly string[] }) {
  const keys = opts.accountKeys ? new Set(opts.accountKeys.map(normalizeMarsAccountKey).filter(Boolean)) : null;
  const dropped = { missing: 0, outsideFilter: 0 };
  const groups = new Map<string, MarsTabularRow[]>();
  for (const r of rows) {
    const account = str(r.account, 300);
    const date = toDate(r.meetingDate);
    if (!account || !date) {
      dropped.missing++;
      continue;
    }
    if (keys && !keys.has(normalizeMarsAccountKey(account))) {
      dropped.outsideFilter++;
      continue;
    }
    const logged = email(r.loggedByEmail) ?? str(r.loggedByName, 200) ?? parsePeople(r.internalAttendee)[0]?.email ?? str(r.internalAttendee, 200) ?? '';
    const id = str(r.entryId, 100) ?? `h${hash(`${normalizeMarsAccountKey(account)}|${date.toISOString()}|${logged.toLowerCase()}`).slice(0, 24)}`;
    const g = groups.get(id);
    if (g) g.push(r);
    else groups.set(id, [r]);
  }

  const entries: Record<string, unknown>[] = [];
  for (const [rawId, rs] of groups) {
    const first = rs[0]!;
    const account = str(first.account, 300)!;
    const meetingDate = toDate(first.meetingDate)!;
    const updated = rs.map((r) => toDate(r.updatedAt)).filter((d): d is Date => !!d);
    const updatedAt = updated.length ? new Date(Math.max(...updated.map((d) => d.getTime()))) : meetingDate;

    const contacts = new Map<string, Record<string, unknown>>();
    const internal = new Map<string, { name: string; email: string | null }>();
    const notes: string[] = [];
    for (const r of rs) {
      const name = str(r.contactName, 200);
      if (name) {
        const e = email(r.contactEmail);
        const k = e ?? `n:${name.toLowerCase()}`;
        const reports = parsePeople(r.contactReportsTo)[0];
        if (!contacts.has(k)) {
          contacts.set(k, {
            fullName: name,
            email: e,
            linkedinUrl: url(r.contactLinkedin),
            jobTitle: str(r.contactTitle, 200),
            department: str(r.contactDepartment, 200),
            country: str(r.contactCountry, 100),
            reportsTo: reports ? { fullName: reports.name, email: reports.email } : null,
          });
        }
      } else {
        dropped.missing++;
      }
      for (const p of parsePeople(r.internalAttendee)) internal.set(p.email ?? `n:${p.name.toLowerCase()}`, p);
      const n = str(r.notes, 20_000);
      if (n && !notes.includes(n)) notes.push(n);
    }
    if (!contacts.size) continue;

    const loggedEmail = email(first.loggedByEmail);
    const loggedName = str(first.loggedByName, 200);
    const firstInternal = [...internal.values()][0];
    const loggedBy = loggedEmail || loggedName
      ? { email: loggedEmail, name: loggedName ?? loggedEmail!.split('@')[0]!, region: null }
      : firstInternal
        ? { email: firstInternal.email, name: firstInternal.name, region: null }
        : { email: null, name: 'MARS', region: null };
    const internalAttendees = [...internal.values()].filter((p) => !(loggedBy.email ? p.email === loggedBy.email : p.name === loggedBy.name)).slice(0, 20);
    const typeKey = (str(first.meetingType, 40) ?? '').toLowerCase().replace(/[-_]+/g, ' ');

    const body = {
      // Same id from Power BI and from the file export, so switching source never duplicates a meeting.
      id: `mt-${rawId}`.slice(0, 100),
      updatedAt: updatedAt.toISOString(),
      weekOf: mondayOf(meetingDate),
      meetingDate: meetingDate.toISOString(),
      loggedBy,
      internalAttendees,
      client: {
        marsAccountId: account.slice(0, 100),
        name: str(first.company, 300) ?? account,
        legalName: null,
        domain: str(first.accountDomain, 255),
        parentName: str(first.parentCompany, 300),
        country: null,
      },
      contacts: [...contacts.values()].sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))).slice(0, 50),
      meetingType: MEETING_TYPES[typeKey] ?? MEETING_TYPES[typeKey.replace(/ /g, '_')] ?? 'other',
      topic: str(first.topic, 300),
      notes: notes.length ? notes.join('\n\n').slice(0, 20_000) : null,
      challenges: [],
      nextSteps: [],
      confidential: rs.some((r) => truthy(r.confidential)),
      deleted: rs.every((r) => truthy(r.deleted)),
    };
    const version = updated.length
      ? Math.max(2, Math.floor(updatedAt.getTime() / 1000))
      : 2 + (parseInt(hash(JSON.stringify({ ...body, updatedAt: null })).slice(0, 7), 16) % 2_000_000_000);
    entries.push({ ...body, version });
  }
  return { entries, dropped };
}
