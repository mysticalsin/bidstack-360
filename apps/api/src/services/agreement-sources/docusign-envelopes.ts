// DocuSign eSignature read-only client for the agreement pull (slice 13a).
//
// JWT grant (DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_PRIVATE_KEY
// as base64 PEM, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_BASE_URL, DOCUSIGN_OAUTH_HOST).
// Lists completed envelopes since the cursor date, narrowed by template,
// folder or keyword, and downloads the combined PDF with its metadata
// (counterparty, signed date). Nothing is sent or voided from here.
import { createSign } from 'node:crypto';

import type { FetchFn } from './graph-drive.js';

const MAX_PAGES = 20;
const PAGE_SIZE = 100;

export class DocuSignError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DocuSignError';
  }
}

export interface DocuSignCredentials {
  integrationKey: string;
  userId: string;
  privateKeyPem: string;
  accountId: string;
  /** e.g. https://demo.docusign.net (with or without /restapi). */
  baseUrl: string;
  /** account-d.docusign.com (demo) or account.docusign.com (production). */
  oauthHost: string;
}

export function docuSignCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): DocuSignCredentials | null {
  const integrationKey = env.DOCUSIGN_INTEGRATION_KEY?.trim();
  const userId = env.DOCUSIGN_USER_ID?.trim();
  const privateKey = env.DOCUSIGN_PRIVATE_KEY?.trim();
  const accountId = env.DOCUSIGN_ACCOUNT_ID?.trim();
  const baseUrl = env.DOCUSIGN_BASE_URL?.trim();
  if (!integrationKey || !userId || !privateKey || !accountId || !baseUrl) return null;
  return {
    integrationKey,
    userId,
    privateKeyPem: Buffer.from(privateKey, 'base64').toString('utf8'),
    accountId,
    baseUrl,
    oauthHost: env.DOCUSIGN_OAUTH_HOST?.trim() || 'account-d.docusign.com',
  };
}

export function restRoot(creds: Pick<DocuSignCredentials, 'baseUrl' | 'accountId'>): string {
  const base = creds.baseUrl.replace(/\/+$/, '').replace(/\/restapi$/, '');
  return `${base}/restapi/v2.1/accounts/${encodeURIComponent(creds.accountId)}`;
}

export function buildJwtAssertion(creds: DocuSignCredentials, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: creds.integrationKey,
      sub: creds.userId,
      aud: creds.oauthHost,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      scope: 'signature impersonation',
    }),
  ).toString('base64url');
  const input = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  return `${input}.${signer.sign(creds.privateKeyPem).toString('base64url')}`;
}

export async function getDocuSignToken(fetchFn: FetchFn, creds: DocuSignCredentials): Promise<string> {
  const res = await fetchFn(`https://${creds.oauthHost}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildJwtAssertion(creds),
    }).toString(),
  });
  if (!res.ok) throw new DocuSignError(`DocuSign token request failed (${res.status})`, res.status);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new DocuSignError('DocuSign token response had no access_token');
  return json.access_token;
}

interface RawEnvelope {
  envelopeId: string;
  status?: string;
  emailSubject?: string;
  completedDateTime?: string;
  statusChangedDateTime?: string;
  recipients?: { signers?: Array<{ name?: string; email?: string; signedDateTime?: string; recipientType?: string }> };
  customFields?: {
    textCustomFields?: Array<{ name?: string; value?: string }>;
    listCustomFields?: Array<{ name?: string; value?: string }>;
  };
}

export interface CompletedEnvelope {
  envelopeId: string;
  subject: string;
  completedAt: string | null;
  counterparty: string | null;
  signers: Array<{ name: string; email: string | null }>;
}

const COUNTERPARTY_FIELDS = /^(counterparty|client|customer|company|account)$/i;

function toEnvelope(raw: RawEnvelope): CompletedEnvelope {
  const fields = [...(raw.customFields?.textCustomFields ?? []), ...(raw.customFields?.listCustomFields ?? [])];
  const named = fields.find((f) => f.name && COUNTERPARTY_FIELDS.test(f.name.trim()) && f.value?.trim());
  const signers = (raw.recipients?.signers ?? [])
    .filter((s) => s.name)
    .map((s) => ({ name: String(s.name), email: s.email ?? null }));
  return {
    envelopeId: raw.envelopeId,
    subject: raw.emailSubject?.trim() || raw.envelopeId,
    completedAt: raw.completedDateTime ?? raw.statusChangedDateTime ?? null,
    counterparty: named?.value?.trim() ?? null,
    signers,
  };
}

export interface EnvelopeFilter {
  fromDate: string;
  templateId?: string;
  folderId?: string;
  keyword?: string;
}

async function envelopeUsesTemplate(
  fetchFn: FetchFn,
  token: string,
  root: string,
  envelopeId: string,
  templateId: string,
): Promise<boolean> {
  const res = await fetchFn(`${root}/envelopes/${encodeURIComponent(envelopeId)}/templates`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!res.ok) throw new DocuSignError(`DocuSign template lookup failed (${res.status})`, res.status);
  const json = (await res.json()) as { templates?: Array<{ templateId?: string }> };
  return (json.templates ?? []).some((t) => t.templateId === templateId);
}

/** Completed envelopes changed since fromDate that match every set filter. */
export async function listCompletedEnvelopes(
  fetchFn: FetchFn,
  token: string,
  creds: Pick<DocuSignCredentials, 'baseUrl' | 'accountId'>,
  filter: EnvelopeFilter,
): Promise<CompletedEnvelope[]> {
  const root = restRoot(creds);
  const out: CompletedEnvelope[] = [];
  let start = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      from_date: filter.fromDate,
      status: 'completed',
      include: 'recipients,custom_fields',
      count: String(PAGE_SIZE),
      start_position: String(start),
      order_by: 'status_changed',
      order: 'asc',
    });
    if (filter.folderId) params.set('folder_ids', filter.folderId);
    if (filter.keyword) params.set('search_text', filter.keyword);
    const res = await fetchFn(`${root}/envelopes?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) throw new DocuSignError(`DocuSign envelope list failed (${res.status})`, res.status);
    const json = (await res.json()) as { envelopes?: RawEnvelope[]; resultSetSize?: string; totalSetSize?: string };
    const batch = (json.envelopes ?? []).filter((e) => e.envelopeId && (e.status ?? 'completed') === 'completed');
    for (const raw of batch) {
      if (filter.templateId && !(await envelopeUsesTemplate(fetchFn, token, root, raw.envelopeId, filter.templateId))) continue;
      out.push(toEnvelope(raw));
    }
    const size = Number(json.resultSetSize ?? batch.length);
    const total = Number(json.totalSetSize ?? size);
    start += size;
    if (size === 0 || start >= total) return out;
  }
  return out;
}

export async function downloadCombinedPdf(
  fetchFn: FetchFn,
  token: string,
  creds: Pick<DocuSignCredentials, 'baseUrl' | 'accountId'>,
  envelopeId: string,
  maxBytes: number,
): Promise<Buffer> {
  const res = await fetchFn(`${restRoot(creds)}/envelopes/${encodeURIComponent(envelopeId)}/documents/combined`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/pdf' },
  });
  if (!res.ok) throw new DocuSignError(`DocuSign download failed (${res.status})`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new DocuSignError('Envelope PDF is larger than the agreement limit');
  return buf;
}
