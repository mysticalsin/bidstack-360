// Thin fetch wrapper. Routes are proxied to the API by Vite dev server,
// so we use relative paths.

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

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

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
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
