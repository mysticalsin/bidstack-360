import type {
  IntegrationConfig,
  IntegrationPlugin,
  IntegrationTool,
  SyncResult,
  } from '../types/plugin.js';

/**
 * Microsoft 365 Integration Plugin
 *
 * Replaces the placeholder routes in apps/api/src/routes/microsoft.ts
 * with a real Microsoft Graph OAuth flow.
 */
export class MicrosoftPlugin implements IntegrationPlugin {
  readonly provider = 'microsoft' as const;
  readonly displayName = 'Microsoft 365';
  readonly description = 'Sync email, calendar, and contacts with Microsoft 365.';
  readonly icon = 'briefcase';

  private getOAuthUrl(orgId: string, redirectUri: string): string {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const tenant = process.env.MICROSOFT_TENANT_ID ?? 'common';
    const state = Buffer.from(JSON.stringify({ orgId, provider: this.provider })).toString('base64url');
    const params = new URLSearchParams({
      client_id: clientId ?? '',
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access',
      state,
    });
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async getAuthUrl(orgId: string, redirectUri: string): Promise<string> {
    return this.getOAuthUrl(orgId, redirectUri);
  }

  async connect(config: IntegrationConfig, code: string): Promise<IntegrationConfig> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenant = process.env.MICROSOFT_TENANT_ID ?? 'common';
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? '';

    if (!clientId || !clientSecret) {
      throw new Error('Microsoft OAuth credentials not configured');
    }

    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Microsoft token exchange failed: ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
    };

    return {
      ...config,
      status: 'connected',
      connectedAt: new Date(),
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      },
    };
  }

  async validate(config: IntegrationConfig): Promise<{ valid: boolean; message?: string }> {
    const accessToken = config.credentials?.accessToken as string | undefined;
    if (!accessToken) return { valid: false, message: 'Missing access token' };

    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { valid: res.ok, message: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { valid: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async refresh(config: IntegrationConfig): Promise<IntegrationConfig> {
    const refreshToken = config.credentials?.refreshToken as string | undefined;
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenant = process.env.MICROSOFT_TENANT_ID ?? 'common';

    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error('Cannot refresh: missing credentials');
    }

    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access',
      }),
    });

    if (!res.ok) throw new Error('Microsoft refresh failed');
    const data = (await res.json()) as { access_token: string; refresh_token?: string };

    return {
      ...config,
      credentials: {
        ...config.credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
      },
    };
  }

  async disconnect(_config: IntegrationConfig): Promise<void> {
    // Microsoft tokens cannot be directly revoked via OAuth.
    // We simply clear the stored credentials.
  }

  async sync(_config: IntegrationConfig): Promise<SyncResult> {
    // TODO: Sync calendar events and emails as activities.
    return { created: 0, updated: 0, deleted: 0, errors: [] };
  }

  getTools(): IntegrationTool[] {
    return [
      {
        name: 'microsoft_list_events',
        description: 'List calendar events from Microsoft 365.',
        parameters: {
          startDate: { type: 'string', description: 'ISO start date' },
          endDate: { type: 'string', description: 'ISO end date' },
        },
        execute: async (args, context) => {
          const accessToken = context.config.credentials?.accessToken as string | undefined;
          if (!accessToken) throw new Error('Microsoft not connected');
          const start = args.startDate as string;
          const end = args.endDate as string;
          const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) throw new Error(`Microsoft Graph error: ${res.status}`);
          return res.json();
        },
      },
      {
        name: 'microsoft_send_email',
        description: 'Send an email via Microsoft 365.',
        parameters: {
          to: { type: 'string', description: 'Recipient email', required: true },
          subject: { type: 'string', description: 'Email subject', required: true },
          body: { type: 'string', description: 'Email body (HTML)', required: true },
        },
        execute: async (args, context) => {
          const accessToken = context.config.credentials?.accessToken as string | undefined;
          if (!accessToken) throw new Error('Microsoft not connected');
          const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                subject: args.subject,
                body: { contentType: 'HTML', content: args.body },
                toRecipients: [{ emailAddress: { address: args.to } }],
              },
            }),
          });
          if (!res.ok) throw new Error(`Microsoft send failed: ${res.status}`);
          return { sent: true };
        },
      },
    ];
  }
}
