/**
 * Gmail / Outlook mail / Slack OAuth callbacks are public (the provider
 * redirect carries no Polo session) and trust only the sealed state from
 * lib/oauth-state.ts. Covers a valid, tampered, expired and replayed state
 * for each provider, plus a full Gmail connect.
 */
import { randomBytes } from 'node:crypto';

import { IntegrationProvider, prisma } from '@bidstack/db';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/fetch-timeout.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../../lib/fetch-timeout.js';
import { OAUTH_STATE_TTL_MS } from '../../lib/oauth-state.js';
import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';

const mockedFetch = vi.mocked(fetchWithTimeout);

const ENV_KEYS = [
  'INTEGRATION_TOKEN_KEY',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'MICROSOFT_GRAPH_CLIENT_ID',
  'MICROSOFT_GRAPH_CLIENT_SECRET',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
] as const;
const previousEnv: Record<string, string | undefined> = {};

let server: FastifyInstance;
let orgId = '';
let restoreAuth: (() => void) | null = null;

interface Case {
  name: string;
  base: string;
  provider: IntegrationProvider;
  tokenFailed: string;
}

const CASES: Case[] = [
  {
    name: 'gmail',
    base: '/api/v1/integrations/gmail/oauth',
    provider: IntegrationProvider.gmail,
    tokenFailed: 'error=gmail_token_failed',
  },
  {
    name: 'outlook',
    base: '/api/v1/integrations/microsoft/mail/oauth',
    provider: IntegrationProvider.microsoft_graph,
    tokenFailed: 'error=outlook_token_failed',
  },
  {
    name: 'slack',
    base: '/api/v1/integrations/slack/oauth',
    provider: IntegrationProvider.slack,
    tokenFailed: 'error=slack_token_failed',
  },
];

beforeAll(async () => {
  for (const k of ENV_KEYS) previousEnv[k] = process.env[k];
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString('hex');
  process.env.GMAIL_CLIENT_ID = 'test-gmail-client';
  process.env.GMAIL_CLIENT_SECRET = 'test-gmail-client-secret';
  process.env.MICROSOFT_GRAPH_CLIENT_ID = 'test-graph-client';
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = 'test-graph-client-secret';
  process.env.SLACK_CLIENT_ID = 'test-slack-client';
  process.env.SLACK_CLIENT_SECRET = 'test-slack-client-secret';
  _resetIntegrationTokenKey();

  const org = await createIsolatedOrg('oauthcb');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  for (const k of ENV_KEYS) {
    if (previousEnv[k] === undefined) delete process.env[k];
    else process.env[k] = previousEnv[k];
  }
  _resetIntegrationTokenKey();
});

beforeEach(() => {
  mockedFetch.mockReset();
});

async function startFlow(c: Case): Promise<string> {
  const res = await server.inject({ method: 'GET', url: `${c.base}/start` });
  expect(res.statusCode).toBe(200);
  const state = new URL(res.json<{ authUrl: string }>().authUrl).searchParams.get('state');
  expect(state).toBeTruthy();
  return state as string;
}

function callback(c: Case, state: string) {
  return server.inject({
    method: 'GET',
    url: `${c.base}/callback?code=test-code&state=${encodeURIComponent(state)}`,
  });
}

describe.each(CASES)('$name OAuth callback state', (c) => {
  it('accepts a valid state once, then rejects the replay', async () => {
    const state = await startFlow(c);
    mockedFetch.mockResolvedValue(new Response('denied', { status: 400 }));

    const first = await callback(c, state);
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toContain(c.tokenFailed);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    const replay = await callback(c, state);
    expect(replay.statusCode).toBe(409);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a tampered state without calling the provider', async () => {
    const state = await startFlow(c);
    const i = Math.floor(state.length / 2);
    const tampered = state.slice(0, i) + (state[i] === 'A' ? 'B' : 'A') + state.slice(i + 1);
    const res = await callback(c, tampered);
    expect(res.statusCode).toBe(403);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects an expired state without calling the provider', async () => {
    const state = await startFlow(c);
    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + OAUTH_STATE_TTL_MS + 1_000);
    try {
      const res = await callback(c, state);
      expect(res.statusCode).toBe(400);
    } finally {
      spy.mockRestore();
    }
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('a newer start invalidates the older state', async () => {
    const older = await startFlow(c);
    await startFlow(c);
    const res = await callback(c, older);
    expect(res.statusCode).toBe(409);
  });
});

it('rejects a state minted for a different provider', async () => {
  const slackState = await startFlow(CASES[2] as Case);
  const res = await callback(CASES[0] as Case, slackState);
  expect(res.statusCode).toBe(403);
});

it('completes a Gmail connect and binds the token to the user who started it', async () => {
  const state = await startFlow(CASES[0] as Case);
  mockedFetch
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'at-test', expires_in: 3600, scope: 'a b' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    .mockResolvedValue(new Response('nope', { status: 500 }));

  const res = await callback(CASES[0] as Case, state);
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toContain('connected=gmail');

  const rows = await prisma.integrationToken.findMany({
    where: { orgId, provider: IntegrationProvider.gmail },
    select: { status: true, deltaState: true },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('active');
  expect(rows[0]?.deltaState).toEqual({});
});
