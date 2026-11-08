// polo-preview Worker: the front door. v28 = live v27 plus Polo sign-in.
// Identity comes from, in order: a verified Cloudflare Access JWT, then a Polo
// session cookie minted after a one-time code (only when SESSION_SECRET,
// OTP_EMAIL and OTP_FROM are configured). With PREVIEW bound (v29) verified
// requests go to the Polo container (polo-container.js); otherwise to
// UPSTREAM_ORIGIN when set, else relayed to the box over the Relay DO.
// Do not upload this script from CI: a binding mismatch drops the relay.
import { EmailMessage } from 'cloudflare:email';
import { DurableObject } from 'cloudflare:workers';
import { getContainer } from '@cloudflare/containers';
import {
  CODE_TTL_MS,
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
import {
  DROP_REQUEST,
  base64ToBytes,
  bytesToBase64,
  filterCookieHeader,
  filterRequestHeaders,
  isApiPath,
  rewriteResponseHeaders,
  targetUrl,
} from './protocol.js';

const TEAM = 'https://tony-walteur.cloudflareaccess.com';
let jwksCache = null;

function b64urlToBytes(s) {
  let text = s.replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function verifyAccess(req, env) {
  const tok = req.headers.get('cf-access-jwt-assertion');
  if (!tok) return null;
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  if (!jwksCache || jwksCache.exp < Date.now()) {
    try {
      const res = await fetch(`${TEAM}/cdn-cgi/access/certs`);
      const body = res.ok ? await res.json() : null;
      if (Array.isArray(body?.keys) && body.keys.length > 0) {
        jwksCache = { keys: body.keys, exp: Date.now() + 3600_000 };
      } else if (!jwksCache) {
        return null;
      }
    } catch {
      if (!jwksCache) return null;
    }
  }
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    jwksCache = null;
    return null;
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    !aud.includes(env.ACCESS_AUD) ||
    payload.iss !== TEAM ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= now
  ) {
    return null;
  }
  if (!isAllowed(String(payload.email || '').toLowerCase(), env.ALLOWED_EMAILS)) return null;
  return { email: String(payload.email).toLowerCase(), via: 'access' };
}

function otpEnabled(env) {
  return Boolean(env.SESSION_SECRET && env.OTP_EMAIL && env.OTP_FROM);
}

async function identify(req, env) {
  const access = await verifyAccess(req, env);
  if (access) return access;
  if (!otpEnabled(env)) return null;
  const email = await readSession(env.SESSION_SECRET, req.headers.get('cookie'));
  return email && isAllowed(email, env.ALLOWED_EMAILS) ? { email, via: 'code' } : null;
}

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function authStore(env) {
  return env.RELAY.get(env.RELAY.idFromName('auth'));
}

// /__auth/me, /__auth/code, /__auth/verify, /__auth/logout.
async function handleAuth(req, env, url, who) {
  const path = url.pathname;
  if (path === '/__auth/me' && req.method === 'GET') {
    return who ? json({ email: who.email, via: who.via }) : json({ otp: otpEnabled(env) }, 401);
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isSameOriginJson(req, url)) return json({ error: 'bad_origin' }, 403);

  if (path === '/__auth/logout') {
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }
  if (!otpEnabled(env)) return json({ error: 'otp_unavailable' }, 503);

  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: 'invalid_email' }, 400);

  if (path === '/__auth/code') {
    const code = newCode();
    const hash = await hashCode(env.SESSION_SECRET, email, code);
    const res = await authStore(env).fetch('https://auth/__otp/issue', {
      method: 'POST',
      body: JSON.stringify({ email, hash }),
    });
    const issued = await res.json();
    if (!issued.ok) {
      return json({ error: 'slow_down', retryAfterSeconds: issued.retryAfterS }, 429, {
        'retry-after': String(issued.retryAfterS),
      });
    }
    // Same answer for unknown emails: the allowlist is not enumerable.
    if (isAllowed(email, env.ALLOWED_EMAILS)) {
      const raw = otpMessage({ from: env.OTP_FROM, to: email, code, host: url.host });
      try {
        await env.OTP_EMAIL.send(new EmailMessage(env.OTP_FROM, email, raw));
      } catch (err) {
        console.log(JSON.stringify({ otp: 'send_failed', error: String(err).slice(0, 200) }));
        return json({ error: 'send_failed' }, 502);
      }
    }
    return json({ sent: true, expiresInSeconds: CODE_TTL_MS / 1000 }, 202);
  }

  if (path === '/__auth/verify') {
    const code = normalizeCode(body.code);
    if (!code) return json({ error: 'invalid_code' }, 400);
    const hash = await hashCode(env.SESSION_SECRET, email, code);
    const res = await authStore(env).fetch('https://auth/__otp/check', {
      method: 'POST',
      body: JSON.stringify({ email, hash }),
    });
    const checked = await res.json();
    if (!checked.ok || !isAllowed(email, env.ALLOWED_EMAILS)) {
      return json({ error: 'wrong_code' }, 401);
    }
    const token = await signSession(env.SESSION_SECRET, email);
    return json({ email }, 200, { 'set-cookie': sessionCookie(token) });
  }
  return json({ error: 'not_found' }, 404);
}

