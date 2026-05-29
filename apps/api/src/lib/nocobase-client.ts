// NocoBase API client for BidStack RFP integration.
// Thin wrapper around NocoBase's REST API with auth token caching
// and org-scoped request forwarding.

import { createLogger } from './logger.js';

const log = createLogger({ name: 'nocobase-client' });

const NOCOBASE_URL = process.env.NOCOBASE_URL ?? 'http://localhost:13000';
const NOCOBASE_ROOT_EMAIL = process.env.NOCOBASE_ROOT_EMAIL ?? 'admin@bidstack.local';
const NOCOBASE_ROOT_PASSWORD = process.env.NOCOBASE_ROOT_PASSWORD ?? 'admin123';

interface AuthResponse {
  token: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getRootToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`${NOCOBASE_URL}/api/auth:signIn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: NOCOBASE_ROOT_EMAIL,
      password: NOCOBASE_ROOT_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`NocoBase auth failed: ${res.status}`);
  }

  const data = (await res.json()) as { data?: AuthResponse };
  const token = data.data?.token;
  if (!token) throw new Error('NocoBase auth returned no token');

  // Cache for ~23 hours (token expires in 24h)
  cachedToken = { token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  log.info('Refreshed NocoBase root token');
  return token;
}

interface NocoBaseListOptions {
  filter?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  sort?: string[];
  appends?: string[];
}

export class NocoBaseClient {
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getRootToken();
    const url = `${NOCOBASE_URL}/api/${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`NocoBase returned invalid JSON: ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const message =
        data && typeof data === 'object' && 'message' in data
          ? String((data as { message: unknown }).message)
          : `NocoBase request failed (${res.status})`;
      throw new Error(message);
    }

    return (data as { data: T }).data;
  }

  async list<T>(
    collection: string,
    opts: NocoBaseListOptions = {},
  ): Promise<{ data: T[]; meta: { count: number; page: number; pageSize: number } }> {
    const params = new URLSearchParams();
    if (opts.filter) params.set('filter', JSON.stringify(opts.filter));
    if (opts.page) params.set('page', String(opts.page));
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts.sort) params.set('sort', JSON.stringify(opts.sort));
    if (opts.appends) params.set('appends', JSON.stringify(opts.appends));

    const token = await getRootToken();
    const url = `${NOCOBASE_URL}/api/${collection}:list?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`NocoBase list failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  }

  async get<T>(collection: string, id: string, opts?: { appends?: string[] }): Promise<T> {
    const params = new URLSearchParams();
    if (opts?.appends) params.set('appends', JSON.stringify(opts.appends));
    const query = params.toString();
    return this.request<T>('GET', `${collection}:get/${id}${query ? `?${query}` : ''}`);
  }

  async create<T>(collection: string, values: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', `${collection}:create`, { values });
  }

  async update<T>(collection: string, id: string, values: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', `${collection}:update?filterByTk=${id}`, { values });
  }

  async destroy(collection: string, id: string): Promise<void> {
    await this.request<void>('POST', `${collection}:destroy?filterByTk=${id}`);
  }
}

// Singleton instance
export const nocobase = new NocoBaseClient();
