/**
 * Signature service — DocuSign envelope management + INTERNAL fallback provider.
 *
 * DocuSign flow (JWT):
 *   1. Exchange RSA private key for an access token (2-hour TTL, cached).
 *   2. POST /envelopes to create + send an envelope.
 *   3. DocuSign fires Connect webhooks; handleDocuSignWebhook verifies HMAC
 *      and updates SignatureRequest + appends a SignatureEvent.
 *
 * INTERNAL provider:
 *   Used for orgs without a DocuSign account or for internal approval workflows.
 *   Generates a HMAC-signed JWT as a signing token, stores it on the request,
 *   returns a /sign/:token URL. On submission, captures typed name + canvas
 *   signature image + IP + user-agent, renders a PDF, and uploads it to S3.
 *   NOT legally equivalent to DocuSign — suitable for internal approvals only.
 *
 * Multi-tenancy: every function accepts orgId and verifies ownership before
 * any state mutation. Callers (routes) must extract orgId from req.auth.
 */

import { createHmac, createSign, randomBytes } from 'node:crypto';
import type { FastifyError } from 'fastify';
import { prisma, type Prisma } from '@bidstack/db';
import type { SignatureStatus } from '@bidstack/shared';
import { htmlToPdf } from './document.service.js';
import { getEnv } from '../../env.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Recipient {
  email: string;
  name: string;
  role: string;
}

export interface CreateSignatureRequestInput {
  orgId: string;
  documentId: string;
  recipients: Recipient[];
  message?: string;
  provider?: 'DOCUSIGN' | 'INTERNAL';
}

export interface DocuSignWebhookPayload {
  event?: string;
  envelopeId?: string;
  status?: string;
  recipients?: {
    signers?: Array<{ email: string; status?: string; signedDateTime?: string }>;
  };
  [key: string]: unknown;
}

// ─── DocuSign token cache ─────────────────────────────────────────────────────
// WHY: DocuSign access tokens are valid for 2h. Caching avoids one extra round-trip
// per signature operation. Cache is process-local; fine for single-instance API.

let dsTokenCache: { token: string; expiresAt: number } | null = null;

