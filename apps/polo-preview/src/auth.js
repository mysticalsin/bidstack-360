// Polo sign-in for the polo-preview Worker: one-time codes and session cookies.
// Pure functions only (no `cloudflare:*` imports) so the contract is unit tested.
// The Worker answers /__auth/*; the Relay Durable Object (instance "auth")
// stores one code record per email.

export const SESSION_COOKIE = 'polo_session';
export const CODE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_S = 12 * 3600;
export const MAX_ATTEMPTS = 5;
export const RESEND_MS = 60_000;
export const MAX_CODES_PER_HOUR = 5;
/** New code records admitted per hour across all addresses, allowlisted or not. */
export const MAX_NEW_RECORDS_PER_HOUR = 200;
const HOUR_MS = 3600_000;

const enc = new TextEncoder();

export function normalizeEmail(value) {
  const email = String(value ?? '')
    .trim()
    .toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]+\.[a-z]{2,}$/.test(email) ? email : null;
}

export function isAllowed(email, allowList) {
  if (!email) return false;
  return String(allowList || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

/** Six digits, uniform: rejection sampling avoids modulo bias. */
export function newCode() {
  const buf = new Uint32Array(1);
  const limit = 4_294_000_000;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return String(buf[0] % 1_000_000).padStart(6, '0');
  }
}

export function normalizeCode(value) {
  const code = String(value ?? '').replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

function b64url(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  let s = text.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

export function safeEqual(a, b) {
  const left = enc.encode(String(a));
  const right = enc.encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/** Codes are stored as an HMAC bound to the email, never in clear. */
export function hashCode(secret, email, code) {
  return hmac(secret, `otp:${email}:${code}`);
}

export async function signSession(secret, email, nowS = Math.floor(Date.now() / 1000)) {
  const body = b64url(enc.encode(JSON.stringify({ e: email, x: nowS + SESSION_TTL_S })));
  return `${body}.${await hmac(secret, `session:${body}`)}`;
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Returns the email in a valid, unexpired session cookie, else null. */
export async function readSession(secret, cookieHeader, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret) return null;
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmac(secret, `session:${body}`))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!Number.isFinite(payload.x) || payload.x <= nowS) return null;
    return normalizeEmail(payload.e);
  } catch {
    return null;
  }
}

export function sessionCookie(value, maxAge = SESSION_TTL_S) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return sessionCookie('', 0);
}

/** Writes need a same-origin JSON request: blocks cross-site form posts. */
export function isSameOriginJson(req, url) {
  const origin = req.headers.get('origin');
  const type = req.headers.get('content-type') || '';
  return origin === url.origin && type.toLowerCase().startsWith('application/json');
}

// Paths an anonymous visitor may load when Polo sign-in is on: the SPA shell
// and its static files, so /login can render. No API and no data.
const PUBLIC_EXACT = new Set(['/login', '/favicon.ico', '/favicon.svg', '/robots.txt', '/manifest.webmanifest']);
const PUBLIC_PREFIX = ['/assets/', '/fonts/', '/brand/', '/locales/'];

export function isPublicPath(pathname) {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

/**
 * State transition for "send me a code". `record` is what storage holds for
 * the email (or undefined). Returns the record to store, or a retry delay.
 */
export function issueCode(record, codeHash, now = Date.now()) {
  const recent = (record?.sent || []).filter((t) => now - t < 3600_000);
  const last = recent.at(-1);
  if (last !== undefined && now - last < RESEND_MS) {
    return { ok: false, retryAfterS: Math.ceil((RESEND_MS - (now - last)) / 1000) };
  }
  if (recent.length >= MAX_CODES_PER_HOUR) {
    return { ok: false, retryAfterS: Math.ceil((3600_000 - (now - recent[0])) / 1000) };
  }
  return {
    ok: true,
    record: { hash: codeHash, exp: now + CODE_TTL_MS, attempts: 0, sent: [...recent, now] },
  };
}

/**
 * Aggregate admission for a first code request from an address. Every address
 * is counted the same way, so a full window answers 429 for known and unknown
 * emails alike and the allowlist stays unenumerable.
 */
export function admitNewRecord(window, now = Date.now()) {
  const current = window && now - window.start < HOUR_MS ? window : { start: now, count: 0 };
  if (current.count >= MAX_NEW_RECORDS_PER_HOUR) {
    return { ok: false, retryAfterS: Math.ceil((HOUR_MS - (now - current.start)) / 1000) };
  }
  return { ok: true, window: { start: current.start, count: current.count + 1 } };
}

/** True once a record's code expired and none of its sends count toward the hourly limit. */
export function isRecordExpired(record, now = Date.now()) {
  if (!record) return true;
  if (record.exp > now) return false;
  return !(record.sent || []).some((t) => now - t < HOUR_MS);
}

/** State transition for "check this code". A used code is burned. */
export function checkCode(record, codeHash, now = Date.now()) {
  if (!record?.hash || record.exp <= now || record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, record: record ? { ...record, hash: null } : record };
  }
  if (!safeEqual(record.hash, codeHash)) {
    const attempts = record.attempts + 1;
    return {
      ok: false,
      record: { ...record, attempts, hash: attempts >= MAX_ATTEMPTS ? null : record.hash },
    };
  }
  return { ok: true, record: { ...record, hash: null } };
}

function header(value) {
  return String(value).replace(/[\r\n]+/g, ' ');
}

/** Plain-text MIME message for the Cloudflare `send_email` binding. */
export function otpMessage({ from, to, code, host, now = new Date() }) {
  const id = `${crypto.randomUUID()}@${header(from).split('@')[1] || 'polo'}`;
  return [
    `From: Polo PreSales <${header(from)}>`,
    `To: <${header(to)}>`,
    `Subject: ${code} is your Polo sign-in code`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Your Polo sign-in code is ${code}.`,
    '',
    `It expires in 10 minutes and works once, on ${header(host)}.`,
    'If you did not ask for it, ignore this email.',
    '',
  ].join('\r\n');
}
