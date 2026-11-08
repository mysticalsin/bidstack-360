// Recorded-shape fixtures for the Graph drive delta and DocuSign envelope
// APIs (slice 13a contract tests). Ids and names are synthetic.
import type { FetchFn } from '../services/agreement-sources/graph-drive.js';

export const DRIVE_ID = 'b!fixture-drive-legal';

export const GRAPH_DELTA_PAGE_1 = {
  value: [
    { id: 'root-1', name: 'root', folder: { childCount: 2 }, parentReference: { path: '/drive/root:' } },
    {
      id: 'item-msa-pfizer',
      name: 'Pfizer Global MSA 2025.pdf',
      size: 48211,
      cTag: '"c:{A1},3"',
      eTag: '"{A1},3"',
      webUrl: 'https://contoso.sharepoint.com/sites/legal/Shared%20Documents/MSA/Pfizer%20Global%20MSA%202025.pdf',
      lastModifiedDateTime: '2026-10-02T09:12:00Z',
      file: { mimeType: 'application/pdf', hashes: { quickXorHash: 'aGFzaA==' } },
      parentReference: { path: '/drive/root:/MSA' },
    },
    {
      id: 'item-notes',
      name: 'meeting notes.txt',
      size: 120,
      cTag: '"c:{B2},1"',
      file: { mimeType: 'text/plain' },
      parentReference: { path: '/drive/root:/MSA' },
    },
  ],
  '@odata.nextLink': `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(DRIVE_ID)}/root/delta?token=page2`,
};

export const GRAPH_DELTA_PAGE_2 = {
  value: [
    {
      id: 'item-sow',
      name: 'Northwind SOW.docx',
      size: 21000,
      cTag: '"c:{C3},1"',
      file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      parentReference: { path: '/drive/root:/MSA/Northwind' },
    },
    {
      id: 'item-elsewhere',
      name: 'Other.pdf',
      size: 1000,
      cTag: '"c:{D4},1"',
      file: { mimeType: 'application/pdf' },
      parentReference: { path: '/drive/root:/Marketing' },
    },
    { id: 'item-gone', deleted: { state: 'deleted' } },
  ],
  '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(DRIVE_ID)}/root/delta?token=next-cursor`,
};

export const DOCUSIGN_ENVELOPES = {
  resultSetSize: '2',
  totalSetSize: '2',
  envelopes: [
    {
      envelopeId: 'env-pfizer-001',
      status: 'completed',
      emailSubject: 'Pfizer Global MSA signature',
      completedDateTime: '2026-09-30T15:00:00Z',
      recipients: { signers: [{ name: 'A. Signer', email: 'signer@example.com' }] },
      customFields: { textCustomFields: [{ name: 'Counterparty', value: 'Pfizer Inc.' }] },
    },
    {
      envelopeId: 'env-other-002',
      status: 'completed',
      emailSubject: 'NDA',
      completedDateTime: '2026-10-01T10:00:00Z',
      recipients: { signers: [] },
    },
  ],
};

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Route table fetch: first matching prefix answers; every call is recorded. */
export function fakeFetch(
  routes: Array<[match: string | RegExp, answer: (url: string) => Response | Promise<Response>]>,
): { fetch: FetchFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url: input, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : null });
    const hit = routes.find(([m]) => (typeof m === 'string' ? input.startsWith(m) : m.test(input)));
    if (!hit) return new Response('not found', { status: 404 });
    return hit[1](input);
  };
  return { fetch: fetchFn, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
