// Thin fetch wrapper. Routes are proxied to the API by Vite dev server,
// so we use relative paths.

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

interface ApiTokenOptions {
  forceRefresh?: boolean;
}

type ApiTokenProvider = (options?: ApiTokenOptions) => string | null | Promise<string | null>;

let apiTokenProvider: ApiTokenProvider | null = null;

// In the hybrid deploy (SPA on Vercel, API on Railway) the API lives on a
// different origin. VITE_API_URL is inlined at build time and prefixed onto
// every request. Empty in local dev (Vite proxies /api) and in single-origin
// deploys, so behavior there is unchanged.
const API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL ?? '');
const STUB_ROLE_KEY = 'bidstack:stub-role';
const E2E_ROLE_HEADER_ENABLED = import.meta.env.VITE_ENABLE_E2E_ROLE_HEADER === 'true';

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

// Invoked when an authenticated request (one that DID send a token) is rejected
// 401 even after a forced token refresh — i.e. the stored session is dead, not
// merely stale. The active auth provider registers a handler that clears the
// dead credential and bounces the user to sign-in, instead of the app 401ing
// forever behind a "Failed to load…" state. 403 (permission denied) is NOT
// auth-invalid and never triggers this.
let authInvalidHandler: (() => void) | null = null;

export function setAuthInvalidHandler(handler: (() => void) | null): void {
  authInvalidHandler = handler;
}

function shouldRefreshAuth(status: number): boolean {
  return status === 401 || status === 403;
}

// Fire the auth-invalid handler once for a token-bearing request that still
// 401'd after refresh. Guard on a non-null token so unauthenticated calls
// (no session at all — handled by route guards) never force a sign-out loop.
async function handleTerminal401(status: number): Promise<void> {
  if (status !== 401 || !authInvalidHandler) return;
  const hadToken = (await getApiToken()) != null;
  if (hadToken) authInvalidHandler();
}

async function getApiToken(options?: ApiTokenOptions): Promise<string | null> {
  return apiTokenProvider ? await apiTokenProvider(options) : null;
}

/**
 * Public accessor for the current auth token. Used by non-fetch transports that
 * can't route through api() — notably the collaborative-editing WebSocket, which
 * passes the token as ?access_token= because browsers can't set WS headers.
 */
export async function getAuthToken(): Promise<string | null> {
  return getApiToken();
}

function getE2eRoleHeader(): Record<string, string> {
  if (!E2E_ROLE_HEADER_ENABLED || typeof window === 'undefined') return {};
  const role = window.localStorage.getItem(STUB_ROLE_KEY);
  return role ? { 'x-bidstack-e2e-role': role } : {};
}

function buildHeaders(token: string | null, hasJsonBody: boolean): Record<string, string> | undefined {
  const headers: Record<string, string> = {
    ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...getE2eRoleHeader(),
  };

  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('Invalid JSON response from server', res.status, text);
  }
}

export function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.trim().replace(/\/+$/, '');
  if (trimmed === '/api' || trimmed === '/api/v1') return '';
  return trimmed.replace(/\/api(?:\/v1)?$/, '');
}

export function normalizeApiPath(path: string): string {
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

export function buildApiUrl(path: string, base = API_BASE): string {
  return `${normalizeApiBase(base)}${normalizeApiPath(path)}`;
}

function getErrorMessage(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null;
  const record = data as { message?: unknown; error?: unknown };
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  return null;
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
  const qs = opts.querystring
    ? Object.entries(opts.querystring)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
        .join('&')
    : '';
  const url = qs ? `${resolvedPath}?${qs}` : resolvedPath;

  const requestExport = async (forceRefresh = false) => {
    const token = await getApiToken(forceRefresh ? { forceRefresh: true } : undefined);
    return fetch(buildApiUrl(url), {
      method: 'GET',
      headers: buildHeaders(token, false),
      credentials: 'include',
      cache: 'no-store',
    });
  };

  let res = await requestExport();
  if (!res.ok && apiTokenProvider && shouldRefreshAuth(res.status)) {
    res = await requestExport(true);
  }

  if (!res.ok) {
    await handleTerminal401(res.status);
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
  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  const requestJson = async (forceRefresh = false) => {
    const token = await getApiToken(forceRefresh ? { forceRefresh: true } : undefined);
    return fetch(buildApiUrl(resolvedPath), {
      method: opts.method ?? 'GET',
      headers: buildHeaders(token, Boolean(body)),
      body,
      signal: opts.signal,
      credentials: 'include',
      cache: 'no-store',
    });
  };

  let res = await requestJson();
  if (!res.ok && apiTokenProvider && shouldRefreshAuth(res.status)) {
    res = await requestJson(true);
  }
  if (!res.ok) await handleTerminal401(res.status);

  const data = await parseJsonResponse(res);

  if (!res.ok) {
    const message = getErrorMessage(data) ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}
