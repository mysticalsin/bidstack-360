// polo-preview Worker: Cloudflare Access-gated front door that relays HTTP to
// the box-hosted Polo preview (web :4180 -> API :4020) over an outbound
// WebSocket the box opens. Serve `main` on that box. Do not upload this
// script from CI: a binding mismatch drops the Durable Object relay.
import { DurableObject } from 'cloudflare:workers';
import {
  DROP_REQUEST,
  base64ToBytes,
  bytesToBase64,
  filterCookieHeader,
  rewriteResponseHeaders,
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
    const who = await verifyAccess(req, env);
    if (!who) return new Response('Forbidden: Cloudflare Access sign-in required', { status: 403 });
    if (url.pathname === '/__health') {
      return env.RELAY.get(env.RELAY.idFromName('box')).fetch(
        new Request(new URL('/__health', req.url), { method: 'GET' }),
      );
    }
    if (req.headers.get('upgrade') === 'websocket') {
      return new Response('WebSockets are not relayed in the preview', { status: 501 });
    }
    return env.RELAY.get(env.RELAY.idFromName('box')).fetch(req);
  },
};

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
      return new Response('Polo preview backend is offline (box relay not connected).', {
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
    this.failPending(502, 'Polo preview backend is offline (box relay not connected).');
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async webSocketError() {
    this.failPending(502, 'Polo preview backend is offline (box relay not connected).');
  }
}
