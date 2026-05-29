// Integration tests — authentication bypass + IDOR
//
// Key invariants verified:
//   - 401 for no Authorization header (Clerk mode only, self-skips in stub mode)
//   - 401 for expired / malformed JWT (Clerk mode only)
//   - 401 for token signed by wrong issuer (Clerk mode only)
//   - 404 (not 403) for GET of cross-tenant opportunity
//   - 404 for PATCH of cross-tenant opportunity (record remains untouched)
//   - 404 for DELETE of cross-tenant opportunity (record survives soft-delete)

import { createHmac } from 'node:crypto';
import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makePentestContext } from './penetration.test-helpers.js';

const { ctx, skipIfNoDb } = makePentestContext();

describe('penetration: authentication bypass', () => {
  // Stub auth is active when CLERK_SECRET_KEY is unset — every request is
  // treated as the seed user. Those scenarios are exercised by the IDOR /
  // mass-assignment / RBAC blocks in sibling files. The three Clerk-specific
  // assertions here only have signal when a real Clerk key is configured, so
  // they self-skip in stub mode rather than producing false positives.
  const hasClerk = !!process.env.CLERK_SECRET_KEY;

  skipIfNoDb('rejects request with no Authorization header (Clerk mode only)', async () => {
    if (!hasClerk) {
      console.warn('[skip] stub auth bypass test — CLERK_SECRET_KEY unset');
      return;
    }
    const res = await ctx.server.inject({ method: 'GET', url: '/api/opportunities?limit=1' });
    expect(res.statusCode).toBe(401);
  });

  skipIfNoDb('rejects expired / malformed JWT (Clerk mode only)', async () => {
    if (!hasClerk) {
      console.warn('[skip] expired JWT — CLERK_SECRET_KEY unset');
      return;
    }
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/api/opportunities?limit=1',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.expired.signature' },
    });
    expect(res.statusCode).toBe(401);
  });

  skipIfNoDb('rejects token signed by wrong issuer (Clerk mode only)', async () => {
    if (!hasClerk) {
      console.warn('[skip] foreign issuer — CLERK_SECRET_KEY unset');
      return;
    }
    // A token with a real-looking shape but signed with an attacker secret.
    // verifyToken(secretKey=ours) must reject it as an invalid signature.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user_foreign',
        iss: 'https://evil.example.com',
        org_id: 'org_evil',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const sig = createHmac('sha256', 'attacker-secret')
      .update(`${header}.${payload}`)
      .digest('base64url');
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/api/opportunities?limit=1',
      headers: { authorization: `Bearer ${header}.${payload}.${sig}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('penetration: IDOR (insecure direct object reference)', () => {
  skipIfNoDb(
    'GET /api/opportunities/:foreignId returns 404 (not 403, to prevent enumeration)',
    async () => {
      if (!ctx.foreignOpportunityId) throw new Error('foreign opp not provisioned');
      const res = await ctx.server.inject({
        method: 'GET',
        url: `/api/opportunities/${ctx.foreignOpportunityId}`,
      });
      // 404 is the correct response — a 200 leaks data, a 403 confirms the id
      // exists and lets an attacker enumerate UUIDs offline.
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.message).not.toContain('PENTEST-FOREIGN');
      expect(body.message).not.toContain(ctx.foreignOpportunityId);
    },
  );

  skipIfNoDb(
    'PATCH /api/opportunities/:foreignId returns 404 (cross-tenant write blocked)',
    async () => {
      if (!ctx.foreignOpportunityId) throw new Error('foreign opp not provisioned');
      const res = await ctx.server.inject({
        method: 'PATCH',
        url: `/api/opportunities/${ctx.foreignOpportunityId}`,
        headers: { 'content-type': 'application/json' },
        payload: { customer: 'ATTACKER-OVERWRITE' },
      });
      expect(res.statusCode).toBe(404);
      // Confirm the foreign record is untouched.
      const stillForeign = await prisma.opportunity.findUnique({
        where: { id: ctx.foreignOpportunityId },
      });
      expect(stillForeign?.customer).toBe('PENTEST-FOREIGN');
    },
  );

  skipIfNoDb(
    'DELETE /api/opportunities/:foreignId returns 404 (cross-tenant delete blocked)',
    async () => {
      if (!ctx.foreignOpportunityId) throw new Error('foreign opp not provisioned');
      const res = await ctx.server.inject({
        method: 'DELETE',
        url: `/api/opportunities/${ctx.foreignOpportunityId}`,
      });
      expect(res.statusCode).toBe(404);
      const stillThere = await prisma.opportunity.findUnique({
        where: { id: ctx.foreignOpportunityId },
      });
      expect(stillThere?.deletedAt).toBeNull();
    },
  );
});
