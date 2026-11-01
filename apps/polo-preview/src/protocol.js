// Shared contract between the Cloudflare Worker and the box relay.
// WHY a module: the Worker and the box must agree on path routing, which
// cookies may cross the tunnel, and which hop-by-hop headers would break a
// reconstructed Response. Tests lock the contract so a one-sided edit fails.

export const API_PATHS = ['/api', '/readyz', '/livez', '/health', '/metrics', '/webhooks'];

export const PUBLIC_PREVIEW_ORIGIN = 'https://polo-preview.tony-walteur.workers.dev';

export const DROP_REQUEST = [
  'host',
  'cf-access-jwt-assertion',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'x-bidstack-e2e-role',
  'x-bidstack-e2e-org',
  'connection',
  'upgrade',
  'content-length',
];

export const DROP_RESPONSE = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
  'alt-svc',
  'nel',
  'report-to',
];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isApiPath(pathname) {
  const path = safePathname(pathname);
  return API_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function safePathname(pathname) {
  const raw = String(pathname || '');
  const path = raw.split('?')[0] || '';
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return path;
}

export function targetUrl(pathWithSearch, origin) {
  const [pathPart, ...queryParts] = String(pathWithSearch || '').split('?');
  const path = safePathname(pathPart);
  const url = new URL(origin);
  url.pathname = path;
  url.search = queryParts.length > 0 ? queryParts.join('?') : '';
  return url;
}

export function targetForPath(pathname, { apiOrigin, webOrigin }) {
  return isApiPath(pathname) ? apiOrigin : webOrigin;
}

export function filterCookieHeader(cookie) {
  if (!cookie) return null;
  const kept = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      const name = part.split('=')[0]?.trim().toLowerCase() ?? '';
      return name.length > 0 && !name.startsWith('cf_');
    });
  return kept.length > 0 ? kept.join('; ') : null;
}

export function filterRequestHeaders(headers) {
  const out = [];
  let cookie = null;
  for (const [key, value] of headers) {
    const name = key.toLowerCase();
    if (DROP_REQUEST.includes(name)) continue;
    if (name === 'cookie') {
      cookie = filterCookieHeader(value);
      continue;
    }
    out.push([key, value]);
  }
  if (cookie) out.push(['cookie', cookie]);
  return out;
}

export function filterResponseHeaders(headers) {
  const out = [];
  for (const [key, value] of headers) {
    if (DROP_RESPONSE.includes(key.toLowerCase())) continue;
    out.push([key, value]);
  }
  return out;
}

export function rewriteLocalUrl(value, publicOrigin) {
  if (!value) return value;
  try {
    const publicUrl = new URL(publicOrigin);
    const parsed = new URL(value, publicUrl.origin);
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) return value;
    return publicUrl.origin + parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return value;
  }
}

export function rewriteResponseHeaders(headers, publicOrigin) {
  return filterResponseHeaders(headers).map(([key, value]) => {
    const name = key.toLowerCase();
    if (name === 'location' || name === 'content-location' || name === 'refresh') {
      return [key, rewriteLocalUrl(value, publicOrigin)];
    }
    return [key, value];
  });
}

export function bytesToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

export function base64ToBytes(encoded) {
  if (!encoded) return null;
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}
