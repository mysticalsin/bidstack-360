/**
 * sharepoint-graph.ts — pull sales-toolkit collateral from a SharePoint document
 * library via Microsoft Graph (client-credentials / app-only).
 *
 * Env-gated, mirroring the 360Learning LMS pattern: when not configured we expose
 * a clear "not configured" state (the UI shows a connect prompt); we never invent
 * data. Requires an Entra app registration with Sites.Read.All (app) consent.
 *
 *   SHAREPOINT_ENABLED=true
 *   SHAREPOINT_TENANT_ID=<tenant guid>
 *   SHAREPOINT_CLIENT_ID=<app/client id>
 *   SHAREPOINT_CLIENT_SECRET=<client secret>
 *   SHAREPOINT_SITE_ID=<graph site id>
 *   SHAREPOINT_DRIVE_ID=<document library drive id>
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const FETCH_TIMEOUT_MS = 8000;

export class SharePointError extends Error {}

export interface SharePointToolkit {
  externalId: string;
  title: string;
  url: string | null;
  description: string | null;
}

interface SpConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId: string;
}

function readConfig(): SpConfig | null {
  if (process.env.SHAREPOINT_ENABLED !== 'true') return null;
  const tenantId = process.env.SHAREPOINT_TENANT_ID?.trim();
  const clientId = process.env.SHAREPOINT_CLIENT_ID?.trim();
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET?.trim();
  const siteId = process.env.SHAREPOINT_SITE_ID?.trim();
  const driveId = process.env.SHAREPOINT_DRIVE_ID?.trim();
  if (!tenantId || !clientId || !clientSecret || !siteId || !driveId) return null;
  return { tenantId, clientId, clientSecret, siteId, driveId };
}

export function sharePointConfigured(): boolean {
  return readConfig() !== null;
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getToken(cfg: SpConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await withTimeout(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
  );
  if (!res.ok) throw new SharePointError(`SharePoint token request failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new SharePointError('SharePoint token response missing access_token');
  return json.access_token;
}

interface GraphDriveItem {
  id: string;
  name?: string;
  webUrl?: string;
  file?: unknown;
  folder?: unknown;
}

/** List files in the configured SharePoint drive, mapped to toolkit shape. */
export async function fetchSharePointToolkits(): Promise<SharePointToolkit[]> {
  const cfg = readConfig();
  if (!cfg) throw new SharePointError('SharePoint is not configured');
  const token = await getToken(cfg);
  const res = await withTimeout(
    `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drives/${encodeURIComponent(cfg.driveId)}/root/children?$top=200`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new SharePointError(`SharePoint drive listing failed (${res.status})`);
  const json = (await res.json()) as { value?: GraphDriveItem[] };
  return (json.value ?? [])
    .filter((item) => item.file && item.name) // files only, skip folders
    .map((item) => ({
      externalId: item.id,
      title: item.name as string,
      url: item.webUrl ?? null,
      description: null,
    }));
}
