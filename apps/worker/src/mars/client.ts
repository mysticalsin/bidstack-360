/**
 * MARS client (the internal weekly "who we met and when" log).
 *
 * No MARS API is known yet, so the wire contract is ASSUMED (MarsEntry in
 * @bidstack/shared) and every unknown is listed in
 * fleet/polo-mars-integration.md. Swapping the assumption for the real API is
 * a change to this file only.
 *
 * Assumed endpoint: GET {MARS_BASE_URL}/v1/meeting-entries
 *   ?cursor=<opaque>&updatedSince=<iso>&limit=<n>
 *   -> { items: MarsEntry[], nextCursor: string, hasMore: boolean }
 * Auth: OAuth 2 client credentials (MARS_TOKEN_URL, MARS_CLIENT_ID,
 * MARS_CLIENT_SECRET) or a static key (MARS_API_KEY). Secrets come from env
 * only, are never logged, and never leave this module.
 */
export interface MarsPage {
  items: unknown[];
  /** High-water cursor to resume from, also when hasMore is false. */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MarsClient {
  readonly configured: boolean;
  listEntries(args: { cursor: string | null; updatedSince: Date | null; limit: number }): Promise<MarsPage>;
}

export class MarsNotConfiguredError extends Error {
  constructor() {
    super('MARS connector is not configured');
    this.name = 'MarsNotConfiguredError';
  }
}

export class MarsRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`MARS rate limited, retry after ${retryAfterMs} ms`);
    this.name = 'MarsRateLimitedError';
  }
}

export class MarsHttpError extends Error {
  constructor(readonly status: number) {
    super(`MARS request failed with HTTP ${status}`);
    this.name = 'MarsHttpError';
  }
}

export const notConfiguredMarsClient: MarsClient = {
  configured: false,
  async listEntries() {
    throw new MarsNotConfiguredError();
  },
};

export interface MarsHttpConfig {
  baseUrl: string;
  auth: { kind: 'oauth'; tokenUrl: string; clientId: string; clientSecret: string; scope?: string } | { kind: 'api_key'; apiKey: string };
  timeoutMs?: number;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

function retryAfterMs(h: string | null): number {
  if (!h) return 60_000;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.min(15 * 60_000, Math.max(1_000, s * 1000));
  const at = Date.parse(h);
  return Number.isNaN(at) ? 60_000 : Math.min(15 * 60_000, Math.max(1_000, at - Date.now()));
}

export function httpMarsClient(cfg: MarsHttpConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): MarsClient {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('MARS_BASE_URL must be https');
  let token: { value: string; exp: number } | null = null;
  const timeout = cfg.timeoutMs ?? 20_000;

  async function call(url: string, init: Parameters<FetchLike>[1]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function authHeader(force = false): Promise<string> {
    if (cfg.auth.kind === 'api_key') return `Bearer ${cfg.auth.apiKey}`;
    if (!force && token && token.exp > Date.now() + 30_000) return `Bearer ${token.value}`;
    const body = new URLSearchParams({ grant_type: 'client_credentials', ...(cfg.auth.scope ? { scope: cfg.auth.scope } : {}) }).toString();
    const basic = Buffer.from(`${cfg.auth.clientId}:${cfg.auth.clientSecret}`).toString('base64');
    const res = await call(cfg.auth.tokenUrl, { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new MarsHttpError(res.status);
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string') throw new MarsHttpError(502);
    token = { value: json.access_token, exp: Date.now() + (typeof json.expires_in === 'number' ? json.expires_in : 300) * 1000 };
    return `Bearer ${token.value}`;
  }

  return {
    configured: true,
    async listEntries({ cursor, updatedSince, limit }) {
      const q = new URLSearchParams({ limit: String(limit) });
      if (cursor) q.set('cursor', cursor);
      else if (updatedSince) q.set('updatedSince', updatedSince.toISOString());
      const url = `${base}/v1/meeting-entries?${q.toString()}`;
      let res = await call(url, { method: 'GET', headers: { authorization: await authHeader(), accept: 'application/json' } });
      if (res.status === 401 && cfg.auth.kind === 'oauth') res = await call(url, { method: 'GET', headers: { authorization: await authHeader(true), accept: 'application/json' } });
      if (res.status === 429) throw new MarsRateLimitedError(retryAfterMs(res.headers.get('retry-after')));
      if (!res.ok) throw new MarsHttpError(res.status);
      const json = (await res.json()) as Partial<MarsPage>;
      return {
        items: Array.isArray(json.items) ? json.items : [],
        nextCursor: typeof json.nextCursor === 'string' ? json.nextCursor.slice(0, 500) : null,
        hasMore: json.hasMore === true,
      };
    },
  };
}

/** Env names only: MARS_BASE_URL, MARS_TOKEN_URL, MARS_CLIENT_ID, MARS_CLIENT_SECRET, MARS_SCOPE, MARS_API_KEY. */
export function marsClientFromEnv(env: NodeJS.ProcessEnv = process.env): MarsClient {
  const baseUrl = env.MARS_BASE_URL?.trim();
  if (!baseUrl) return notConfiguredMarsClient;
  if (env.MARS_CLIENT_ID && env.MARS_CLIENT_SECRET && env.MARS_TOKEN_URL) {
    return httpMarsClient({
      baseUrl,
      auth: { kind: 'oauth', tokenUrl: env.MARS_TOKEN_URL, clientId: env.MARS_CLIENT_ID, clientSecret: env.MARS_CLIENT_SECRET, ...(env.MARS_SCOPE ? { scope: env.MARS_SCOPE } : {}) },
    });
  }
  if (env.MARS_API_KEY) return httpMarsClient({ baseUrl, auth: { kind: 'api_key', apiKey: env.MARS_API_KEY } });
  return notConfiguredMarsClient;
}
