// Bytes for a DocuSign envelope. Document.storageUrl is not a request field in
// this tree, but the send path fetches whatever is stored. Only https URLs on
// the configured bucket host are dialed, through pinnedFetch, with redirects
// refused.

import { pinnedFetch, type PinnedResolver, type PinnedTransport } from '@bidstack/shared/server';

export interface SigningDocumentFetchOptions {
  resolve?: PinnedResolver;
  transport?: PinnedTransport;
}

/** Hosts that may serve a signing document. Empty when no bucket is configured. */
export function signingDocumentHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts: string[] = [];
  const bucket = env.S3_BUCKET?.trim();
  const region = env.S3_REGION?.trim() || 'us-east-1';
  if (bucket) {
    hosts.push(`${bucket}.s3.${region}.amazonaws.com`.toLowerCase());
    hosts.push(`${bucket}.s3.amazonaws.com`.toLowerCase());
  }
  const endpoint = env.S3_ENDPOINT?.trim();
  if (endpoint) {
    try {
      hosts.push(new URL(endpoint).hostname.toLowerCase());
    } catch {
      // A bad endpoint does not widen the allowlist.
    }
  }
  return hosts;
}

export async function fetchSigningDocumentBytes(
  storageUrl: string,
  opts: SigningDocumentFetchOptions = {},
): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(storageUrl);
  } catch {
    throw new Error('Document storage URL is invalid');
  }
  if (url.protocol !== 'https:') throw new Error('Document storage URL must use https');
  const allowed = signingDocumentHosts();
  if (!allowed.includes(url.hostname.toLowerCase())) {
    throw new Error('Document storage URL is not an allowed bucket host');
  }
  const res = await pinnedFetch(storageUrl, {
    method: 'GET',
    redirect: 'error',
    maxHops: 0,
    timeoutMs: 20_000,
    maxBytes: 25 * 1024 * 1024,
    resolve: opts.resolve,
    transport: opts.transport,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Failed to fetch document for signing: ${res.status}`);
  }
  return res.body;
}
