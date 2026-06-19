import type {
  IntegrationConfig,
  IntegrationPlugin,
  IntegrationTool,
  SyncResult,
  } from '../types/plugin.js';

/** Default fetch timeout for Salesforce API calls (15 seconds). */
const FETCH_TIMEOUT_MS = 15_000;

function fetchWithTimeout(url: string, opts: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = FETCH_TIMEOUT_MS, ...rest } = opts;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...rest, signal: controller.signal }).finally(() => clearTimeout(id));
}

/**
 * Salesforce CRM Integration Plugin
 *
 * Provides OAuth-based connection to Salesforce REST API
 * and exposes MCP tools for reading/writing Salesforce records.
 */
export class SalesforcePlugin implements IntegrationPlugin {
  readonly provider = 'salesforce' as const;
  readonly displayName = 'Salesforce';
  readonly description = 'Sync leads, accounts, contacts, and opportunities with Salesforce.';
  readonly icon = 'target';

  private getOAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? 'https://login.salesforce.com';
    const state = Buffer.from(JSON.stringify({ orgId, provider: this.provider })).toString('base64url');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId ?? '',
      redirect_uri: redirectUri,
      state,
      scope: 'api refresh_token',
    });
    return `${loginUrl}/services/oauth2/authorize?${params.toString()}`;
  }

  async getAuthUrl(orgId: string, redirectUri: string): Promise<string> {
    return this.getOAuthUrl(orgId, redirectUri);
  }

  async connect(config: IntegrationConfig, code: string): Promise<IntegrationConfig> {
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
    const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? 'https://login.salesforce.com';
    const redirectUri = process.env.SALESFORCE_REDIRECT_URI ?? '';

    if (!clientId || !clientSecret) {
      throw new Error('Salesforce OAuth credentials not configured');
    }

    const tokenRes = await fetchWithTimeout(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      // Do NOT propagate response body — it may contain sensitive token data.
      throw new Error(`Salesforce token exchange failed (HTTP ${tokenRes.status})`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      instance_url: string;
    };

    return {
      ...config,
      status: 'connected',
      connectedAt: new Date(),
      credentials: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        instanceUrl: tokenData.instance_url,
      },
    };
  }

  async validate(config: IntegrationConfig): Promise<{ valid: boolean; message?: string }> {
    const accessToken = config.credentials?.accessToken as string | undefined;
    const instanceUrl = config.credentials?.instanceUrl as string | undefined;
    if (!accessToken || !instanceUrl) return { valid: false, message: 'Missing credentials' };

    try {
      const res = await fetchWithTimeout(`${instanceUrl}/services/data/v60.0/limits`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { valid: res.ok, message: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { valid: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async refresh(config: IntegrationConfig): Promise<IntegrationConfig> {
    const refreshToken = config.credentials?.refreshToken as string | undefined;
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
    const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? 'https://login.salesforce.com';

    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error('Cannot refresh: missing refresh token or client credentials');
    }

    const res = await fetchWithTimeout(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) throw new Error(`Salesforce refresh failed (HTTP ${res.status})`);
    const data = (await res.json()) as { access_token: string };

    return {
      ...config,
      credentials: { ...config.credentials, accessToken: data.access_token },
    };
  }

  async disconnect(config: IntegrationConfig): Promise<void> {
    const accessToken = config.credentials?.accessToken as string | undefined;
    const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? 'https://login.salesforce.com';
    if (accessToken) {
      await fetchWithTimeout(`${loginUrl}/services/oauth2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: accessToken }),
        timeout: 5_000,
      }).catch(() => {}); // Best-effort revoke.
    }
  }

  async sync(_config: IntegrationConfig): Promise<SyncResult> {
    // TODO: Implement incremental sync for Account, Contact, Lead, Opportunity.
    return { created: 0, updated: 0, deleted: 0, errors: [] };
  }

  getTools(): IntegrationTool[] {
    return [
      {
        name: 'salesforce_query',
        description: 'Execute a SOQL query against Salesforce.',
        parameters: {
          soql: { type: 'string', description: 'SOQL query string', required: true },
        },
        execute: async (args, context) => {
          const accessToken = context.config.credentials?.accessToken as string | undefined;
          const instanceUrl = context.config.credentials?.instanceUrl as string | undefined;
          if (!accessToken || !instanceUrl) throw new Error('Salesforce not connected');
          const res = await fetchWithTimeout(
            `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(args.soql as string)}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!res.ok) throw new Error(`Salesforce query failed: ${res.status}`);
          return res.json();
        },
      },
      {
        name: 'salesforce_create_record',
        description: 'Create a record in Salesforce.',
        parameters: {
          sobject: { type: 'string', description: 'SObject type', required: true },
          fields: { type: 'object', description: 'Field values', required: true },
        },
        execute: async (args, context) => {
          const accessToken = context.config.credentials?.accessToken as string | undefined;
          const instanceUrl = context.config.credentials?.instanceUrl as string | undefined;
          if (!accessToken || !instanceUrl) throw new Error('Salesforce not connected');
          const res = await fetchWithTimeout(`${instanceUrl}/services/data/v60.0/sobjects/${args.sobject}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(args.fields),
          });
          if (!res.ok) throw new Error(`Salesforce create failed: ${res.status}`);
          return res.json();
        },
      },
    ];
  }
}
