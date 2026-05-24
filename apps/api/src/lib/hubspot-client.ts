// HubSpot API v3 client for the migration connector.
//
// Why a thin wrapper instead of the official @hubspot/api-client SDK:
// - Zero new dependencies (the SDK adds ~4 MB to the bundle).
// - We only need three endpoints for migration: list companies, contacts, deals.
// - We need precise control over backoff — HubSpot's burst limit is 100 req/10s
//   (Growth tier). On 429, we read Retry-After and pause the whole queue.
//
// HubSpot OAuth scopes required (minimum per entity):
//   - crm.objects.companies.read  — list/read company records
//   - crm.objects.contacts.read   — list/read contact records
//   - crm.objects.deals.read      — list/read deal (opportunity) records
//   - crm.objects.tasks.read      — list/read task records
//   - oauth                       — required for the token endpoint itself

export interface HubSpotTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

export interface HubSpotListResult<T> {
  results: T[];
  paging?: { next?: { after: string } };
}

const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const TIMEOUT_MS = 15_000;

// ─── Auth URL builder ────────────────────────────────────────────────────────

export function buildHubSpotAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  // Minimum scopes for migration. Add scopes here if future features need them.
  // Why each scope:
  //   crm.objects.companies.read — read Account-equivalent records
  //   crm.objects.contacts.read  — read Contact records
  //   crm.objects.deals.read     — read Deal (Opportunity) records
  //   crm.objects.tasks.read     — read Activity/Task records
  const scopes = [
    'crm.objects.companies.read',
    'crm.objects.contacts.read',
    'crm.objects.deals.read',
    'crm.objects.tasks.read',
    'oauth',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });
  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

// ─── Token exchange ──────────────────────────────────────────────────────────

export async function exchangeHubSpotCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<HubSpotTokens> {
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot token exchange failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ─── Token refresh ───────────────────────────────────────────────────────────

export async function refreshHubSpotToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<HubSpotTokens> {
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ─── API fetcher with rate-limit awareness ───────────────────────────────────

export class HubSpot429Error extends Error {
  constructor(
    public readonly retryAfterMs: number,
    message = `HubSpot 429 — retry after ${retryAfterMs}ms`,
  ) {
    super(message);
    this.name = 'HubSpot429Error';
  }
}

async function hubspotFetch<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${HUBSPOT_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    // HubSpot returns Retry-After in seconds; default 10s.
    const retryAfterMs = retryAfter ? parseFloat(retryAfter) * 1000 : 10_000;
    throw new HubSpot429Error(retryAfterMs);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot API ${res.status} for ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Object count helper (used during discovery phase) ──────────────────────

interface HubSpotCountResponse {
  total: number;
}

export async function countHubSpotObject(
  accessToken: string,
  objectType: 'companies' | 'contacts' | 'deals' | 'tasks',
): Promise<number> {
  try {
    const res = await hubspotFetch<HubSpotCountResponse>(
      `/crm/v3/objects/${objectType}`,
      accessToken,
      { limit: '1', properties: 'hs_object_id' },
    );
    // HubSpot doesn't have a dedicated count endpoint at v3 — the 'total'
    // field on the list response is the full count. We use a limit:1 request
    // to cheaply get the total without paginating all results.
    return res.total ?? 0;
  } catch {
    // Non-fatal during discovery — return 0 if the scope is not granted.
    return 0;
  }
}

// ─── Paginated list (used during migration chunks) ───────────────────────────

export interface HubSpotRecord {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

export async function listHubSpotObjects(
  accessToken: string,
  objectType: 'companies' | 'contacts' | 'deals' | 'tasks',
  properties: string[],
  after?: string,
  limit = 100,
): Promise<HubSpotListResult<HubSpotRecord>> {
  return hubspotFetch<HubSpotListResult<HubSpotRecord>>(
    `/crm/v3/objects/${objectType}`,
    accessToken,
    {
      limit: String(limit),
      properties: properties.join(','),
      ...(after ? { after } : {}),
    },
  );
}
