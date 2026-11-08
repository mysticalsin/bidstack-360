/**
 * Workspace (Google Workspace, Microsoft 365) OAuth scopes and their plain
 * word descriptions. Read-only by default: Polo captures mail and meetings,
 * it never sends or edits on the user's behalf.
 */

/** Providers shown as one card each on the integrations page. */
export type WorkspaceProvider = 'google' | 'microsoft';

export const WORKSPACE_PROVIDERS: readonly WorkspaceProvider[] = ['google', 'microsoft'];

const GOOGLE = 'https://www.googleapis.com/auth/';
const GRAPH = 'https://graph.microsoft.com/';

/** Least-privilege scopes requested on connect. */
export const WORKSPACE_READ_SCOPES: Record<WorkspaceProvider, readonly string[]> = {
  google: ['openid', 'email', `${GOOGLE}gmail.readonly`, `${GOOGLE}calendar.readonly`],
  microsoft: ['openid', 'email', 'offline_access', `${GRAPH}User.Read`, `${GRAPH}Mail.Read`, `${GRAPH}Calendars.Read`],
};

export type ScopeKey =
  | 'identity'
  | 'offline'
  | 'mail_read'
  | 'calendar_read'
  | 'mail_send'
  | 'mail_write'
  | 'calendar_write';

/** One granted permission, phrased for the person who granted it. */
export interface ScopeGrant {
  key: ScopeKey;
  label: string;
  access: 'read' | 'write';
}

const SCOPE_ORDER: ScopeKey[] = [
  'identity',
  'offline',
  'mail_read',
  'calendar_read',
  'mail_send',
  'mail_write',
  'calendar_write',
];

const SCOPE_LABEL: Record<ScopeKey, { label: string; access: 'read' | 'write' }> = {
  identity: { label: 'See your email address', access: 'read' },
  offline: { label: 'Stay connected between sign-ins', access: 'read' },
  mail_read: { label: 'Read your email', access: 'read' },
  calendar_read: { label: 'Read your calendar', access: 'read' },
  mail_send: { label: 'Send email as you', access: 'write' },
  mail_write: { label: 'Change or delete your email', access: 'write' },
  calendar_write: { label: 'Change your calendar', access: 'write' },
};

function bare(scope: string): string {
  return scope.replace(GRAPH, '').replace(GOOGLE, '');
}

function classify(scope: string): ScopeKey[] {
  const s = bare(scope);
  switch (s) {
    case 'openid':
    case 'email':
    case 'profile':
    case 'User.Read':
    case 'userinfo.email':
    case 'userinfo.profile':
      return ['identity'];
    case 'offline_access':
      return ['offline'];
    case 'gmail.readonly':
    case 'gmail.metadata':
    case 'Mail.Read':
    case 'Mail.ReadBasic':
      return ['mail_read'];
    case 'calendar.readonly':
    case 'calendar.events.readonly':
    case 'Calendars.Read':
      return ['calendar_read'];
    case 'gmail.send':
    case 'Mail.Send':
      return ['mail_send'];
    case 'gmail.modify':
    case 'gmail.compose':
    case 'Mail.ReadWrite':
      return ['mail_read', 'mail_write'];
    case 'calendar':
    case 'calendar.events':
    case 'Calendars.ReadWrite':
      return ['calendar_read', 'calendar_write'];
    default:
      return [];
  }
}

function keysOf(scopes: readonly string[]): Set<ScopeKey> {
  const out = new Set<ScopeKey>();
  for (const scope of scopes) for (const k of classify(scope)) out.add(k);
  return out;
}

/** Plain word list of what a grant allows, deduped and in a stable order. */
export function describeScopes(scopes: readonly string[]): ScopeGrant[] {
  const keys = keysOf(scopes);
  return SCOPE_ORDER.filter((k) => keys.has(k)).map((key) => ({ key, ...SCOPE_LABEL[key] }));
}

/** True when the grant can read the mailbox. */
export function grantsMailRead(scopes: readonly string[]): boolean {
  return keysOf(scopes).has('mail_read');
}

/** True when the grant can read the calendar. */
export function grantsCalendarRead(scopes: readonly string[]): boolean {
  return keysOf(scopes).has('calendar_read');
}

/** True when the grant can send mail. Read-only connects never can. */
export function grantsMailSend(scopes: readonly string[]): boolean {
  return keysOf(scopes).has('mail_send');
}

/** True when the grant can create or change calendar events. */
export function grantsCalendarWrite(scopes: readonly string[]): boolean {
  return keysOf(scopes).has('calendar_write');
}

/**
 * Providers return every scope the user ever granted this app (Google with
 * include_granted_scopes, Microsoft always), so a read-only reconnect can come
 * back with send or write rights. Store only the read ones.
 */
export function readOnlyScopes(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => {
    const keys = classify(scope);
    return keys.length > 0 && keys.every((k) => SCOPE_LABEL[k].access === 'read');
  });
}

/**
 * Scopes for a Microsoft refresh_token request. Write scopes from an older
 * grant are dropped (a ReadWrite grant becomes its Read twin), offline_access
 * is kept, and an empty or write-only grant falls back to the read-only set.
 */
export function microsoftRefreshScopes(granted: readonly string[]): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  for (const scope of granted) {
    const s = bare(scope);
    if (s === 'Calendars.ReadWrite') add(`${GRAPH}Calendars.Read`);
    else if (s === 'Mail.ReadWrite') add(`${GRAPH}Mail.Read`);
    else if (readOnlyScopes([scope]).length === 1) add(scope);
  }
  const base = out.some((s) => grantsMailRead([s]) || grantsCalendarRead([s]))
    ? out
    : [...WORKSPACE_READ_SCOPES.microsoft];
  return base.includes('offline_access') ? base : [...base, 'offline_access'];
}

/** Sending mail and changing provider calendars stay off whatever the stored grant says. */
const PROVIDER_WRITES_ENABLED = false;

export function maySendMail(scopes: readonly string[]): boolean {
  return PROVIDER_WRITES_ENABLED && grantsMailSend(scopes);
}

export function mayWriteCalendar(scopes: readonly string[]): boolean {
  return PROVIDER_WRITES_ENABLED && grantsCalendarWrite(scopes);
}
