import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MicrosoftPlugin } from '../microsoft/index.js';
import { ctx, makeConfig, mockFetch } from './helpers.js';

describe('Microsoft 365 plugin contract (mocked Graph, no real keys)', () => {
  const plugin = new MicrosoftPlugin();

  beforeEach(() => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'ms-client-fake');
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'ms-secret-fake');
    vi.stubEnv('MICROSOFT_TENANT_ID', 'tenant-fake');
    vi.stubEnv('MICROSOFT_REDIRECT_URI', 'https://app.example.test/ms/cb');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('getAuthUrl targets the tenant authorize endpoint with offline_access and org-bound state', async () => {
    const url = new URL(await plugin.getAuthUrl('org_7', 'https://app.example.test/ms/cb'));
    expect(url.href.startsWith('https://login.microsoftonline.com/tenant-fake/oauth2/v2.0/authorize?')).toBe(true);
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(JSON.parse(Buffer.from(url.searchParams.get('state')!, 'base64url').toString())).toEqual({
      orgId: 'org_7',
      provider: 'microsoft',
    });
  });

  it("falls back to the 'common' tenant when none is configured", async () => {
    vi.stubEnv('MICROSOFT_TENANT_ID', undefined as unknown as string);
    delete process.env.MICROSOFT_TENANT_ID;
    const url = await plugin.getAuthUrl('o', 'r');
    expect(url.startsWith('https://login.microsoftonline.com/common/')).toBe(true);
  });

  it('connect exchanges the code at the tenant token endpoint', async () => {
    const { calls } = mockFetch([{ json: { access_token: 'at', refresh_token: 'rt' } }]);
    const out = await plugin.connect(makeConfig(), 'code-1');
    expect(calls[0].url).toBe('https://login.microsoftonline.com/tenant-fake/oauth2/v2.0/token');
    const body = new URLSearchParams(calls[0].body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe('https://app.example.test/ms/cb');
    expect(out).toMatchObject({ status: 'connected', credentials: { accessToken: 'at', refreshToken: 'rt' } });
  });

  it('connect failure message carries only the status code', async () => {
    mockFetch([{ status: 401, json: { error_description: 'LEAKME' } }]);
    await expect(plugin.connect(makeConfig(), 'c')).rejects.toThrow(/^Microsoft token exchange failed \(HTTP 401\)$/);
  });

  it('connect without client credentials throws before any call', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', '');
    const { fn } = mockFetch([]);
    await expect(plugin.connect(makeConfig(), 'c')).rejects.toThrow(/not configured/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('validate calls /me and maps status codes', async () => {
    const { fn } = mockFetch([{ status: 200 }, { status: 403 }]);
    expect(await plugin.validate(makeConfig())).toEqual({ valid: false, message: 'Missing access token' });
    const cfg = makeConfig({ credentials: { accessToken: 'at' } });
    expect(await plugin.validate(cfg)).toEqual({ valid: true, message: undefined });
    expect(fn.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/me');
    expect(await plugin.validate(cfg)).toEqual({ valid: false, message: 'HTTP 403' });
  });

  it('refresh keeps the old refresh token when Graph does not rotate it', async () => {
    mockFetch([{ json: { access_token: 'at2' } }, { json: { access_token: 'at3', refresh_token: 'rt3' } }]);
    const cfg = makeConfig({ credentials: { accessToken: 'at', refreshToken: 'rt' } });
    expect((await plugin.refresh(cfg)).credentials).toEqual({ accessToken: 'at2', refreshToken: 'rt' });
    expect((await plugin.refresh(cfg)).credentials).toEqual({ accessToken: 'at3', refreshToken: 'rt3' });
  });

  it('microsoft_list_events encodes the date window into calendarview', async () => {
    const { calls } = mockFetch([{ json: { value: [] } }]);
    const tool = plugin.getTools().find((t) => t.name === 'microsoft_list_events')!;
    const cfg = makeConfig({ credentials: { accessToken: 'at' } });
    await tool.execute({ startDate: '2026-11-01T00:00:00+01:00', endDate: '2026-11-02T00:00:00+01:00' }, ctx(cfg));
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/v1.0/me/calendarview');
    expect(u.searchParams.get('startDateTime')).toBe('2026-11-01T00:00:00+01:00');
    expect(calls[0].headers.authorization).toBe('Bearer at');
  });

  it('microsoft_send_email posts a Graph sendMail payload and reports sent', async () => {
    const { calls } = mockFetch([{ status: 202 }]);
    const tool = plugin.getTools().find((t) => t.name === 'microsoft_send_email')!;
    const cfg = makeConfig({ credentials: { accessToken: 'at' } });
    await expect(tool.execute({ to: 'a@example.test', subject: 'Hi', body: '<p>x</p>' }, ctx(cfg))).resolves.toEqual({
      sent: true,
    });
    expect(JSON.parse(calls[0].body!)).toEqual({
      message: {
        subject: 'Hi',
        body: { contentType: 'HTML', content: '<p>x</p>' },
        toRecipients: [{ emailAddress: { address: 'a@example.test' } }],
      },
    });
  });

  it('tools refuse to run when not connected', async () => {
    for (const tool of plugin.getTools()) {
      await expect(tool.execute({}, ctx(makeConfig()))).rejects.toThrow('Microsoft not connected');
    }
  });
});