function requestHeadersForBox(req, publicOrigin) {
  const headers = [];
  for (const [key, value] of req.headers) {
    const name = key.toLowerCase();
    if (DROP_REQUEST.includes(name)) continue;
    if (name === 'cookie') {
      const cookie = filterCookieHeader(value);
      if (cookie) headers.push(['cookie', cookie]);
      continue;
    }
    headers.push([key, value]);
  }
  const publicUrl = new URL(publicOrigin);
  headers.push(['x-forwarded-proto', 'https']);
  headers.push(['x-forwarded-host', publicUrl.host]);
  return headers;
}

// Upstream mode (v27). Identity is checked before this call. Access and
// Cloudflare headers, cf_* cookies and the Polo session cookie never reach the
// upstream; the app's own Authorization header (demo bearer token) passes.
async function proxyUpstream(req, env, url) {
  const upstream = new URL(env.UPSTREAM_ORIGIN);
  // Never new URL(path, base): a path such as //attacker.example/x replaces the origin.
  const target = targetUrl(url.pathname + url.search, upstream.origin);
  const headers = new Headers();
  for (const [key, value] of filterRequestHeaders(req.headers)) {
    if (key.toLowerCase().startsWith('cf-')) continue;
    headers.append(key, value);
  }
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', 'https');
  const init = { method: req.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = await req.arrayBuffer();
  const started = Date.now();
  let res;
  try {
    res = await fetch(target, init);
    console.log(JSON.stringify({ upstream: upstream.host, method: req.method, path: url.pathname, status: res.status, ms: Date.now() - started, vercelId: res.headers.get('x-vercel-id') }));
  } catch (err) {
    console.log(JSON.stringify({ upstream: upstream.host, method: req.method, path: url.pathname, error: String(err), ms: Date.now() - started }));
    return Response.json(
      { error: 'upstream_unreachable', message: 'Polo demo is unreachable. Retry in a few seconds.' },
      { status: 502, headers: { 'cache-control': 'no-store', 'retry-after': '5' } },
    );
  }
  const out = new Headers(res.headers);
  const location = out.get('location');
  if (location) {
    try {
      const loc = new URL(location, upstream.origin);
      if (loc.origin === upstream.origin) out.set('location', url.origin + loc.pathname + loc.search + loc.hash);
    } catch {
      /* leave as is */
    }
  }
  out.set('x-polo-upstream', upstream.host);
  out.set('x-robots-tag', 'noindex');
  return new Response([101, 204, 304].includes(res.status) ? null : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: out,
  });
}

// Container mode (v29). Identity is checked before this call. The container
// API trusts the verified email only from loopback, so any client copy of the
// identity or forwarding headers is dropped here.
const CONTAINER_NAME = 'main';

async function toContainer(req, env, url, who) {
  const headers = new Headers();
  for (const [key, value] of filterRequestHeaders(req.headers)) {
    if (key.toLowerCase().startsWith('cf-')) continue;
    headers.append(key, value);
  }
  if (who?.email) headers.set('cf-access-authenticated-user-email', String(who.email));
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', 'https');
  const init = { method: req.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = await req.arrayBuffer();
  try {
    const res = await getContainer(env.PREVIEW, CONTAINER_NAME).fetch(new Request(url, init));
    const out = new Headers(res.headers);
    out.set('x-robots-tag', 'noindex');
    return new Response([101, 204, 304].includes(res.status) ? null : res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: out,
    });
  } catch (err) {
    console.log(JSON.stringify({ container: 'unavailable', path: url.pathname, error: String(err) }));
    return offlineResponse(req, url);
  }
}

