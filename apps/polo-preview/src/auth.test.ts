import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_CODES_PER_HOUR,
  MAX_NEW_RECORDS_PER_HOUR,
  RESEND_MS,
  SESSION_TTL_S,
  admitNewRecord,
  checkCode,
  clearSessionCookie,
  hashCode,
  isAllowed,
  isPublicPath,
  isRecordExpired,
  isSameOriginJson,
  issueCode,
  newCode,
  normalizeCode,
  normalizeEmail,
  otpMessage,
  readSession,
  sessionCookie,
  signSession,
} from './auth.js';
import { filterCookieHeader } from './protocol.js';

const here = dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-not-real';

describe('email and allowlist', () => {
  it('normalises case and whitespace and rejects header injection', () => {
    expect(normalizeEmail('  Tony@Example.COM ')).toBe('tony@example.com');
    expect(normalizeEmail('a@b.c')).toBeNull();
    expect(normalizeEmail('x@y.com\r\nBcc: z@w.com')).toBeNull();
    expect(normalizeEmail('x@y.com, z@w.com')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it('matches only exact allowlisted emails', () => {
    const list = 'a@x.com, B@y.com';
    expect(isAllowed('b@y.com', list)).toBe(true);
    expect(isAllowed('a@x.co', list)).toBe(false);
    expect(isAllowed(null, list)).toBe(false);
    expect(isAllowed('a@x.com', '')).toBe(false);
  });
});

describe('codes', () => {
  it('are six digits', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    expect(normalizeCode('12345')).toBeNull();
    expect(normalizeCode('12345a')).toBeNull();
  });

  it('hash binds the code to the email', async () => {
    const a = await hashCode(SECRET, 'a@x.com', '123456');
    expect(a).toBe(await hashCode(SECRET, 'a@x.com', '123456'));
    expect(a).not.toBe(await hashCode(SECRET, 'b@x.com', '123456'));
    expect(a).not.toContain('123456');
  });

  it('limits resends to one a minute and five an hour', () => {
    const t0 = 1_000_000_000_000;
    const first = issueCode(undefined, 'h1', t0);
    expect(first.ok).toBe(true);
    expect(first.record?.exp).toBe(t0 + CODE_TTL_MS);
    const soon = issueCode(first.record, 'h2', t0 + 1000);
    expect(soon).toEqual({ ok: false, retryAfterS: Math.ceil((RESEND_MS - 1000) / 1000) });

    let record = first.record;
    let t = t0;
    for (let i = 1; i < MAX_CODES_PER_HOUR; i++) {
      t += RESEND_MS;
      const next = issueCode(record, `h${i}`, t);
      expect(next.ok).toBe(true);
      record = next.record;
    }
    expect(issueCode(record, 'hx', t + RESEND_MS).ok).toBe(false);
    expect(issueCode(record, 'hx', t0 + 3600_000 + 1).ok).toBe(true);
  });

  it('works once, expires, and locks after too many wrong tries', () => {
    const t0 = 2_000_000_000_000;
    const { record } = issueCode(undefined, 'good', t0);
    const used = checkCode(record, 'good', t0 + 1);
    expect(used.ok).toBe(true);
    expect(checkCode(used.record, 'good', t0 + 2).ok).toBe(false);

    expect(checkCode(record, 'good', t0 + CODE_TTL_MS).ok).toBe(false);

    let r = record;
    for (let i = 0; i < MAX_ATTEMPTS; i++) r = checkCode(r, 'bad', t0 + 1).record;
    expect(r?.hash).toBeNull();
    expect(checkCode(r, 'good', t0 + 1).ok).toBe(false);
    expect(checkCode(undefined, 'good', t0).ok).toBe(false);
  });
});

describe('session cookie', () => {
  it('round-trips, expires, and rejects tampering', async () => {
    const now = 1_800_000_000;
    const token = await signSession(SECRET, 'a@x.com', now);
    const cookie = `other=1; polo_session=${token}`;
    expect(await readSession(SECRET, cookie, now + 10)).toBe('a@x.com');
    expect(await readSession(SECRET, cookie, now + SESSION_TTL_S)).toBeNull();
    expect(await readSession('other-secret', cookie, now)).toBeNull();
    expect(await readSession('', cookie, now)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ e: 'evil@x.com', x: now + 999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await readSession(SECRET, `polo_session=${forged}.${sig}`, now)).toBeNull();
    expect(await readSession(SECRET, `polo_session=${body}`, now)).toBeNull();
  });

  it('is HttpOnly, Secure and SameSite=Lax', () => {
    expect(sessionCookie('v')).toMatch(/HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });

  it('never crosses to the upstream or the box', () => {
    expect(filterCookieHeader('polo_session=abc; app=1; CF_Authorization=x')).toBe('app=1');
  });
});

describe('request guards', () => {
  const url = new URL('https://polo-preview.tony-walteur.workers.dev/__auth/code');
  const req = (headers: Record<string, string>) => new Request(url, { method: 'POST', headers });

  it('accepts only same-origin JSON writes', () => {
    expect(isSameOriginJson(req({ origin: url.origin, 'content-type': 'application/json' }), url)).toBe(true);
    expect(isSameOriginJson(req({ origin: 'https://evil.example', 'content-type': 'application/json' }), url)).toBe(false);
    expect(isSameOriginJson(req({ origin: url.origin, 'content-type': 'text/plain' }), url)).toBe(false);
    expect(isSameOriginJson(req({ 'content-type': 'application/json' }), url)).toBe(false);
  });

  it('lets anonymous visitors load only the sign-in shell', () => {
    for (const p of ['/login', '/assets/index-abc.js', '/favicon.svg']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/', '/dashboard', '/api/v1/demo/session', '/api/health', '/__health', '/loginx'])
      expect(isPublicPath(p)).toBe(false);
  });
});

describe('email message', () => {
  it('strips CR/LF from headers and states the expiry', () => {
    const raw = otpMessage({ from: 'polo@mail.example', to: 'a@x.com\r\nBcc: e@x.com', code: '042137', host: 'h.example' });
    expect(raw).toContain('Subject: 042137 is your Polo sign-in code');
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(raw).toContain('expires in 10 minutes');
  });
});

describe('code record storage stays bounded', () => {
  const now = 1_800_000_000_000;

  it('admits new records up to the hourly aggregate, then asks every address to wait', () => {
    let window: { start: number; count: number } | undefined;
    for (let i = 0; i < MAX_NEW_RECORDS_PER_HOUR; i++) {
      const r = admitNewRecord(window, now + i);
      expect(r.ok).toBe(true);
      window = r.window;
    }
    const full = admitNewRecord(window, now + 1000);
    expect(full.ok).toBe(false);
    expect(full.retryAfterS).toBeGreaterThan(0);
    expect(admitNewRecord(window, now + 3600_000).ok).toBe(true);
  });

  it('marks a record deletable only after its code expired and its sends left the hour', () => {
    const issued = issueCode(undefined, 'h', now).record;
    expect(isRecordExpired(issued, now)).toBe(false);
    expect(isRecordExpired(issued, now + CODE_TTL_MS + 1)).toBe(false);
    expect(isRecordExpired(issued, now + 3600_000 + 1)).toBe(true);
    expect(isRecordExpired(undefined, now)).toBe(true);
  });
});

describe('worker wiring', () => {
  const worker = readFileSync(join(here, 'worker.js'), 'utf8');
  const index = readFileSync(join(here, 'index.js'), 'utf8');
  const toml = readFileSync(join(here, '..', 'wrangler.toml'), 'utf8');

  it('keeps the live entry, classes and bindings', () => {
    expect(toml).toMatch(/^main = "src\/index\.js"$/m);
    expect(index).toMatch(/export \{ default, Relay \} from '\.\/worker\.js'/);
    expect(index).toMatch(/export \{ PreviewOrigin \} from '\.\/polo-container\.js'/);
    expect(toml).not.toMatch(/UPSTREAM_ORIGIN/);
    expect(toml).not.toMatch(/vercel/i);
    expect(toml).toMatch(/tag = "v1"\nnew_classes = \["Relay"\]/);
    expect(toml).toMatch(/tag = "v2"\nnew_sqlite_classes = \["PreviewOrigin"\]/);
    expect(toml).toMatch(/\[\[containers\]\]\nclass_name = "PreviewOrigin"/);
    expect(toml).toMatch(/max_instances = 1/);
    expect(toml).toMatch(/^preview_urls = false$/m);
    const container = readFileSync(join(here, 'polo-container.js'), 'utf8');
    for (const taken of ['state', 'ctx', 'env', 'container', 'start', 'stop', 'destroy']) {
      expect(container, `PreviewOrigin must not shadow Container.${taken}`).not.toMatch(new RegExp(`^  (async )?${taken}\\(`, 'm'));
    }
    expect(toml).toMatch(/crons = \["\*\/5 \* \* \* \*"\]/);
  });

  it('gates new code records and sweeps expired ones', () => {
    expect(worker).toMatch(/if \(issuing && !record\) \{\n\s+const admission = admitNewRecord\(/);
    expect(worker).toMatch(/async alarm\(\) \{[\s\S]*isRecordExpired\(record, now\)/);
    expect(worker).toMatch(/setAlarm\(Date\.now\(\) \+ OTP_SWEEP_MS\)/);
  });

  it('stays Access-only until every sign-in secret and binding exists', () => {
    expect(worker).toMatch(/env\.SESSION_SECRET && env\.OTP_EMAIL && env\.OTP_FROM/);
    expect(worker).toMatch(/Forbidden: Cloudflare Access sign-in required/);
  });
});
