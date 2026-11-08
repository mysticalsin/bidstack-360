// Front-server proxy used by the container entrypoint (container/entrypoint.mjs).
// WHY hop-by-hop stripping: the upstream request rides Node's keep-alive pool.
// A forwarded `connection: upgrade` turns the pooled socket into a WebSocket
// the proxy never reads, and the next request queued on it hangs forever.

import http from 'node:http';

export const HOP_BY_HOP_REQUEST = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
  'x-forwarded-for',
  'x-real-ip',
  'x-polo-internal-key',
];

export function upstreamHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_REQUEST.includes(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function unavailable(res) {
  if (res.destroyed) return;
  if (res.headersSent) return res.destroy();
  res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '5' });
  res.end(JSON.stringify({ error: 'api_restarting', retryAfterSeconds: 5 }));
}

/** @param {{ port: number, host?: string, agent?: http.Agent }} options */
export function makeApiProxy({ port, host = '127.0.0.1', agent }) {
  return function proxyApi(req, res) {
    const upstream = http.request(
      { host, port, agent, path: req.url, method: req.method, headers: upstreamHeaders(req.headers) },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
        res.on('close', () => {
          if (!up.complete) up.destroy();
        });
      },
    );
    upstream.on('upgrade', (_up, socket) => {
      socket.destroy();
      unavailable(res);
    });
    upstream.on('error', () => unavailable(res));
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  };
}

export function rejectUpgrade(_req, socket) {
  socket.on('error', () => {});
  socket.end('HTTP/1.1 501 Not Implemented\r\nconnection: close\r\ncontent-type: text/plain\r\ncontent-length: 39\r\n\r\nWebSockets are not relayed in Polo yet.');
}