async function getDocuSignAccessToken(): Promise<string> {
  const now = Date.now();
  if (dsTokenCache && dsTokenCache.expiresAt > now + 60_000) {
    return dsTokenCache.token;
  }

  const env = getEnv();
  if (!env.DOCUSIGN_INTEGRATION_KEY || !env.DOCUSIGN_USER_ID || !env.DOCUSIGN_PRIVATE_KEY) {
    throw credentialError('DocuSign credentials not configured');
  }

  // JWT assertion — DocuSign uses RS256 JWT bearer grant
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const iat = Math.floor(now / 1000);
  const claims = Buffer.from(
    JSON.stringify({
      iss: env.DOCUSIGN_INTEGRATION_KEY,
      sub: env.DOCUSIGN_USER_ID,
      aud: 'account-d.docusign.com', // sandbox audience
      iat,
      exp: iat + 3600,
      scope: 'signature impersonation',
    }),
  ).toString('base64url');

  const signingInput = `${header}.${claims}`;
  const privateKeyPem = Buffer.from(env.DOCUSIGN_PRIVATE_KEY, 'base64').toString('utf8');
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(privateKeyPem).toString('base64url');
  const assertion = `${signingInput}.${sig}`;

  const res = await fetch('https://account-d.docusign.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw credentialError(`DocuSign OAuth token exchange failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  dsTokenCache = { token: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return dsTokenCache.token;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function notFound(msg: string): never {
  const err = new Error(msg) as FastifyError;
  err.statusCode = 404;
  throw err;
}

function forbidden(msg: string): never {
  const err = new Error(msg) as FastifyError;
  err.statusCode = 403;
  throw err;
}

function credentialError(msg: string): FastifyError {
  const err = new Error(msg) as FastifyError;
  err.statusCode = 503;
  return err;
}

function badRequest(msg: string): never {
  const err = new Error(msg) as FastifyError;
  err.statusCode = 400;
  throw err;
}

// ─── createSignatureRequest ───────────────────────────────────────────────────

export async function createSignatureRequest(
  input: CreateSignatureRequestInput,
): Promise<{ id: string; signingUrl?: string }> {
  const { orgId, documentId, recipients, message, provider = 'DOCUSIGN' } = input;

  // Verify the document belongs to this org
  const doc = await prisma.document.findFirst({
    where: { id: documentId, orgId, deletedAt: null },
  });
  if (!doc) notFound(`Document ${documentId} not found`);

  const request = await prisma.signatureRequest.create({
    data: {
      orgId,
      documentId,
      provider,
      status: 'DRAFT',
      recipients: recipients as object[],
    },
  });

  if (provider === 'DOCUSIGN') {
    const envelopeId = await sendDocuSignEnvelope({ doc, recipients, message, request });
    await prisma.signatureRequest.update({
      where: { id: request.id },
      data: { providerRequestId: envelopeId, status: 'SENT', sentAt: new Date() },
    });
    await appendEvent(request.id, 'SENT', null, null, null, {});
    return { id: request.id };
  }

  // INTERNAL provider — generate a secure single-use token
  const token = randomBytes(32).toString('hex');
  await prisma.signatureRequest.update({
    where: { id: request.id },
    data: { providerRequestId: token, status: 'SENT', sentAt: new Date() },
  });
  await appendEvent(request.id, 'SENT', null, null, null, { provider: 'INTERNAL' });

  const env = getEnv();
  const signingUrl = `${env.PUBLIC_BASE_URL}/sign/${token}`;
  return { id: request.id, signingUrl };
}

// ─── sendDocuSignEnvelope (internal) ─────────────────────────────────────────

async function sendDocuSignEnvelope(params: {
  doc: { id: string; storageUrl: string; name: string };
  recipients: Recipient[];
  message: string | undefined;
  request: { id: string };
}): Promise<string> {
  const { doc, recipients, message } = params;
  const env = getEnv();
  const baseUrl = env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
  const accountId = env.DOCUSIGN_ACCOUNT_ID;
  if (!accountId) throw credentialError('DOCUSIGN_ACCOUNT_ID not configured');

  const token = await getDocuSignAccessToken();

  // Fetch the document bytes from S3 storage URL
  const docRes = await fetch(doc.storageUrl);
  if (!docRes.ok) throw credentialError(`Failed to fetch document for signing: ${docRes.status}`);
  const docBytes = Buffer.from(await docRes.arrayBuffer()).toString('base64');

  const signers = recipients.map((r, i) => ({
    email: r.email,
    name: r.name,
    recipientId: String(i + 1),
    routingOrder: String(i + 1),
    tabs: {
      signHereTabs: [
        {
          // Default placement — in a real integration, use DocuSign templates
          // or anchor strings (e.g. /sn1/) embedded in the document.
          anchorString: '/sig/',
          anchorIgnoreIfNotPresent: 'true',
          anchorXOffset: '0',
          anchorYOffset: '0',
        },
      ],
    },
  }));

  const envelopeBody = {
    emailSubject: message ?? `Please sign: ${doc.name}`,
    documents: [
      { documentBase64: docBytes, name: doc.name, fileExtension: 'pdf', documentId: '1' },
    ],
    recipients: { signers },
    status: 'sent',
  };

  const res = await fetch(`${baseUrl}/v2.1/accounts/${accountId}/envelopes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(envelopeBody),
  });

  if (!res.ok) {
    const body = await res.text();
    throw credentialError(`DocuSign envelope creation failed: ${res.status} ${body}`);
  }

  const result = (await res.json()) as { envelopeId: string };
  return result.envelopeId;
}

// ─── handleDocuSignWebhook ────────────────────────────────────────────────────

/**
 * Verify DocuSign Connect HMAC-SHA256 signature, then update the request status
 * and append an immutable SignatureEvent.
 *
 * WHY HMAC verification is mandatory: DocuSign sends webhooks over the public
 * internet. Any unauthenticated party could forge a "SIGNED" event and bypass
 * the signing requirement.
 *
 * DocuSign signs using: HMAC-SHA256(key, requestBody) → base64
 * Header name: X-DocuSign-Signature-1
 */
export async function handleDocuSignWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  payload: DocuSignWebhookPayload,
): Promise<void> {
  const env = getEnv();
  if (env.DOCUSIGN_WEBHOOK_HMAC_KEY) {
    if (!signatureHeader) {
      badRequest('Missing X-DocuSign-Signature-1 header');
    }
    const expected = createHmac('sha256', env.DOCUSIGN_WEBHOOK_HMAC_KEY)
      .update(rawBody)
      .digest('base64');
    // Timing-safe comparison to prevent timing attacks
    const actual = Buffer.from(signatureHeader, 'base64');
    const expected_buf = Buffer.from(expected, 'base64');
    if (actual.length !== expected_buf.length || !timingSafeEqual(actual, expected_buf)) {
      badRequest('DocuSign webhook HMAC verification failed');
    }
  }

  const envelopeId = payload.envelopeId;
  if (!envelopeId) return; // malformed webhook — ignore

  const request = await prisma.signatureRequest.findFirst({
    where: { providerRequestId: envelopeId, provider: 'DOCUSIGN' },
  });
  if (!request) return; // not our envelope — ignore

  const eventType = mapDocuSignStatus(payload.event ?? payload.status ?? '');
  if (!eventType) return;

  const newStatus = docuSignStatusToModel(eventType);

  // IDEMPOTENCY GATE: DocuSign Connect delivers at-least-once — a "completed"
  // event is redelivered on every retry until we return 200. Without a guard,
  // each redelivery re-runs the status write AND appends a duplicate
  // SignatureEvent, polluting the non-repudiable audit trail. We mirror the
  // internal-sign TOCTOU pattern: claim the transition atomically with an
  // updateMany whose WHERE excludes the target status and all terminal states.
  // count===0 means this event was already processed (or the request is already
  // terminal) — we return WITHOUT recording a duplicate event. The route still
  // sends 200 (we don't throw), so DocuSign stops retrying.
  //
  // `status: { not: newStatus }` dedupes same-status redeliveries (e.g. a second
  // "completed"). `notIn TERMINAL_STATUSES` ensures a terminal request (already
  // SIGNED/VOIDED/DECLINED/EXPIRED) is never reopened by a late or out-of-order
  // event. Both conditions live on the WHERE, so the gate is decided in the DB,
  // not in app code that two concurrent deliveries could both pass.
  await prisma.$transaction(async (tx) => {
    const claim = await tx.signatureRequest.updateMany({
      where: {
        id: request.id,
        status: { not: newStatus, notIn: DOCUSIGN_TERMINAL_STATUSES },
      },
      data: {
        status: newStatus,
        ...(newStatus === 'SIGNED' ? { completedAt: new Date() } : {}),
        ...(newStatus === 'VOIDED' ? { voidedAt: new Date() } : {}),
      },
    });
    if (claim.count === 0) {
      // Already processed / already terminal — duplicate or stale delivery.
      // No event written; the transaction commits as a no-op and the caller
      // returns 200 so DocuSign stops retrying.
      return;
    }

    await tx.signatureEvent.create({
      data: {
        signatureRequestId: request.id,
        type: eventType,
        recipientEmail: payload.recipients?.signers?.[0]?.email ?? null,
        occurredAt: new Date(),
        ipAddress: null,
        userAgent: null,
        payload: payload as object,
      },
    });
  });
}

// Terminal signature states. Once a request reaches any of these, a redelivered
// or out-of-order DocuSign webhook must NOT mutate it or append another event.
const DOCUSIGN_TERMINAL_STATUSES: SignatureStatus[] = [
  'SIGNED',
  'VOIDED',
  'DECLINED',
  'EXPIRED',
];

// ─── voidSignatureRequest ─────────────────────────────────────────────────────

export async function voidSignatureRequest(params: {
  orgId: string;
  requestId: string;
  reason: string;
}): Promise<void> {
  const { orgId, requestId, reason } = params;

  const request = await prisma.signatureRequest.findFirst({
    where: { id: requestId, orgId, deletedAt: null },
  });
  if (!request) notFound(`Signature request ${requestId} not found`);
  if (request.orgId !== orgId) forbidden('Cannot void a signature request from another org');

  const terminalStatuses: SignatureStatus[] = ['SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED'];
  if (terminalStatuses.includes(request.status as SignatureStatus)) {
    badRequest(`Cannot void a request with status ${request.status}`);
  }

  if (request.provider === 'DOCUSIGN' && request.providerRequestId) {
    const env = getEnv();
    const baseUrl = env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
    const accountId = env.DOCUSIGN_ACCOUNT_ID;
    if (accountId) {
      const token = await getDocuSignAccessToken();
      const res = await fetch(
        `${baseUrl}/v2.1/accounts/${accountId}/envelopes/${request.providerRequestId}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'voided', voidedReason: reason }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw credentialError(`DocuSign void failed: ${res.status} ${body}`);
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.signatureRequest.update({
      where: { id: requestId },
      data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
    });
    await tx.signatureEvent.create({
      data: {
        signatureRequestId: requestId,
        type: 'VOIDED',
        recipientEmail: null,
        occurredAt: new Date(),
        ipAddress: null,
        userAgent: null,
        payload: { reason } as object,
      },
    });
  });
}

