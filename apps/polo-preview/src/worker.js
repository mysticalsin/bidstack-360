// polo-preview Worker: Cloudflare Access-gated front door that relays HTTP to
// the box-hosted Polo preview (web :4180 -> API :4020) over an outbound
// WebSocket the box opens. Serve `main` on that box. Do not upload this
// script from CI: a binding mismatch drops the Durable Object relay.
import { Container, ContainerProxy, getContainer } from '@cloudflare/containers';
import { DurableObject } from 'cloudflare:workers';
import {
  BOX_OFFLINE,
  DROP_REQUEST,
  ORIGIN_STARTING,
  PUBLIC_PREVIEW_ORIGIN,
  base64ToBytes,
  bytesToBase64,
  filterCookieHeader,
  filterRequestHeaders,
  originKind,
  replaceUpstreamFailure,
  rewriteResponseHeaders,
} from './protocol.js';

const PREVIEW_INSTANCE = 'polo-v5';

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
  const allowed = env.ALLOWED_EMAILS.split(',').map((s) => s.trim().toLowerCase());
  if (!payload.email || !allowed.includes(String(payload.email).toLowerCase())) return null;
  return payload;
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

function startingResponse() {
  return new Response(ORIGIN_STARTING, {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '15' },
  });
}

function previewContainer(env) {
  return getContainer(env.PREVIEW, PREVIEW_INSTANCE);
}

async function relayHealth(req, env) {
  const res = await env.RELAY.get(env.RELAY.idFromName('box')).fetch(
    new Request(new URL('/__health', req.url), { method: 'GET' }),
  );
  try {
    return await res.json();
  } catch {
    return { relay: false, pending: 0 };
  }
}

async function containerProbe(env) {
  if (!env.PREVIEW) return { configured: false, ready: false };
  try {
    const res = await previewContainer(env).fetch(
      new Request(`${PUBLIC_PREVIEW_ORIGIN}/readyz`, { method: 'GET' }),
    );
    const text = await res.text();
    let boot = '';
    if (!res.ok) {
      try {
        const bootRes = await previewContainer(env).fetch(
          new Request(`${PUBLIC_PREVIEW_ORIGIN}/__boot`, { method: 'GET' }),
        );
        boot = (await bootRes.text()).slice(-800);
      } catch (error) {
        boot = String(error instanceof Error ? error.message : error).slice(0, 200);
      }
    }
    return {
      configured: true,
      ready: res.ok,
      status: res.status,
      detail: text.slice(0, 300),
      boot,
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      error: String(error instanceof Error ? error.message : error).slice(0, 240),
    };
  }
}

function requestForContainer(req) {
  const headers = filterRequestHeaders([...req.headers]);
  const publicUrl = new URL(PUBLIC_PREVIEW_ORIGIN);
  headers.push(['x-forwarded-proto', 'https']);
  headers.push(['x-forwarded-host', publicUrl.host]);
  headers.push(['host', publicUrl.host]);
  const init = { method: req.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = req.body;
  return new Request(req.url, init);
}

async function proxyContainer(req, env) {
  let res;
  try {
    res = await previewContainer(env).fetch(requestForContainer(req));
  } catch {
    return startingResponse();
  }
  if (replaceUpstreamFailure(res.status, res.headers.get('content-type'))) {
    return startingResponse();
  }
  const headers = new Headers();
  for (const [key, value] of rewriteResponseHeaders([...res.headers], PUBLIC_PREVIEW_ORIGIN)) {
    headers.append(key, value);
  }
  headers.set('x-robots-tag', 'noindex');
  return new Response([101, 204, 304].includes(res.status) ? null : res.body, {
    status: res.status,
    headers,
  });
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
    // Access still sits in front of this hostname. This route skips the
    // Worker's second email check so a health probe can see the container.
    if (url.pathname === '/__origin') {
      const container = await containerProbe(env);
      return Response.json({ origin: 'cloudflare', container });
    }
    const who = await verifyAccess(req, env);
    if (!who) return new Response('Forbidden: Cloudflare Access sign-in required', { status: 403 });
    if (url.pathname === '/__health') {
      const relay = await relayHealth(req, env);
      const container = await containerProbe(env);
      const kind = originKind({
        hasContainer: Boolean(env.PREVIEW),
        relayConnected: Boolean(relay.relay),
      });
      return Response.json({
        relay: Boolean(relay.relay),
        pending: relay.pending ?? 0,
        origin: kind,
        container,
      });
    }
    if (req.headers.get('upgrade') === 'websocket') {
      return new Response('WebSockets are not relayed in the preview', { status: 501 });
    }
    const kind = originKind({ hasContainer: Boolean(env.PREVIEW), relayConnected: true });
    if (kind === 'container') return proxyContainer(req, env);
    return env.RELAY.get(env.RELAY.idFromName('box')).fetch(req);
  },

  // Wakes the container after a host move. The class does not sleep on idle,
  // and this ping brings it back if the platform stopped the instance.
  async scheduled(_event, env, ctx) {
    if (!env.PREVIEW) return;
    ctx.waitUntil(
      previewContainer(env)
        .fetch(new Request(`${PUBLIC_PREVIEW_ORIGIN}/readyz`, { method: 'GET' }))
        .then((res) => res.body?.cancel())
        .catch((error) => {
          console.error('polo preview keep-alive failed', error);
        }),
    );
  },
};

