// Thin fetch wrapper. Routes are proxied to the API by Vite dev server,
// so we use relative paths.

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

type ApiTokenProvider = () => string | null | Promise<string | null>;

let apiTokenProvider: ApiTokenProvider | null = null;

// In the hybrid deploy (SPA on Vercel, API on Railway) the API lives on a
// different origin. VITE_API_URL is inlined at build time and prefixed onto
// every request. Empty in local dev (Vite proxies /api) and in single-origin
// deploys, so behavior there is unchanged.
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function setApiTokenProvider(provider: ApiTokenProvider | null): void {
  apiTokenProvider = provider;
}

function normalizeApiPath(path: string): string {
  // Ensure all API calls use /api/v1/ prefix. The backend rewriteUrl
  // handles /api/ → /api/v1/, but normalizing here keeps the frontend
  // consistent and removes the fragile dependency on that rewrite.
  if (
    path.startsWith('/api/') &&
    !path.startsWith('/api/v1/') &&
    !path.startsWith('/api/webhooks')
  ) {
    return path.replace('/api/', '/api/v1/');
  }
  return path;
}

/**
 * Trigger a browser file download from a backend endpoint that returns a
 * non-JSON response (e.g. text/csv). Fetches with the auth token and creates
 * a temporary object URL so the browser saves the file natively.
 *
 * WHY fetch+blob over a plain <a href>: Bearer token auth requires the header
 * to be set explicitly — the browser's native navigation won't include it.
 */
export async function downloadFromApi(
  path: string,
  filename: string,
  opts: { querystring?: Record<string, string | undefined> } = {},
): Promise<void> {
  const resolvedPath = normalizeApiPath(path);
  const token = apiTokenProvider ? await apiTokenProvider() : null;
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const qs = opts.querystring
    ? Object.entries(opts.querystring)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
        .join('&')
    : '';
  const url = qs ? `${resolvedPath}?${qs}` : resolvedPath;

  const res = await fetch(`${API_BASE}${url}`, {
    method: 'GET',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    credentials: 'include',
  });

  if (!res.ok) {
    throw new ApiError(`Export failed (${res.status})`, res.status, null);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke after a tick so Safari has time to initiate the download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const resolvedPath = normalizeApiPath(path);
  const token = apiTokenProvider ? await apiTokenProvider() : null;
  const headers: Record<string, string> = {
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${resolvedPath}`, {
    method: opts.method ?? 'GET',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: 'include',
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('Invalid JSON response from server', res.status, text);
  }

  if (!res.ok) {
    const message =
      data !== null &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}
