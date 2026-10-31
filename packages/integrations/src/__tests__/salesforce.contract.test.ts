import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SalesforcePlugin } from '../salesforce/index.js';
import { ctx, makeConfig, mockFetch } from './helpers.js';

const FAKE_ID = 'sf-client-id-fake';
const FAKE_SECRET = 'sf-client-secret-fake';

describe('Salesforce plugin contract (mocked HTTP, no real keys)', () => {
  const plugin = new SalesforcePlugin();

  beforeEach(() => {
    vi.stubEnv('SALESFORCE_CLIENT_ID', FAKE_ID);
    vi.stubEnv('SALESFORCE_CLIENT_SECRET', FAKE_SECRET);
    vi.stubEnv('SALESFORCE_LOGIN_URL', 'https://login.example.test');
    vi.stubEnv('SALESFORCE_REDIRECT_URI', 'https://app.example.test/cb');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('getAuthUrl builds an authorize URL with code flow, scope and an org-bound state', async () => {
    const url = new URL(await plugin.getAuthUrl('org_42', 'https://app.example.test/cb'));
    expect(url.origin + url.pathname).toBe('https://login.example.test/services/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(FAKE_ID);
    expect(url.searchParams.get('scope')).toBe('api refresh_token');
    const state = JSON.parse(Buffer.from(url.searchParams.get('state')!, 'base64url').toString());
    expect(state).toEqual({ orgId: 'org_42', provider: 'salesforce' });
  });

  it('connect exchanges the code and stores tokens + instance URL', async () => {
    const { calls } = mockFetch([
      { json: { access_token: 'at', refresh_token: 'rt', instance_url: 'https://acme.my.example.test' } },
    ]);
    const out = await plugin.connect(makeConfig(), 'code123');
    expect(calls[0].url).toBe('https://login.example.test/services/oauth2/token');
    expect(calls[0].method).toBe('POST');
    const body = new URLSearchParams(calls[0].body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code123');
    expect(body.get('redirect_uri')).toBe('https://app.example.test/cb');
    expect(out.status).toBe('connected');
    expect(out.credentials).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      instanceUrl: 'https://acme.my.example.test',
    });
  });

  it('connect refuses without client credentials and makes no network call', async () => {
    vi.stubEnv('SALESFORCE_CLIENT_SECRET', '');
    const { fn } = mockFetch([]);
    await expect(plugin.connect(makeConfig(), 'c')).rejects.toThrow(/not configured/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('connect failure does not leak the response body', async () => {
    mockFetch([{ status: 400, json: { error: 'invalid_grant', secret_echo: 'LEAKME' } }]);
    const err = await plugin.connect(makeConfig(), 'c').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Salesforce token exchange failed (HTTP 400)');
    expect((err as Error).message).not.toContain('LEAKME');
  });

  it('validate: missing creds → invalid without network; 200 → valid; 401 → invalid; network error → invalid', async () => {
    const { fn } = mockFetch([{ status: 200 }, { status: 401 }, new Error('ECONNRESET')]);
    expect(await plugin.validate(makeConfig())).toEqual({ valid: false, message: 'Missing credentials' });
    expect(fn).not.toHaveBeenCalled();
    const cfg = makeConfig({ credentials: { accessToken: 'at', instanceUrl: 'https://i.example.test' } });
    expect(await plugin.validate(cfg)).toEqual({ valid: true, message: undefined });
    expect(fn.mock.calls[0][0]).toBe('https://i.example.test/services/data/v60.0/limits');
    expect(await plugin.validate(cfg)).toEqual({ valid: false, message: 'HTTP 401' });
    expect(await plugin.validate(cfg)).toEqual({ valid: false, message: 'ECONNRESET' });
  });

  it('refresh rotates the access token and keeps the refresh token', async () => {
    const { calls } = mockFetch([{ json: { access_token: 'at2' } }]);
    const cfg = makeConfig({ credentials: { accessToken: 'at', refreshToken: 'rt', instanceUrl: 'https://i' } });
    const out = await plugin.refresh(cfg);
    expect(new URLSearchParams(calls[0].body).get('grant_type')).toBe('refresh_token');
    expect(out.credentials).toEqual({ accessToken: 'at2', refreshToken: 'rt', instanceUrl: 'https://i' });
  });

  it('refresh without a refresh token throws before any call', async () => {
    const { fn } = mockFetch([]);
    await expect(plugin.refresh(makeConfig({ credentials: { accessToken: 'at' } }))).rejects.toThrow(/Cannot refresh/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('disconnect revokes best-effort and swallows network errors', async () => {
    const { calls } = mockFetch([new Error('offline')]);
    await expect(plugin.disconnect(makeConfig({ credentials: { accessToken: 'at' } }))).resolves.toBeUndefined();
    expect(calls[0].url).toBe('https://login.example.test/services/oauth2/revoke');
  });

  it('salesforce_query URL-encodes SOQL and sends the bearer token', async () => {
    const { calls } = mockFetch([{ json: { totalSize: 0, records: [] } }]);
    const cfg = makeConfig({ credentials: { accessToken: 'at', instanceUrl: 'https://i.example.test' } });
    const tool = plugin.getTools().find((t) => t.name === 'salesforce_query')!;
    const res = await tool.execute({ soql: "SELECT Id FROM Account WHERE Name = 'A&B'" }, ctx(cfg));
    expect(res).toEqual({ totalSize: 0, records: [] });
    expect(calls[0].url).toBe(
      `https://i.example.test/services/data/v60.0/query?q=${encodeURIComponent("SELECT Id FROM Account WHERE Name = 'A&B'")}`,
    );
    expect(calls[0].headers.authorization).toBe('Bearer at');
  });

  it('salesforce_create_record POSTs JSON fields and surfaces HTTP failures', async () => {
    const { calls } = mockFetch([{ json: { id: '001', success: true } }, { status: 400 }]);
    const cfg = makeConfig({ credentials: { accessToken: 'at', instanceUrl: 'https://i' } });
    const tool = plugin.getTools().find((t) => t.name === 'salesforce_create_record')!;
    await expect(tool.execute({ sobject: 'Account', fields: { Name: 'Acme' } }, ctx(cfg))).resolves.toEqual({
      id: '001',
      success: true,
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://i/services/data/v60.0/sobjects/Account');
    expect(JSON.parse(calls[0].body!)).toEqual({ Name: 'Acme' });
    await expect(tool.execute({ sobject: 'Account', fields: {} }, ctx(cfg))).rejects.toThrow(
      'Salesforce create failed: 400',
    );
  });

  it('tools refuse to run when not connected', async () => {
    for (const tool of plugin.getTools()) {
      await expect(tool.execute({ soql: 'x', sobject: 'A', fields: {} }, ctx(makeConfig()))).rejects.toThrow(
        'Salesforce not connected',
      );
    }
  });

  it('sync is an explicit no-op stub today (documents current contract)', async () => {
    expect(await plugin.sync(makeConfig())).toEqual({ created: 0, updated: 0, deleted: 0, errors: [] });
  });
});