// One named instance. onActivityExpired does not stop it: a sleeping container
// throws away the ephemeral Postgres and the preview looks offline again.
export { ContainerProxy };

export class PreviewOrigin extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  // Cron fetches /readyz every minute, which renews this window. If the
  // window still expires, do not stop: stopping drops the ephemeral database.
  sleepAfter = '30m';
  pingEndpoint = 'localhost/readyz';
  envVars = {
    NODE_ENV: 'development',
    PORT_API: '4000',
    HOST: '127.0.0.1',
    DATABASE_URL: 'postgres://bidstack:bidstack@127.0.0.1:5432/bidstack',
    REDIS_URL: 'redis://127.0.0.1:6379',
    PUBLIC_BASE_URL: PUBLIC_PREVIEW_ORIGIN,
    PUBLIC_API_URL: PUBLIC_PREVIEW_ORIGIN,
  };

  onActivityExpired() {
    this.renewActivityTimeout();
  }
}

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pending = new Map();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/__relay') {
      for (const old of this.ctx.getWebSockets()) {
        try {
          old.close(1012, 'replaced');
        } catch {
          /* already closed */
        }
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const sockets = this.ctx.getWebSockets().filter((socket) => socket.readyState === 1);
    if (url.pathname === '/__health') {
      return Response.json({
        relay: sockets.length > 0,
        pending: this.pending.size,
      });
    }
    const ws = sockets[sockets.length - 1];
    if (!ws) {
      return new Response(BOX_OFFLINE, {
        status: 502,
      });
    }
    const publicOrigin = url.origin;
    const headers = requestHeadersForBox(req, publicOrigin);
    let body = null;
    if (!['GET', 'HEAD'].includes(req.method)) {
      body = bytesToBase64(await req.arrayBuffer());
    }
    const id = crypto.randomUUID();
    const pending = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(new Response('Preview backend timeout', { status: 504 }));
      }, 90_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    ws.send(
      JSON.stringify({
        id,
        method: req.method,
        path: url.pathname + url.search,
        headers,
        body,
      }),
    );
    return pending;
  }

  async webSocketMessage(_ws, msg) {
    let parsed;
    try {
      parsed = JSON.parse(typeof msg === 'string' ? msg : new TextDecoder().decode(msg));
    } catch {
      return;
    }
    const done = this.pending.get(parsed.id);
    if (!done) return;
    this.pending.delete(parsed.id);
    const publicOrigin = 'https://polo-preview.tony-walteur.workers.dev';
    const headers = new Headers();
    for (const [key, value] of rewriteResponseHeaders(parsed.headers || [], publicOrigin)) {
      headers.append(key, value);
    }
    headers.set('x-robots-tag', 'noindex');
    const body = parsed.body ? base64ToBytes(parsed.body) : null;
    done(
      new Response([101, 204, 304].includes(parsed.status) ? null : body, {
        status: parsed.status,
        headers,
      }),
    );
  }

  failPending(status, text) {
    for (const [id, done] of this.pending) {
      done(new Response(text, { status }));
      this.pending.delete(id);
    }
  }

  async webSocketClose(ws, code) {
    this.failPending(502, BOX_OFFLINE);
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async webSocketError() {
    this.failPending(502, BOX_OFFLINE);
  }
}