async function containerHealth(env) {
  try {
    const health = await getContainer(env.PREVIEW, CONTAINER_NAME).health();
    return { mode: 'container', relay: health.phase === 'ready', ...health };
  } catch (err) {
    return { mode: 'container', relay: false, phase: 'starting', error: String(err) };
  }
}

function relayToBox(req, env, who) {
  const headers = new Headers(req.headers);
  if (who?.email) headers.set('cf-access-authenticated-user-email', String(who.email));
  return env.RELAY.get(env.RELAY.idFromName('box')).fetch(new Request(req, { headers }));
}

function signInRedirect(req, url) {
  const accept = req.headers.get('accept') || '';
  if (req.method === 'GET' && accept.includes('text/html') && !isApiPath(url.pathname)) {
    return new Response(null, { status: 302, headers: { ...NO_STORE, location: `${url.origin}/login` } });
  }
  return json({ error: 'sign_in_required' }, 401);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/__relay') {
      const key = req.headers.get('x-relay-key') || '';
      if (
        !env.RELAY_KEY ||
        !safeEqual(key, env.RELAY_KEY) ||
        req.headers.get('upgrade') !== 'websocket'
      ) {
        return new Response('unauthorized', { status: 401 });
      }
      return env.RELAY.get(env.RELAY.idFromName('box')).fetch(req);
    }
    const who = await identify(req, env);
    if (url.pathname.startsWith('/__auth/')) return handleAuth(req, env, url, who);
    if (!who) {
      if (!otpEnabled(env)) {
        return new Response('Forbidden: Cloudflare Access sign-in required', { status: 403 });
      }
      if (!isPublicPath(url.pathname)) return signInRedirect(req, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'sign_in_required' }, 401);
    }
    if (env.PREVIEW) {
      if (url.pathname.startsWith('/__internal')) return json({ error: 'not_found' }, 404);
      if (url.pathname === '/__health') return json(await containerHealth(env));
      if (req.headers.get('upgrade') === 'websocket') {
        return new Response('WebSockets are not relayed in the preview', { status: 501 });
      }
      return toContainer(req, env, url, who);
    }
    if (env.UPSTREAM_ORIGIN) {
      if (url.pathname === '/__health') {
        const health = await proxyUpstream(new Request(new URL('/api/health', req.url)), env, new URL('/api/health', req.url));
        const body = await health.json().catch(() => null);
        return Response.json(
          { mode: 'upstream', upstream: new URL(env.UPSTREAM_ORIGIN).host, status: health.status, health: body, relay: health.ok },
          { headers: { 'cache-control': 'no-store' } },
        );
      }
      return proxyUpstream(req, env, url);
    }
    if (url.pathname === '/__health') {
      return env.RELAY.get(env.RELAY.idFromName('box')).fetch(
        new Request(new URL('/__health', req.url), { method: 'GET' }),
      );
    }
    if (req.headers.get('upgrade') === 'websocket') {
      return new Response('WebSockets are not relayed in the preview', { status: 501 });
    }
    return relayToBox(req, env, who);
  },

  async scheduled(_event, env, ctx) {
    if (!env.PREVIEW) return;
    ctx.waitUntil(
      getContainer(env.PREVIEW, CONTAINER_NAME)
        .tick()
        .then((result) => console.log(JSON.stringify({ tick: result })))
        .catch((err) => console.log(JSON.stringify({ tick: 'failed', error: String(err) }))),
    );
  },
};

