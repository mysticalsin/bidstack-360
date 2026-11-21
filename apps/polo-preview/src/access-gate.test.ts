import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import worker from './worker.js';

vi.mock('cloudflare:email', () => ({
  EmailMessage: class EmailMessage {
    constructor(
      public from: string,
      public to: string,
      public raw: string,
    ) {}
  },
}));

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  },
}));

vi.mock('@cloudflare/containers', () => ({
  getContainer: () => {
    throw new Error('container should not be called');
  },
}));

const TEAM = 'https://tony-walteur.cloudflareaccess.com';
const USER = 'alex.example@example.test';
const AUD = 'audience-under-test';
const here = dirname(fileURLToPath(import.meta.url));

let privateKey: CryptoKey;

function b64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = encodeJson({ alg: 'RS256', kid: 'test-key' });
  const body = encodeJson(payload);
  const data = new TextEncoder().encode(`${header}.${body}`);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data));
  return `${header}.${body}.${b64url(sig)}`;
}

function relayEnv(extra: Record<string, string | undefined>) {
  const relayFetch = vi.fn(async () => new Response('relayed', { status: 200 }));
  return {
    relayFetch,
    env: {
      ...extra,
      RELAY: {
        idFromName: () => 'box',
        get: () => ({ fetch: relayFetch }),
      },
    },
  };
}

function dashboard(token: string): Request {
  return new Request('https://polo.example/dashboard', {
    headers: { 'cf-access-jwt-assertion': token },
  });
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign'],
  );
  privateKey = pair.privateKey;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  delete jwk.key_ops;
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `${TEAM}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    }),
  );
});

describe('Access audience', () => {
  it('accepts a signed token whose audience matches the configured Access audience', async () => {
    const token = await signJwt({
      iss: TEAM,
      aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
      email: USER,
    });
    const { env, relayFetch } = relayEnv({
      ACCESS_AUD: AUD,
      ALLOWED_EMAILS: USER,
      POLO_ADMIN_EMAILS: USER,
    });
    const res = await worker.fetch(dashboard(token), env);
    expect(res.status).toBe(200);
    expect(relayFetch).toHaveBeenCalledOnce();
  });

  it('rejects a signed token with no audience when ACCESS_AUD is unset', async () => {
    const token = await signJwt({
      iss: TEAM,
      exp: Math.floor(Date.now() / 1000) + 600,
      email: USER,
    });
    const { env, relayFetch } = relayEnv({
      ALLOWED_EMAILS: USER,
      POLO_ADMIN_EMAILS: USER,
    });
    const res = await worker.fetch(dashboard(token), env);
    expect(res.status).toBe(403);
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it('returns null from audience verification before treating a missing audience as a match', () => {
    const source = readFileSync(join(here, 'worker.js'), 'utf8');
    expect(source).toMatch(/if \(!env\.ACCESS_AUD\) return null;\n\s*const now = Math\.floor\(Date\.now\(\) \/ 1000\);\n\s*const aud = /);
  });
});

describe('admin and Access secrets', () => {
  const toml = readFileSync(join(here, '..', 'wrangler.toml'), 'utf8');

  it('refuses an authenticated route when the admin secret is absent', async () => {
    const token = await signJwt({
      iss: TEAM,
      aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
      email: USER,
    });
    const { env, relayFetch } = relayEnv({
      ACCESS_AUD: AUD,
      ALLOWED_EMAILS: USER,
    });
    const res = await worker.fetch(dashboard(token), env);
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Cloudflare Access sign-in required/);
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it('does not publish admin or Access settings as vars', () => {
    const vars = toml.match(/\[vars\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? '';
    expect(vars).not.toMatch(/^\s*POLO_ADMIN_EMAILS\s*=/m);
    expect(vars).not.toMatch(/^\s*ACCESS_AUD\s*=/m);
    expect(vars).not.toMatch(/^\s*ALLOWED_EMAILS\s*=/m);
    expect(toml).toMatch(/secret\s+ACCESS_AUD/);
    expect(toml).toMatch(/secret\s+POLO_ADMIN_EMAILS/);
    expect(toml).toMatch(/secret\s+ALLOWED_EMAILS/);
    expect(toml).not.toMatch(/wrangler deploy/);
  });
});
