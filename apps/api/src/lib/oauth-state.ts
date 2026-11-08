/**
 * Signed, encrypted OAuth `state` for provider callbacks that arrive without
 * a Polo session (Gmail, Outlook mail, Slack).
 *
 * WHY: the provider redirects the browser to our callback with no bearer
 * header, so the callback cannot use req.auth. Following the HubSpot pattern,
 * the start route seals { org, user, nonce, expiry } with AES-256-GCM
 * (encryptSecret: confidentiality plus an auth tag, so any tampering fails
 * decryption). The callback is public and trusts only what it can open.
 *
 * Defence layers:
 *  - Tamper: GCM tag check, plus a purpose and provider binding so a state
 *    minted for one provider (or any other encryptSecret blob) is rejected.
 *  - Expiry: `exp` checked on the callback (10 minute TTL).
 *  - Replay and binding: the nonce is stored on the caller's own
 *    IntegrationToken row (org + user + provider) and consumed with a
 *    compare-and-swap, so a state works once and only for the user and org
 *    that started the flow.
 *  - The user must still be an active member of that org.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { prisma, type IntegrationProvider, type Prisma } from '@bidstack/db';
import { decryptSecret, encryptSecret } from '@bidstack/shared/server-crypto';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const PURPOSE = 'polo.oauth-state.v1';

export type OAuthStateProvider = 'gmail' | 'microsoft_mail' | 'slack';

export type OAuthStateFailure = 'invalid' | 'expired' | 'replayed';

export class OAuthStateError extends Error {
  constructor(readonly reason: OAuthStateFailure) {
    super(`OAuth state ${reason}`);
    this.name = 'OAuthStateError';
  }
}

interface SealedState {
  pur: string;
  prv: OAuthStateProvider;
  org: string;
  usr: string;
  n: string;
  exp: number;
}

export interface OpenedState {
  orgId: string;
  userId: string;
  nonce: string;
}

export function issueOAuthState(
  provider: OAuthStateProvider,
  who: { orgId: string; userId: string },
  now: number = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex');
  const sealed: SealedState = {
    pur: PURPOSE,
    prv: provider,
    org: who.orgId,
    usr: who.userId,
    n: nonce,
    exp: now + OAUTH_STATE_TTL_MS,
  };
  return { state: encryptSecret(JSON.stringify(sealed)), nonce };
}

/** Opens and validates the sealed state. Does not consume the nonce. */
export function openOAuthState(
  provider: OAuthStateProvider,
  state: string,
  now: number = Date.now(),
): OpenedState {
  let sealed: Partial<SealedState>;
  try {
    sealed = JSON.parse(decryptSecret(state)) as Partial<SealedState>;
  } catch {
    throw new OAuthStateError('invalid');
  }
  if (
    !sealed ||
    sealed.pur !== PURPOSE ||
    sealed.prv !== provider ||
    typeof sealed.org !== 'string' ||
    typeof sealed.usr !== 'string' ||
    typeof sealed.n !== 'string' ||
    typeof sealed.exp !== 'number'
  ) {
    throw new OAuthStateError('invalid');
  }
  if (now > sealed.exp) throw new OAuthStateError('expired');
  return { orgId: sealed.org, userId: sealed.usr, nonce: sealed.n };
}

function sameNonce(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Opens the state, checks the user is still active in the org, and consumes
 * the nonce stored under `field` on the caller's IntegrationToken row. A
 * second use of the same state throws 'replayed'.
 */
export async function consumeOAuthState(opts: {
  provider: OAuthStateProvider;
  integrationProvider: IntegrationProvider;
  field: string;
  state: string;
  now?: number;
}): Promise<{ orgId: string; userId: string }> {
  const opened = openOAuthState(opts.provider, opts.state, opts.now);
  const { orgId, userId, nonce } = opened;

  const user = await prisma.user.findFirst({
    where: { id: userId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new OAuthStateError('invalid');

  const record = await prisma.integrationToken.findUnique({
    where: {
      orgId_userId_provider: { orgId, userId, provider: opts.integrationProvider },
    },
    select: { id: true, deltaState: true },
  });
  const delta = (record?.deltaState ?? {}) as Record<string, unknown>;
  if (!record || !sameNonce(delta[opts.field], nonce)) {
    throw new OAuthStateError('replayed');
  }

  const { [opts.field]: _consumed, ...rest } = delta;
  // Compare-and-swap: only one concurrent callback can win the nonce.
  const swapped = await prisma.integrationToken.updateMany({
    where: {
      id: record.id,
      deltaState: { path: [opts.field], equals: nonce },
    },
    data: { deltaState: rest as Prisma.InputJsonValue },
  });
  if (swapped.count !== 1) throw new OAuthStateError('replayed');
  return { orgId, userId };
}

/** Maps a state failure onto the HTTP status the callbacks return. */
export function oauthStateHttpStatus(reason: OAuthStateFailure): 400 | 403 | 409 {
  if (reason === 'expired') return 400;
  if (reason === 'replayed') return 409;
  return 403;
}
