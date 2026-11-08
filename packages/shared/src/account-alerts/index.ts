// Account alerts (slice 21): pure rules shared by the API fan-out and the
// worker delivery jobs. No I/O here except postTeamsCard, which takes fetch.
import type {
  ChannelToggles,
  NotificationChannelGroups,
  NotificationChannelPrefs,
  NotificationKindGroup,
  NotificationType,
} from '../schemas/notification.js';

export const ACCOUNT_EVENT_KINDS = [
  'note_added',
  'task_created',
  'task_completed',
  'opportunity_created',
  'opportunity_stage_changed',
  'opportunity_owner_changed',
  'document_uploaded',
  'contact_added',
  'activity_logged',
] as const;
export type AccountEventKind = (typeof ACCOUNT_EVENT_KINDS)[number];

/** Repeats on the same account inside this window update one notification. */
export const ACCOUNT_ALERT_COALESCE_MS = 10 * 60_000;
/** New in-app account alert rows per user per hour; repeats still coalesce. */
export const ACCOUNT_ALERT_IN_APP_HOURLY_LIMIT = 60;
/** Instant email or Teams posts per user per channel per hour. */
export const ACCOUNT_ALERT_EXTERNAL_HOURLY_LIMIT = 20;

export function accountGroupKey(companyId: string): string {
  return `account:${companyId}`;
}

export function groupForAccountEvent(kind: AccountEventKind): NotificationKindGroup {
  if (kind.startsWith('opportunity_')) return 'deals';
  if (kind.startsWith('task_')) return 'tasks';
  return 'account_activity';
}

export function groupForNotificationType(type: NotificationType): NotificationKindGroup | null {
  switch (type) {
    case 'mention':
      return 'mentions';
    case 'stage_change':
      return 'deals';
    case 'task_due':
      return 'tasks';
    case 'account_activity':
      return 'account_activity';
    default:
      return null;
  }
}

const DEFAULT_TOGGLES: ChannelToggles = { in_app: true, email: false, teams: false };

export const DEFAULT_CHANNEL_PREFS: NotificationChannelPrefs = {
  groups: {
    account_activity: { ...DEFAULT_TOGGLES },
    deals: { ...DEFAULT_TOGGLES },
    tasks: { ...DEFAULT_TOGGLES },
    mentions: { ...DEFAULT_TOGGLES },
  },
  dailyDigest: false,
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Read the stored JSON defensively; anything missing or malformed falls back to defaults. */
export function resolveChannelGroups(raw: unknown): NotificationChannelGroups {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const groups = (src.groups && typeof src.groups === 'object' ? src.groups : {}) as Record<string, unknown>;
  const out = {} as NotificationChannelGroups;
  for (const key of Object.keys(DEFAULT_CHANNEL_PREFS.groups) as NotificationKindGroup[]) {
    const g = (groups[key] && typeof groups[key] === 'object' ? groups[key] : {}) as Record<string, unknown>;
    const d = DEFAULT_CHANNEL_PREFS.groups[key];
    out[key] = { in_app: bool(g.in_app, d.in_app), email: bool(g.email, d.email), teams: bool(g.teams, d.teams) };
  }
  return out;
}

export interface AudienceInput {
  actorUserId: string | null;
  keyAccountOwnerId: string | null;
  teamUserIds: string[];
  opportunityOwnerIds: Array<string | null>;
  follows: Array<{ userId: string; muted: boolean }>;
}

/**
 * Who hears about an account event: team members, the key account owner,
 * opportunity owners and explicit followers. A muted follow row silences any
 * of those. The actor never hears about their own action.
 */
export function computeAccountAudience(input: AudienceInput): string[] {
  const muted = new Set(input.follows.filter((f) => f.muted).map((f) => f.userId));
  const candidates = [
    ...input.teamUserIds,
    input.keyAccountOwnerId,
    ...input.opportunityOwnerIds,
    ...input.follows.filter((f) => !f.muted).map((f) => f.userId),
  ];
  const out = new Set<string>();
  for (const id of candidates) {
    if (!id || id === input.actorUserId || muted.has(id)) continue;
    out.add(id);
  }
  return [...out];
}

/** True when an earlier unread alert on the same account is still inside the window. */
export function shouldCoalesce(lastEventAt: Date | null, now: Date, windowMs = ACCOUNT_ALERT_COALESCE_MS): boolean {
  if (!lastEventAt) return false;
  const age = now.getTime() - lastEventAt.getTime();
  return age >= 0 && age <= windowMs;
}

export function coalescedTitle(count: number, companyName: string): string {
  return `${count} new updates on ${companyName}`;
}

export function alertBody(actorName: string | null, latestTitle: string): string {
  return actorName ? `${actorName}: ${latestTitle}` : latestTitle;
}

/** Shown as a warning in the team dialog; allocation is a planning signal, not a hard cap. */
export function isOverAllocated(totalPct: number): boolean {
  return totalPct > 100;
}

const TEAMS_HOST_SUFFIXES = [
  '.logic.azure.com',
  '.powerplatform.com',
  '.webhook.office.com',
  '.environment.api.powerplatform.com',
];

/**
 * A Teams Workflows (or legacy connector) webhook: https, default port, no
 * credentials in the URL, and a Microsoft host. Anything else is refused so the
 * stored URL can never be pointed at an internal service.
 */
export function isAllowedTeamsWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  return TEAMS_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

export interface TeamsCardInput {
  title: string;
  body?: string | null;
  url?: string | null;
}

/** Message envelope accepted by the Teams "post to a channel or chat when a webhook request is received" workflow. */
export function buildTeamsAdaptiveCard(input: TeamsCardInput): Record<string, unknown> {
  const body: Array<Record<string, unknown>> = [
    { type: 'TextBlock', text: input.title, weight: 'Bolder', size: 'Medium', wrap: true },
  ];
  if (input.body) body.push({ type: 'TextBlock', text: input.body, wrap: true, isSubtle: true });
  const actions = input.url ? [{ type: 'Action.OpenUrl', title: 'Open in Polo', url: input.url }] : [];
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          actions,
        },
      },
    ],
  };
}

export type TeamsPostResult = { ok: true; status: number } | { ok: false; status: number | null; reason: string };

/** Post a card. Redirects are refused so a valid host cannot bounce the request elsewhere. */
export async function postTeamsCard(
  webhookUrl: string,
  card: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<TeamsPostResult> {
  if (!isAllowedTeamsWebhookUrl(webhookUrl)) return { ok: false, status: null, reason: 'invalid_webhook_url' };
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, reason: 'provider_error' };
  } catch {
    return { ok: false, status: null, reason: 'network_error' };
  }
}

/** Absolute link for email and Teams; in-app keeps the relative path. */
export function absoluteAppUrl(baseUrl: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
