// Thin fetch wrapper. Routes are proxied to the API by Vite dev server,
// so we use relative paths.

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

type ApiTokenProvider = () => string | null | Promise<string | null>;

let apiTokenProvider: ApiTokenProvider | null = null;

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

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const resolvedPath = normalizeApiPath(path);
  const token = apiTokenProvider ? await apiTokenProvider() : null;
  const headers: Record<string, string> = {
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(resolvedPath, {
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
