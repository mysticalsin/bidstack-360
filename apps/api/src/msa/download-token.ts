// Short-lived, sealed download tokens for the local storage driver. S3 uses
// native presigned URLs; local dev has no signer, so the API mints an
// AES-256-GCM sealed token (encryptSecret) that names exactly one version of
// one org and expires quickly. The public /msa/download route opens it.
import { decryptSecret, encryptSecret } from '@bidstack/shared/server-crypto';

export const MSA_DOWNLOAD_TTL_SECONDS = 120;
const PURPOSE = 'polo.msa-download.v1';

interface Sealed {
  pur: string;
  org: string;
  usr: string;
  ver: string;
  exp: number;
}

export function issueMsaDownloadToken(
  who: { orgId: string; userId: string; versionId: string },
  now: number = Date.now(),
): { token: string; expiresAt: Date } {
  const exp = now + MSA_DOWNLOAD_TTL_SECONDS * 1000;
  const sealed: Sealed = { pur: PURPOSE, org: who.orgId, usr: who.userId, ver: who.versionId, exp };
  return { token: encryptSecret(JSON.stringify(sealed)), expiresAt: new Date(exp) };
}

export function openMsaDownloadToken(
  token: string,
  now: number = Date.now(),
): { orgId: string; userId: string; versionId: string } | null {
  let parsed: Sealed;
  try {
    parsed = JSON.parse(decryptSecret(token)) as Sealed;
  } catch {
    return null;
  }
  if (parsed?.pur !== PURPOSE || typeof parsed.exp !== 'number' || parsed.exp < now) return null;
  if (!parsed.org || !parsed.usr || !parsed.ver) return null;
  return { orgId: parsed.org, userId: parsed.usr, versionId: parsed.ver };
}
