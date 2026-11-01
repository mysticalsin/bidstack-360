#!/usr/bin/env node
// Outbound WebSocket from the preview box to the polo-preview Worker.
// The Worker holds one Durable Object connection. A second client replaces
// the first, so only one box should run this.
//
//   RELAY_KEY=... node apps/polo-preview/src/box-relay.mjs
//
// The box must be serving `main`: web on :4180, API on :4020, SPA built with
// an empty VITE_API_URL so the browser stays on the Worker origin.

import WebSocket from 'ws';
import {
  PUBLIC_PREVIEW_ORIGIN,
  base64ToBytes,
  bytesToBase64,
  filterResponseHeaders,
  rewriteResponseHeaders,
  targetForPath,
  targetUrl,
} from './protocol.js';

const RELAY_URL = process.env.POLO_PREVIEW_RELAY_URL ?? `${PUBLIC_PREVIEW_ORIGIN}/__relay`;
const RELAY_KEY = process.env.RELAY_KEY ?? '';
const API_ORIGIN = process.env.POLO_PREVIEW_API_ORIGIN ?? 'http://127.0.0.1:4020';
const WEB_ORIGIN = process.env.POLO_PREVIEW_WEB_ORIGIN ?? 'http://127.0.0.1:4180';
const PUBLIC_ORIGIN = process.env.POLO_PREVIEW_PUBLIC_ORIGIN ?? PUBLIC_PREVIEW_ORIGIN;

function log(message) {
  console.error(`[polo-preview-relay] ${message}`);
}

function die(message) {
  log(`FAILED: ${message}`);
  process.exit(1);
}

async function handleRequest(message) {
  const path = String(message.path || '/');
  const target = targetForPath(path, {
    apiOrigin: API_ORIGIN,
    webOrigin: WEB_ORIGIN,
  });
  const url = targetUrl(path, target);
  const headers = new Headers();
  for (const [key, value] of message.headers || []) headers.append(key, value);
  const body = message.body ? Buffer.from(base64ToBytes(message.body)) : undefined;
  const res = await fetch(url, {
    method: message.method,
    headers,
    body,
    redirect: 'manual',
  });
  const responseHeaders = rewriteResponseHeaders([...res.headers.entries()], PUBLIC_ORIGIN);
  const raw = Buffer.from(await res.arrayBuffer());
  return {
    id: message.id,
    status: res.status,
    headers: filterResponseHeaders(responseHeaders),
    body: raw.length ? bytesToBase64(raw) : null,
  };
}

function connect() {
  if (!RELAY_KEY) die('RELAY_KEY is required');
  const socket = new WebSocket(RELAY_URL, {
    headers: { 'x-relay-key': RELAY_KEY },
  });
  socket.addEventListener('open', () => {
    log(`connected ${RELAY_URL} (web ${WEB_ORIGIN} api ${API_ORIGIN})`);
  });
  socket.addEventListener('message', async (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    } catch {
      return;
    }
    if (message === 'ping' || message?.type === 'ping') return;
    try {
      const reply = await handleRequest(message);
      socket.send(JSON.stringify(reply));
    } catch (error) {
      socket.send(
        JSON.stringify({
          id: message.id,
          status: 502,
          headers: [['content-type', 'text/plain; charset=utf-8']],
          body: bytesToBase64(new TextEncoder().encode(String(error))),
        }),
      );
    }
  });
  socket.addEventListener('close', (event) => {
    log(`socket closed ${event.code} ${event.reason || ''}`.trim());
    setTimeout(connect, 2000);
  });
  socket.addEventListener('error', (event) => {
    log(`socket error ${event.message || event}`);
  });
}

connect();
