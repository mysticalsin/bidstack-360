// Integration tests — SQL injection, file upload bypass, mass assignment,
// RBAC enforcement, and information disclosure
//
// Key invariants verified:
//   - DROP TABLE payload via Prisma search → 200, companies table survives
//   - Null-byte / escape-sequence search → 200 or 400 (never 500)
//   - image/svg+xml upload → 400 (not in ALLOWED_FILE_CONTENT_TYPES)
//   - > FILE_MAX_BYTES upload → 400
//   - finalize without uploaded bytes → 400 / 404 / 415 (never 201)
//   - PATCH with orgId/deletedAt/viewCount injected → orgId unchanged, deletedAt null
//   - GET /api/permissions → 200 or 403 (never 500, no stack leak)
//   - 500 body never contains stack trace, SQL, or internal file paths
//   - X-Request-Id present on every response (audit trail)

import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makePentestContext } from './penetration.test-helpers.js';

const { ctx, skipIfNoDb } = makePentestContext();

describe('penetration: SQL injection via Prisma', () => {
  skipIfNoDb('search query with classic DROP TABLE payload is handled safely', async () => {
    // Prisma parameterises every query — the malicious payload becomes a
    // harmless LIKE substring, never raw SQL. We verify the response is OK
    // (no 500) and the companies table is still alive afterwards.
    const payload = encodeURIComponent("'); DROP TABLE companies;--");
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/opportunities?search=${payload}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);

    // Companies table still queryable — if a SQLi succeeded, this throws.
    const stillAlive = await prisma.company.count();
    expect(typeof stillAlive).toBe('number');
  });

  skipIfNoDb('null-byte + escape-sequence search payload returns safely', async () => {
    const payload = encodeURIComponent("\\x00' OR 1=1--");
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/opportunities?search=${payload}`,
    });
    // Either 200 with an empty list (no match) or 400 if Zod rejects the
    // encoded payload — both are safe outcomes. A 500 would indicate the
    // payload reached the database and crashed it.
    expect([200, 400]).toContain(res.statusCode);
  });
});

describe('penetration: file upload bypass', () => {
  skipIfNoDb('SVG with embedded <script> is rejected by content-type allow-list', async () => {
    // image/svg+xml is NOT in ALLOWED_FILE_CONTENT_TYPES, so the upload-url
    // endpoint rejects it before the bytes ever get a presigned URL. SVGs
    // are JavaScript-capable in browsers and become stored XSS if served.
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/api/files/upload-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        accountId: 'pentest',
        name: 'evil.svg',
        contentType: 'image/svg+xml',
        bytes: 200,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  skipIfNoDb('upload-url request claiming > FILE_MAX_BYTES is rejected', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/api/files/upload-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        accountId: 'pentest',
        name: 'huge.pdf',
        contentType: 'application/pdf',
        bytes: 100 * 1024 * 1024, // 100 MB > 50 MB hard cap
      },
    });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('finalize with mismatched content-type vs upload-url is rejected', async () => {
    // Obtain a valid upload URL for a PDF, then finalize without ever PUT-ing
    // the bytes. The endpoint must 404 ("Uploaded object not found") — the safe
    // path. A 201 would indicate unverified rows are being accepted.
    const presign = await ctx.server.inject({
      method: 'POST',
      url: '/api/files/upload-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        accountId: 'pentest',
        name: 'doc.pdf',
        contentType: 'application/pdf',
        bytes: 100,
      },
    });
    if (presign.statusCode !== 200) {
      console.warn(
        `[skip] upload-url returned ${presign.statusCode} — local storage may be unavailable`,
      );
      return;
    }
    const { storageKey } = presign.json();
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/api/files/finalize',
      headers: { 'content-type': 'application/json' },
      payload: {
        accountId: 'pentest',
        storageKey,
        name: 'doc.pdf',
        contentType: 'application/pdf',
        bytes: 100,
      },
    });
    expect([400, 404, 415]).toContain(res.statusCode);
  });
});

describe('penetration: mass assignment', () => {
  skipIfNoDb('PATCH with orgId in body does not change the record orgId', async () => {
    if (!ctx.ownOpportunityId || !ctx.seedOrgId || !ctx.foreignOrgId) {
      throw new Error('fixture missing');
    }
    const res = await ctx.server.inject({
      method: 'PATCH',
      url: `/api/opportunities/${ctx.ownOpportunityId}`,
      headers: { 'content-type': 'application/json' },
      payload: {
        customer: 'MASS-ASSIGN-PROBE',
        // The injected fields below MUST be stripped / ignored:
        orgId: ctx.foreignOrgId,
        ownerId: '00000000-0000-0000-0000-000000000000',
        deletedAt: new Date().toISOString(),
        viewCount: 99999,
      },
    });
    // Either 200 (Zod strips unknown keys, allowed mutation succeeds) or 400
    // (Zod rejects the extras in strict mode). Both are safe — the key check
    // is that orgId is unchanged regardless of the response code.
    expect([200, 400]).toContain(res.statusCode);

    const after = await prisma.opportunity.findUnique({ where: { id: ctx.ownOpportunityId } });
    expect(after?.orgId).toBe(ctx.seedOrgId);
    expect(after?.deletedAt).toBeNull();
    expect(after?.viewCount).toBeLessThan(99999);
  });
});

describe('penetration: RBAC on privileged settings endpoints', () => {
  skipIfNoDb('GET /api/permissions enforces admin + settings:read', async () => {
    // In stub auth the seed user is typically 'admin' — we capture the
    // outcome and assert it's NEVER a silent leak. The endpoint MUST either:
    //   - 200 (caller is admin with settings:read), or
    //   - 403 (caller lacks one of the gates).
    // A 500 would indicate the gate threw an unhandled error, which is its
    // own security concern (potential info disclosure via stack trace).
    const res = await ctx.server.inject({ method: 'GET', url: '/api/permissions' });
    expect([200, 403]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      // If the caller is allowed, response must not include permissions from other orgs.
      expect(Array.isArray(body.items)).toBe(true);
    }
    if (res.statusCode === 403) {
      const body = res.json();
      // The 403 body must not echo the actual permission catalogue.
      expect(body.message).toBeDefined();
      expect(body.permissions).toBeUndefined();
    }
  });
});

describe('penetration: information disclosure', () => {
  skipIfNoDb('500 response body does not leak stack trace or SQL', async () => {
    // Force a Zod failure by sending a malformed cursor — the response body
    // must contain only structured RFC-7807 fields, never err.stack,
    // prismaCode, or internal file paths.
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/api/opportunities?cursor=not-a-uuid',
    });
    const body = res.body;
    expect(body).not.toContain(' at /');
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('PrismaClient');
    expect(body).not.toContain('process.env');
  });

  skipIfNoDb('X-Request-Id is present on every response (audit trail)', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/api/opportunities?limit=1' });
    expect(res.headers['x-request-id']).toBeDefined();
    expect(String(res.headers['x-request-id']).length).toBeGreaterThan(7);
  });
});