// Relay liveness (v26). The box VM is paused/snapshotted when idle, which leaves a
// half-open socket the DO still reports as OPEN. The box pings every 10s and the
// hibernation auto-response answers without waking the DO, so the auto-response
// timestamp is the freshest proof of life. A socket silent for STALE_MS is closed.
// With no live socket a request waits up to RECONNECT_WAIT_MS for the box to
// reconnect instead of failing at once; idempotent requests lost mid-flight are
// retried once; if the box is still away the visitor gets a self-retrying page
// (HTML) or a 503 + Retry-After (API), never the bare error string.
const STALE_MS = 35_000;
const RECONNECT_WAIT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 90_000;
const IDEMPOTENT = ['GET', 'HEAD', 'OPTIONS'];
const OTP_ADMISSION_KEY = 'otp-admission';
const OTP_SWEEP_MS = 15 * 60_000;
const OTP_SWEEP_BATCH = 500;
const LOST = Symbol('relay-lost');

function offlineResponse(req, url) {
  const common = { 'cache-control': 'no-store', 'retry-after': '5', 'x-robots-tag': 'noindex' };
  const accept = req.headers.get('accept') || '';
  if (req.method !== 'GET' || isApiPath(url.pathname) || !accept.includes('text/html')) {
    return Response.json(
      { error: 'preview_backend_reconnecting', message: 'Polo preview is reconnecting. Retry in a few seconds.', retryAfterSeconds: 5 },
      { status: 503, headers: common },
    );
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Polo is reconnecting</title>
<noscript><meta http-equiv="refresh" content="5"></noscript>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#1f2430}
.c{max-width:420px;padding:32px;text-align:center}.d{width:28px;height:28px;margin:0 auto 18px;border:3px solid #d5d9e0;border-top-color:#3b5bdb;border-radius:50%;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#5b6270}</style></head>
<body><div class="c"><div class="d"></div><h1>Polo is reconnecting</h1>
<p>The preview server is waking up. This page will reload by itself in a few seconds.</p></div>
<script>(function(){function t(){fetch('/__health',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(j&&j.relay)location.reload();else setTimeout(t,5000)}).catch(function(){setTimeout(t,5000)})}setTimeout(t,5000)})();</script>
</body></html>`;
  return new Response(html, { status: 503, headers: { ...common, 'content-type': 'text/html; charset=utf-8' } });
}

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pending = new Map();
    this.waiters = new Set();
    this.lastMessageAt = 0;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  lastSeen(ws) {
    let seen = this.lastMessageAt;
    try {
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      if (auto) seen = Math.max(seen, auto.getTime());
    } catch {
      /* not supported: fall back to attachment */
    }
    try {
      const att = ws.deserializeAttachment();
      if (att && Number.isFinite(att.connectedAt)) seen = Math.max(seen, att.connectedAt);
    } catch {
      /* no attachment */
    }
    return seen;
  }

  liveSocket() {
    const now = Date.now();
    const open = this.ctx.getWebSockets().filter((socket) => socket.readyState === 1);
    let best = null;
    let bestSeen = 0;
    for (const ws of open) {
      const seen = this.lastSeen(ws);
      if (now - seen > STALE_MS) {
        try {
          ws.close(1011, 'stale');
        } catch {
          /* already closed */
        }
        this.failPending(ws);
        continue;
      }
      if (seen >= bestSeen) {
        best = ws;
        bestSeen = seen;
      }
    }
    return best;
  }

  waitForSocket(ms) {
    const live = this.liveSocket();
    if (live) return Promise.resolve(live);
    return new Promise((resolve) => {
      const done = (ws) => {
        clearTimeout(timer);
        clearInterval(poll);
        this.waiters.delete(done);
        resolve(ws);
      };
      const timer = setTimeout(() => done(null), ms);
      const poll = setInterval(() => {
        const ws = this.liveSocket();
        if (ws) done(ws);
      }, 500);
      this.waiters.add(done);
    });
  }

  dispatch(ws, message) {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(new Response('Preview backend timeout', { status: 504 }));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        ws,
        done: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });
      try {
        ws.send(JSON.stringify({ id, ...message }));
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve({ lost: LOST, delivered: false });
      }
    });
  }

  // One-time code records live in the "auth" instance of this class, so no
  // new Durable Object class or migration is needed. Storage stays bounded: new
  // records pass an hourly aggregate admission and an alarm sweeps expired ones.
  async otp(req, url) {
    const { email, hash } = await req.json();
    const key = `otp:${email}`;
    const record = await this.ctx.storage.get(key);
    const issuing = url.pathname === '/__otp/issue';
    if (issuing && !record) {
      const admission = admitNewRecord(await this.ctx.storage.get(OTP_ADMISSION_KEY));
      if (!admission.ok) return Response.json({ ok: false, retryAfterS: admission.retryAfterS });
      await this.ctx.storage.put(OTP_ADMISSION_KEY, admission.window);
    }
    const result = issuing ? issueCode(record, hash) : checkCode(record, hash);
    if (result.record) {
      await this.ctx.storage.put(key, result.record);
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + OTP_SWEEP_MS);
      }
    }
    return Response.json({ ok: result.ok, retryAfterS: result.retryAfterS });
  }

  async alarm() {
    const now = Date.now();
    const records = await this.ctx.storage.list({ prefix: 'otp:', limit: OTP_SWEEP_BATCH });
    const expired = [...records].filter(([, record]) => isRecordExpired(record, now)).map(([key]) => key);
    for (let i = 0; i < expired.length; i += 128) await this.ctx.storage.delete(expired.slice(i, i + 128));
    if (records.size > expired.length || records.size === OTP_SWEEP_BATCH) {
      await this.ctx.storage.setAlarm(now + OTP_SWEEP_MS);
    }
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/__otp/issue' || url.pathname === '/__otp/check') {
      return this.otp(req, url);
    }
    if (url.pathname === '/__relay') {
      for (const old of this.ctx.getWebSockets()) {
        try {
          old.close(1012, 'replaced');
        } catch {
          /* already closed */
        }
        this.failPending(old);
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ connectedAt: Date.now() });
      for (const wake of [...this.waiters]) wake(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/__health') {
      const ws = this.liveSocket();
      return Response.json(
        {
          relay: Boolean(ws),
          lastSeenMsAgo: ws ? Date.now() - this.lastSeen(ws) : null,
          pending: this.pending.size,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    const publicOrigin = url.origin;
    const message = {
      method: req.method,
      path: url.pathname + url.search,
      headers: requestHeadersForBox(req, publicOrigin),
      body: ['GET', 'HEAD'].includes(req.method) ? null : bytesToBase64(await req.arrayBuffer()),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const ws = await this.waitForSocket(RECONNECT_WAIT_MS);
      if (!ws) return offlineResponse(req, url);
      const result = await this.dispatch(ws, message);
      if (!result || result.lost !== LOST) return result;
      // Socket died with the request in flight. Re-send only when it never reached
      // the box or the method is safe to repeat; never double-submit a write.
      if (result.delivered && !IDEMPOTENT.includes(req.method)) {
        return Response.json(
          { error: 'preview_connection_dropped', message: 'The connection dropped mid-request. Check the result, then retry.' },
          { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '5' } },
        );
      }
    }
    return offlineResponse(req, url);
  }

  async webSocketMessage(_ws, msg) {
    this.lastMessageAt = Date.now();
    let parsed;
    try {
      parsed = JSON.parse(typeof msg === 'string' ? msg : new TextDecoder().decode(msg));
    } catch {
      return;
    }
    const entry = this.pending.get(parsed.id);
    if (!entry) return;
    this.pending.delete(parsed.id);
    const publicOrigin = 'https://polo-preview.tony-walteur.workers.dev';
    const headers = new Headers();
    for (const [key, value] of rewriteResponseHeaders(parsed.headers || [], publicOrigin)) {
      headers.append(key, value);
    }
    headers.set('x-robots-tag', 'noindex');
    const body = parsed.body ? base64ToBytes(parsed.body) : null;
    entry.done(
      new Response([101, 204, 304].includes(parsed.status) ? null : body, {
        status: parsed.status,
        headers,
      }),
    );
  }

  // Resolve requests that were in flight on `ws` (or on every socket) as lost,
  // so fetch() can wait for the reconnect and retry instead of failing.
  failPending(ws) {
    for (const [id, entry] of this.pending) {
      if (ws && entry.ws !== ws) continue;
      this.pending.delete(id);
      entry.done({ lost: LOST, delivered: true });
    }
  }

  async webSocketClose(ws, code) {
    this.failPending(ws);
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws) {
    this.failPending(ws);
  }
}
