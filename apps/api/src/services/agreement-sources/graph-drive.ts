// Microsoft Graph read-only client for the agreement pull (slice 13a).
//
// App-only token (client credentials) for an Entra app granted Sites.Selected
// or Files.Read.All. Reuses MICROSOFT_TENANT_ID, MICROSOFT_GRAPH_CLIENT_ID and
// MICROSOFT_GRAPH_CLIENT_SECRET. Lists one drive (optionally one folder) with
// delta so each sync only sees what changed; downloads PDF/DOCX content only.
// Every call goes to fixed Microsoft hosts; fetch is injected for tests.
import { isAgreementFileName } from '@bidstack/shared';

export const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const LOGIN_ROOT = 'https://login.microsoftonline.com';
const MAX_PAGES = 50;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class GraphDriveError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'GraphDriveError';
  }
}

export interface GraphAppCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export function graphCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): GraphAppCredentials | null {
  const tenantId = env.MICROSOFT_TENANT_ID?.trim();
  const clientId = env.MICROSOFT_GRAPH_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || tenantId === 'common' || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

export async function getGraphAppToken(fetchFn: FetchFn, creds: GraphAppCredentials): Promise<string> {
  const res = await fetchFn(`${LOGIN_ROOT}/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
  });
  if (!res.ok) throw new GraphDriveError(`Graph token request failed (${res.status})`, res.status);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new GraphDriveError('Graph token response had no access_token');
  return json.access_token;
}

interface RawDriveItem {
  id: string;
  name?: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  deleted?: unknown;
  folder?: unknown;
  file?: { mimeType?: string; hashes?: { sha256Hash?: string; quickXorHash?: string } };
  parentReference?: { id?: string; path?: string };
}

export interface DriveFile {
  id: string;
  name: string;
  size: number | null;
  version: string;
  webUrl: string | null;
  lastModified: string | null;
  sha256: string | null;
  parentPath: string | null;
}

export interface DriveDeltaPage {
  files: DriveFile[];
  removedIds: string[];
  deltaLink: string;
}

function itemToFile(item: RawDriveItem): DriveFile | null {
  if (!item.file || !item.name || !isAgreementFileName(item.name)) return null;
  return {
    id: item.id,
    name: item.name,
    size: typeof item.size === 'number' ? item.size : null,
    version: item.cTag ?? item.eTag ?? item.lastModifiedDateTime ?? item.id,
    webUrl: item.webUrl ?? null,
    lastModified: item.lastModifiedDateTime ?? null,
    sha256: item.file.hashes?.sha256Hash?.toLowerCase() ?? null,
    parentPath: item.parentReference?.path ?? null,
  };
}

/** Only Graph links may be followed, so a tampered cursor cannot redirect us. */
function assertGraphUrl(url: string): string {
  if (!url.startsWith(`${GRAPH_ROOT}/`)) throw new GraphDriveError('Unexpected Graph link');
  return url;
}

// SharePoint and OneDrive for Business only support delta on the drive root,
// so a folder pick is applied as a path filter on the root feed.
export function deltaStartUrl(driveId: string): string {
  return `${GRAPH_ROOT}/drives/${encodeURIComponent(driveId)}/root/delta?$select=id,name,size,eTag,cTag,webUrl,lastModifiedDateTime,file,folder,deleted,parentReference`;
}

/** True when a Graph parent path ("/drive/root:/Legal/MSA") sits under folderPath. */
export function inFolder(parentPath: string | null, folderPath: string | undefined): boolean {
  if (!folderPath) return true;
  if (!parentPath) return false;
  const want = `/${folderPath.replace(/^\/+|\/+$/g, '')}`.toLowerCase();
  const at = parentPath.indexOf('root:');
  const have = decodeURIComponent(at >= 0 ? parentPath.slice(at + 5) : parentPath).toLowerCase() || '/';
  return have === want || have.startsWith(`${want}/`);
}

/**
 * Walk the delta feed from the stored deltaLink (or from the start) to the
 * new deltaLink. Folders and non PDF/DOCX files are dropped; deleted items are
 * reported so the caller can ignore them (agreements are never auto-removed).
 */
export async function listDriveDelta(
  fetchFn: FetchFn,
  token: string,
  opts: { driveId: string; folderPath?: string; deltaLink?: string | null },
): Promise<DriveDeltaPage> {
  let url = assertGraphUrl(opts.deltaLink ?? deltaStartUrl(opts.driveId));
  const files: DriveFile[] = [];
  const removedIds: string[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (res.status === 410) {
      // Graph expired the cursor: restart from the top of the folder.
      url = deltaStartUrl(opts.driveId);
      continue;
    }
    if (!res.ok) throw new GraphDriveError(`Graph delta failed (${res.status})`, res.status);
    const json = (await res.json()) as {
      value?: RawDriveItem[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    for (const item of json.value ?? []) {
      if (item.deleted) {
        removedIds.push(item.id);
        continue;
      }
      const file = itemToFile(item);
      if (file && inFolder(file.parentPath, opts.folderPath)) files.push(file);
    }
    if (json['@odata.deltaLink']) {
      return { files, removedIds, deltaLink: assertGraphUrl(json['@odata.deltaLink']) };
    }
    if (!json['@odata.nextLink']) throw new GraphDriveError('Graph delta ended without a deltaLink');
    url = assertGraphUrl(json['@odata.nextLink']);
  }
  throw new GraphDriveError('Graph delta exceeded the page limit');
}

/** Download one file's bytes. Graph answers 302 to a short-lived download URL. */
export async function downloadDriveItem(
  fetchFn: FetchFn,
  token: string,
  opts: { driveId: string; itemId: string; maxBytes: number },
): Promise<Buffer> {
  const res = await fetchFn(
    `${GRAPH_ROOT}/drives/${encodeURIComponent(opts.driveId)}/items/${encodeURIComponent(opts.itemId)}/content`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new GraphDriveError(`Graph download failed (${res.status})`, res.status);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > opts.maxBytes) throw new GraphDriveError('File is larger than the agreement limit');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > opts.maxBytes) throw new GraphDriveError('File is larger than the agreement limit');
  return buf;
}
