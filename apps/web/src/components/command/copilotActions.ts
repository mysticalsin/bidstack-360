/**
 * copilotActions — pure logic for the palette's "Ask Copilot" mode.
 *
 * No React/JSX so the gating rules are unit-testable in isolation. The
 * contract encoded here: the palette must NEVER fire an AI call it cannot
 * fully parameterize from what's on screen — an action missing its required
 * entity id is returned disabled with a machine reason the panel translates
 * into a helpful hint, instead of being hidden or (worse) called and 400ing.
 */
import type { IconName } from '@/components/ui/Icon';

export type CopilotActionKind =
  | 'email-draft'
  | 'account-intel'
  | 'deal-sentiment'
  | 'meeting-prep';

export type CopilotDisabledReason =
  | 'no-prompt'
  | 'no-account'
  | 'no-deal'
  | 'no-calendar-event';

/** Entity ids the copilot can read off the current route. */
export interface CopilotContext {
  accountId?: string;
  dealId?: string;
}

export interface CopilotAction {
  kind: CopilotActionKind;
  icon: IconName;
  enabled: boolean;
  /** Present exactly when disabled — the panel maps it to visible copy. */
  reason?: CopilotDisabledReason;
}

/** Leading '?' or '>' switches the palette into copilot mode. */
export function isCopilotQuery(query: string): boolean {
  const q = query.trimStart();
  return q.startsWith('?') || q.startsWith('>');
}

/** The user's actual prompt, without the mode-trigger prefix. */
export function stripCopilotPrefix(query: string): string {
  return query.trimStart().replace(/^[?>]\s*/, '');
}

/**
 * Heuristic for surfacing the "Ask Copilot" row inside normal search:
 * three-plus words (or a trailing question mark) reads as a sentence, not an
 * entity name. Two words stay plain search — account names like
 * "Canada Goose" must not grow an AI affordance.
 */
export function looksLikeCopilotAsk(query: string): boolean {
  const q = query.trim();
  if (!q || isCopilotQuery(q)) return false;
  if (q.endsWith('?')) return true;
  return q.split(/\s+/).length >= 3;
}

/**
 * Current-record context from the route. Only detail routes carry an id the
 * AI endpoints accept; list pages and dashboards yield no context.
 */
export function parseCopilotContext(pathname: string): CopilotContext {
  const account = /^\/accounts\/([^/]+)/.exec(pathname);
  if (account?.[1]) return { accountId: decodeURIComponent(account[1]) };
  const opp = /^\/opportunities\/([^/]+)/.exec(pathname);
  if (opp?.[1]) return { dealId: decodeURIComponent(opp[1]) };
  return {};
}

/**
 * The four AI actions the palette offers, gated by what it can actually
 * supply. Meeting prep stays disabled until a calendar-event detail route
 * exists — /calendar has no per-event page today, so there is never a
 * calendarEventId to send.
 */
export function buildCopilotActions(ctx: CopilotContext, prompt: string): CopilotAction[] {
  const hasPrompt = prompt.trim().length > 0;
  return [
    {
      kind: 'email-draft',
      icon: 'mail',
      enabled: hasPrompt,
      ...(hasPrompt ? {} : { reason: 'no-prompt' as const }),
    },
    {
      kind: 'account-intel',
      icon: 'building',
      enabled: Boolean(ctx.accountId),
      ...(ctx.accountId ? {} : { reason: 'no-account' as const }),
    },
    {
      kind: 'deal-sentiment',
      icon: 'target',
      enabled: Boolean(ctx.dealId),
      ...(ctx.dealId ? {} : { reason: 'no-deal' as const }),
    },
    { kind: 'meeting-prep', icon: 'clock', enabled: false, reason: 'no-calendar-event' },
  ];
}