// ─── handleInternalSign ───────────────────────────────────────────────────────

/**
 * Process a submission from the public /sign/:token page (INTERNAL provider).
 * Generates a signed PDF with the typed name + canvas signature embedded,
 * stores it in S3, marks the request as SIGNED.
 */
export async function handleInternalSign(params: {
  token: string;
  typedName: string;
  signatureDataUrl: string;
  ipAddress: string;
  userAgent: string;
}): Promise<{ requestId: string }> {
  const { token, typedName, signatureDataUrl, ipAddress, userAgent } = params;

  const request = await prisma.signatureRequest.findFirst({
    where: { providerRequestId: token, provider: 'INTERNAL' },
    include: { document: true },
  });

  if (!request) notFound('Signing link not found or expired');
  if (request.status === 'VOIDED') badRequest('This signing request has been voided');
  if (request.status === 'SIGNED') badRequest('Document has already been signed');

  // The signed-PDF key is deterministic (orgId + requestId), so winning the
  // transition lets us record it up front and the loser never overwrites it.
  const s3Key = `signed-docs/${request.orgId}/${request.id}/signed.pdf`;

  // TOCTOU GATE: claim the SIGNED transition atomically BEFORE the expensive
  // PDF render + S3 PUT. `notIn: ['SIGNED','VOIDED']` means only one of two
  // concurrent submits matches; the loser's count===0 aborts here — so we never
  // render twice, never overwrite the signed PDF, and never record duplicate
  // SIGNED events on the non-repudiable audit trail.
  const claim = await prisma.signatureRequest.updateMany({
    where: { id: request.id, status: { notIn: ['SIGNED', 'VOIDED'] } },
    data: {
      status: 'SIGNED',
      completedAt: new Date(),
      completedDocumentS3Key: s3Key,
      recipients: updateRecipientSignedAt(request.recipients as object[], typedName),
    },
  });
  if (claim.count === 0) {
    // Another request won the race (or it was voided between read and claim).
    badRequest('Document has already been signed');
  }

  // Build a minimal signed document HTML
  const signedHtml = buildSignedDocumentHtml({
    typedName,
    signatureDataUrl,
    signedAt: new Date().toISOString(),
    documentName: request.document.name,
  });

  const pdfBuf = await htmlToPdf(signedHtml);

  // Upload to storage
  const { getStorage } = await import('../../storage/index.js');
  const store = await getStorage();
  // Persist the signed PDF. Local: direct disk write. S3: PUT the bytes via a
  // presigned URL (driver-agnostic — no direct SDK dependency here). The status
  // is already SIGNED (claimed above for TOCTOU dedup); if this PUT throws, the
  // request stays SIGNED with no SIGNED event recorded (the event write below is
  // skipped) — the gap is detectable and the deterministic key is re-PUTtable on
  // retry. The previous S3 branch was a no-op TODO that silently discarded every
  // signed PDF in production while reporting success. (Review.)
  if (store.writeLocal) {
    await store.writeLocal(s3Key, pdfBuf);
  } else {
    const upload = await store.getUploadUrl({
      key: s3Key,
      contentType: 'application/pdf',
      bytes: pdfBuf.length,
    });
    const putRes = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: pdfBuf,
      signal: AbortSignal.timeout(20_000),
    });
    if (!putRes.ok) {
      throw new Error(`Failed to persist signed PDF to storage (PUT returned ${putRes.status})`);
    }
  }

  // The SIGNED status, completedAt, s3Key, and recipient signedAt were committed
  // by the winning claim above. Only the immutable audit event remains — record
  // it exactly once (one SIGNED event per winning submit, as before).
  await prisma.signatureEvent.create({
    data: {
      signatureRequestId: request.id,
      type: 'SIGNED',
      recipientEmail: extractFirstEmail(request.recipients as object[]),
      occurredAt: new Date(),
      ipAddress,
      userAgent,
      payload: { typedName, s3Key } as object,
    },
  });

  return { requestId: request.id };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function appendEvent(
  requestId: string,
  type: 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'DELIVERED' | 'VOIDED',
  recipientEmail: string | null,
  ipAddress: string | null,
  userAgent: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.signatureEvent.create({
    data: {
      signatureRequestId: requestId,
      type,
      recipientEmail,
      occurredAt: new Date(),
      ipAddress,
      userAgent,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

function mapDocuSignStatus(
  event: string,
): 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'DELIVERED' | 'VOIDED' | null {
  const map: Record<string, 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'DELIVERED' | 'VOIDED'> = {
    sent: 'SENT',
    delivered: 'DELIVERED',
    completed: 'SIGNED',
    declined: 'DECLINED',
    voided: 'VOIDED',
    viewed: 'VIEWED',
    'envelope-sent': 'SENT',
    'envelope-delivered': 'DELIVERED',
    'envelope-completed': 'SIGNED',
    'envelope-declined': 'DECLINED',
    'envelope-voided': 'VOIDED',
  };
  return map[event.toLowerCase()] ?? null;
}

function docuSignStatusToModel(
  eventType: 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'DELIVERED' | 'VOIDED',
): SignatureStatus {
  const map: Record<typeof eventType, SignatureStatus> = {
    SENT: 'SENT',
    VIEWED: 'VIEWED',
    SIGNED: 'SIGNED',
    DECLINED: 'DECLINED',
    DELIVERED: 'SENT', // DELIVERED means all recipients received — keep SENT
    VOIDED: 'VOIDED',
  };
  return map[eventType];
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // Same-length buffers: a[i] / b[i] are always defined for i < a.length.
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function buildSignedDocumentHtml(params: {
  typedName: string;
  signatureDataUrl: string;
  signedAt: string;
  documentName: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Signed: ${params.documentName}</title></head>
<body style="font-family:sans-serif;margin:40px;color:#111">
<h1 style="font-size:1.5rem">${params.documentName}</h1>
<hr style="margin:24px 0">
<p>Signed by: <strong>${params.typedName}</strong></p>
<p>Signed at: ${params.signedAt}</p>
<div style="margin-top:16px;border:1px solid #ccc;padding:16px;display:inline-block">
  <img src="${params.signatureDataUrl}" alt="Signature" style="max-height:80px">
</div>
<p style="margin-top:24px;font-size:0.75rem;color:#666">
  This document was signed via BidStack 360° INTERNAL provider. This is an
  internal approval signature, not a legally binding e-signature (DocuSign).
</p>
</body></html>`;
}

function updateRecipientSignedAt(recipients: object[], typedName: string): object[] {
  return (recipients as Array<Record<string, unknown>>).map((r) => {
    if (r['name'] === typedName) {
      return { ...r, signedAt: new Date().toISOString() };
    }
    return r;
  });
}

function extractFirstEmail(recipients: object[]): string | null {
  const list = recipients as Array<{ email?: string }>;
  return list[0]?.email ?? null;
}
